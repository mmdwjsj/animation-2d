import {
  formatTimecode,
  getStateAtFrame,
  sceneDurationFrames,
} from '@animation/animation-core';
import {
  POSTURE_LABELS,
  PROJECT_DEFAULTS,
  TIMELINE_VIEW,
  type AudioAsset,
  type DialogueEvent,
  type StageScene,
} from '@animation/shared';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import Button from '../../components/Button';
import { useStageStore } from '../../stores/stageStore';
import { useTimelineStore } from '../../stores/timelineStore';

/**
 * 底部时间轴（PRD 7.6 / 12）。
 * 轨道持续可见，不藏在菜单里；内部时间一律整数帧，秒数只用于显示。
 * 对白事件可拖动改起始帧、拖右边缘改时长；播放头可点标尺或拖动定位。
 */
interface TimelinePanelProps {
  scene: StageScene;
  /** 阶段 7：已生成的 ready 音频资产，用于音频轨道真实片段。 */
  audioAssets: readonly AudioAsset[];
}

const LABEL_WIDTH = TIMELINE_VIEW.trackLabelWidth;
const TICK_STEPS = [1, 5, 10, 15, 30, 60, 90, 150, 300, 600];

interface BlockDrag {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startFrame: number;
  startDuration: number;
  moved: boolean;
}

const blockStyle = (color: string, fill: string) => ({
  border: `1px solid ${color}`,
  background: fill,
});

export default function TimelinePanel({ scene, audioAssets }: TimelinePanelProps) {
  const currentFrame = useTimelineStore((state) => state.currentFrame);
  const playing = useTimelineStore((state) => state.playing);
  const pxPerFrame = useTimelineStore((state) => state.pxPerFrame);
  const selectedDialogueId = useTimelineStore((state) => state.selectedDialogueId);
  const setCurrentFrame = useTimelineStore((state) => state.setCurrentFrame);
  const setPlaying = useTimelineStore((state) => state.setPlaying);
  const togglePlaying = useTimelineStore((state) => state.togglePlaying);
  const zoom = useTimelineStore((state) => state.zoom);
  const selectDialogue = useTimelineStore((state) => state.selectDialogue);

  const beginBatch = useStageStore((state) => state.beginBatch);
  const endBatch = useStageStore((state) => state.endBatch);
  const updateDialogue = useStageStore((state) => state.updateDialogue);
  const insertDialogue = useStageStore((state) => state.insertDialogue);
  const removeDialogue = useStageStore((state) => state.removeDialogue);
  const moveDialogue = useStageStore((state) => state.moveDialogue);
  const autoLayoutDialogues = useStageStore((state) => state.autoLayoutDialogues);
  const limitNotice = useStageStore((state) => state.limitNotice);
  const clearLimitNotice = useStageStore((state) => state.clearLimitNotice);

  const fps = PROJECT_DEFAULTS.fps;
  const durationFrames = sceneDurationFrames(scene);
  const contentWidth = Math.max(600, durationFrames * pxPerFrame);
  const tickFrames = TICK_STEPS.find((step) => step * pxPerFrame >= 60) ?? 600;
  const ticks = useMemo(() => {
    const result: number[] = [];
    for (let frame = 0; frame <= durationFrames; frame += tickFrames) result.push(frame);
    return result;
  }, [durationFrames, tickFrames]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const blockDragRef = useRef<BlockDrag | null>(null);
  const rulerDragRef = useRef(false);

  const events = scene.dialogueEvents;
  const selected = events.find((event) => event.id === selectedDialogueId) ?? null;
  const characterName = (id: string) =>
    scene.characters.find((item) => item.id === id)?.name ?? '未绑定角色';

  // 播放只推进「显示第几帧」，帧内容完全由 getStateAtFrame 求值，不依赖时钟状态。
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const snapshot = useTimelineStore.getState();
      const next = snapshot.currentFrame + 1;
      if (next >= durationFrames) {
        snapshot.setCurrentFrame(Math.max(0, durationFrames - 1));
        snapshot.setPlaying(false);
      } else {
        snapshot.setCurrentFrame(next);
      }
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [playing, durationFrames, fps]);

  useEffect(() => {
    if (selectedDialogueId && !events.some((event) => event.id === selectedDialogueId)) {
      selectDialogue(null);
    }
  }, [events, selectedDialogueId, selectDialogue]);

  // 播放时保持播放头在可视区域内。
  useEffect(() => {
    if (!playing) return;
    const element = scrollRef.current;
    if (!element) return;
    const x = LABEL_WIDTH + currentFrame * pxPerFrame;
    if (x < element.scrollLeft + LABEL_WIDTH + 40 || x > element.scrollLeft + element.clientWidth - 60) {
      element.scrollLeft = Math.max(0, x - element.clientWidth / 2);
    }
  }, [playing, currentFrame, pxPerFrame]);

  const frameFromClientX = (clientX: number): number => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(durationFrames - 1, Math.round((clientX - rect.left) / pxPerFrame)));
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (rulerDragRef.current) {
        setCurrentFrame(frameFromClientX(event.clientX));
        return;
      }
      const drag = blockDragRef.current;
      if (!drag) return;
      const delta = Math.round((event.clientX - drag.startX) / pxPerFrame);
      if (delta === 0 && !drag.moved) return;
      drag.moved = true;
      if (drag.mode === 'move') {
        updateDialogue(drag.id, { startFrame: Math.max(0, drag.startFrame + delta) });
      } else {
        updateDialogue(drag.id, {
          durationFrames: Math.max(TIMELINE_VIEW.minDialogueFrames, drag.startDuration + delta),
        });
      }
    };
    const onUp = () => {
      rulerDragRef.current = false;
      const drag = blockDragRef.current;
      if (!drag) return;
      blockDragRef.current = null;
      endBatch();
      if (!drag.moved) {
        selectDialogue(drag.id);
        setCurrentFrame(drag.startFrame);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pxPerFrame, durationFrames, updateDialogue, endBatch, selectDialogue, setCurrentFrame]);

  const onBlockPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    dialogue: DialogueEvent,
    mode: BlockDrag['mode'],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    blockDragRef.current = {
      id: dialogue.id,
      mode,
      startX: event.clientX,
      startFrame: dialogue.startFrame,
      startDuration: dialogue.durationFrames,
      moved: false,
    };
    beginBatch(mode === 'move' ? '拖动对白事件' : '调整对白时长');
  };

  const onRulerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPlaying(false);
    rulerDragRef.current = true;
    setCurrentFrame(frameFromClientX(event.clientX));
  };

  const playheadLeft = LABEL_WIDTH + currentFrame * pxPerFrame;
  // 与画布预览相同的规则：静止在第 0 帧时显示编辑态，播放 / 跳帧后才显示帧状态。
  const previewActive = playing || currentFrame > 0;
  const frameState = useMemo(
    () =>
      previewActive
        ? getStateAtFrame({ scenes: [scene] }, scene.id, currentFrame, { fps })
        : null,
    [scene, currentFrame, fps, previewActive],
  );
  const speakingName = frameState?.subtitle?.characterName ?? null;

  return (
    <section data-testid="timeline-panel" className="flex h-full flex-col bg-panel">
      {/* 工具栏 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-xs font-semibold text-ink">时间轴</span>
        <span className="h-4 w-px bg-line" />
        <Button
          className="h-7 px-2 text-xs"
          aria-label="回到开头"
          onClick={() => {
            setPlaying(false);
            setCurrentFrame(0);
          }}
        >
          回到开头
        </Button>
        <Button
          className="h-7 px-2 text-xs"
          variant={playing ? 'primary' : 'secondary'}
          aria-label={playing ? '暂停' : '播放'}
          onClick={() => {
            if (!playing && currentFrame >= durationFrames - 1) setCurrentFrame(0);
            togglePlaying();
          }}
        >
          {playing ? '暂停' : '播放'}
        </Button>
        <span data-testid="play-state" className="hidden">
          {playing ? 'playing' : 'paused'}
        </span>
        <span data-testid="current-frame" className="text-xs tabular-nums text-ink">
          第 {currentFrame} / {durationFrames - 1} 帧
        </span>
        <span className="text-xs tabular-nums text-muted">{formatTimecode(currentFrame, fps)}</span>
        <span className="text-[11px] text-muted">{fps} FPS</span>
        {speakingName && (
          <span data-testid="speaking-name" className="rounded bg-elevated px-2 py-0.5 text-[11px] text-ink">
            正在说话：{speakingName}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            className="h-7 px-2 text-xs"
            aria-label="缩小时间轴"
            onClick={() => zoom(1 / TIMELINE_VIEW.zoomStep)}
          >
            −
          </Button>
          <span data-testid="timeline-zoom" className="w-20 text-center text-[11px] tabular-nums text-muted">
            {pxPerFrame.toFixed(2)} px/帧
          </span>
          <Button
            className="h-7 px-2 text-xs"
            aria-label="放大时间轴"
            onClick={() => zoom(TIMELINE_VIEW.zoomStep)}
          >
            ＋
          </Button>
          <Button
            className="h-7 px-2 text-xs"
            aria-label="自动排布对白"
            onClick={() => autoLayoutDialogues()}
          >
            自动排布
          </Button>
        </div>
      </div>

      {limitNotice && limitNotice.includes('对白') && (
        <div
          data-testid="timeline-notice"
          className="flex shrink-0 items-center gap-2 border-b border-warning bg-panel px-3 py-1 text-[11px] text-warning"
        >
          {limitNotice}
          <button type="button" className="underline" onClick={clearLimitNotice}>
            知道了
          </button>
        </div>
      )}

      {/* 轨道区：横向 + 纵向共用一个滚动容器，标签列粘左、标尺粘上 */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: LABEL_WIDTH + contentWidth, minHeight: '100%' }}>
          {/* 标尺 */}
          <div className="sticky top-0 z-30 flex h-7 border-b border-line bg-panel">
            <div
              className="sticky left-0 z-40 flex w-[116px] shrink-0 items-center border-r border-line bg-panel px-2 text-[11px] text-muted"
              style={{ width: LABEL_WIDTH }}
            >
              轨道 / 帧
            </div>
            <div
              ref={rulerRef}
              data-testid="timeline-ruler"
              className="relative h-7 cursor-crosshair"
              style={{ width: contentWidth }}
              onPointerDown={onRulerPointerDown}
            >
              {ticks.map((frame) => (
                <div
                  key={frame}
                  className="absolute top-0 h-full border-l border-line"
                  style={{ left: frame * pxPerFrame }}
                >
                  <span className="ml-1 text-[10px] tabular-nums text-muted">{frame}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 对白轨道 */}
          <TrackRow label="对白轨道" testId="track-dialogue" contentWidth={contentWidth}>
            <span data-testid="dialogue-count" className="sr-only">
              {events.length}
            </span>
            {events.length === 0 && (
              <span className="absolute left-2 top-2 text-[11px] text-muted">
                暂无对白，可在剧本页创建动画草稿或点击「在此后插入对白」
              </span>
            )}
            {events.map((dialogue) => {
              const width = Math.max(28, dialogue.durationFrames * pxPerFrame);
              const isSelected = dialogue.id === selectedDialogueId;
              return (
                <div
                  key={dialogue.id}
                  data-testid="dialogue-block"
                  data-dialogue-id={dialogue.id}
                  data-start-frame={dialogue.startFrame}
                  data-duration-frames={dialogue.durationFrames}
                  data-posture={dialogue.posture}
                  className={`absolute top-1 h-6 cursor-grab select-none overflow-hidden rounded px-1.5 text-[11px] leading-6 text-ink ${isSelected ? 'ring-2 ring-accent' : ''}`}
                  style={{
                    left: dialogue.startFrame * pxPerFrame,
                    width,
                    ...blockStyle('#5b8def', 'rgba(91,141,239,0.24)'),
                  }}
                  onPointerDown={(event) => onBlockPointerDown(event, dialogue, 'move')}
                  title={`${characterName(dialogue.characterId)}：${dialogue.text}（第 ${dialogue.startFrame} 帧，${dialogue.durationFrames} 帧）`}
                >
                  {characterName(dialogue.characterId)}：{dialogue.text.slice(0, 8)}
                  <div
                    data-testid="dialogue-resize"
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize border-l border-accent"
                    onPointerDown={(event) => onBlockPointerDown(event, dialogue, 'resize')}
                  />
                </div>
              );
            })}
          </TrackRow>

          {/* 每个角色一条姿态轨道 */}
          {scene.characters.length === 0 && (
            <TrackRow label="人物姿态" testId="track-posture-empty" contentWidth={contentWidth}>
              <span className="absolute left-2 top-2 text-[11px] text-muted">当前场景暂无人物</span>
            </TrackRow>
          )}
          {scene.characters.map((character) => (
            <TrackRow
              key={character.id}
              label={`${character.name} 姿态`}
              testId="track-posture"
              contentWidth={contentWidth}
            >
              {events
                .filter((dialogue) => dialogue.characterId === character.id)
                .map((dialogue) => (
                  <div
                    key={dialogue.id}
                    data-testid="posture-block"
                    className="absolute top-1 h-6 select-none overflow-hidden rounded px-1.5 text-[11px] leading-6 text-ink"
                    style={{
                      left: dialogue.startFrame * pxPerFrame,
                      width: Math.max(28, dialogue.durationFrames * pxPerFrame),
                      ...blockStyle(
                        dialogue.posture === 'sitting' ? '#9b78dc' : '#5b8def',
                        dialogue.posture === 'sitting' ? 'rgba(155,120,220,0.22)' : 'rgba(91,141,239,0.22)',
                      ),
                    }}
                    title={`第 ${dialogue.startFrame} 帧 · ${POSTURE_LABELS[dialogue.posture]}`}
                  >
                    {POSTURE_LABELS[dialogue.posture]}
                  </div>
                ))}
            </TrackRow>
          ))}

          {/* 音频轨道：只显示真实已生成、且仍在对白上引用的片段，不伪造占位。 */}
          <TrackRow label="音频轨道" testId="track-audio" contentWidth={contentWidth}>
            {audioAssets.length === 0 && (
              <span className="absolute left-2 top-2 text-[11px] text-muted">
                尚未生成配音，点击顶栏「生成配音」后可试听
              </span>
            )}
            {events.map((dialogue) => {
              const asset = dialogue.audioAssetId
                ? audioAssets.find((item) => item.id === dialogue.audioAssetId)
                : undefined;
              if (!asset) return null;
              return (
                <div
                  key={dialogue.id}
                  data-testid="audio-block"
                  data-dialogue-id={dialogue.id}
                  data-duration-ms={asset.durationMs}
                  className="absolute top-1 h-6 select-none overflow-hidden rounded px-1.5 text-[11px] leading-6 text-ink"
                  style={{
                    left: dialogue.startFrame * pxPerFrame,
                    width: Math.max(28, dialogue.durationFrames * pxPerFrame),
                    border: '1px solid #d7a84b',
                    background: 'rgba(215,168,75,0.22)',
                  }}
                  title={`${characterName(dialogue.characterId)}：${dialogue.text} · ${Math.round(asset.durationMs)} ms`}
                >
                  ♪ {Math.round(asset.durationMs)} ms
                </div>
              );
            })}
          </TrackRow>

          {/* 字幕轨道：与对白区间一致，由 getStateAtFrame 的 subtitle 驱动画布 */}
          <TrackRow label="字幕轨道" testId="track-subtitle" contentWidth={contentWidth}>
            {events.map((dialogue) => (
              <div
                key={dialogue.id}
                data-testid="subtitle-block"
                className="absolute top-1 h-6 select-none overflow-hidden rounded px-1.5 text-[11px] leading-6 text-ink"
                style={{
                  left: dialogue.startFrame * pxPerFrame,
                  width: Math.max(28, dialogue.durationFrames * pxPerFrame),
                  ...blockStyle('#5abea0', 'rgba(90,190,160,0.20)'),
                }}
                title={dialogue.text}
              >
                {dialogue.text.slice(0, 10)}
              </div>
            ))}
          </TrackRow>

          {/* 播放头 */}
          <div
            data-testid="playhead"
            className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-accent"
            style={{ left: playheadLeft }}
          >
            <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-accent" />
          </div>
        </div>
      </div>

      {/* 选中对白编辑条 */}
      {selected && (
        <div
          data-testid="dialogue-editor"
          className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-3"
        >
          <span className="shrink-0 text-[11px] text-muted">选中对白</span>
          <CompactTextField
            value={selected.text}
            onCommit={(text) => updateDialogue(selected.id, { text })}
          />
          <CompactFrameField
            label="起始帧"
            value={selected.startFrame}
            min={0}
            onCommit={(startFrame) => updateDialogue(selected.id, { startFrame })}
          />
          <CompactFrameField
            label="时长帧"
            value={selected.durationFrames}
            min={TIMELINE_VIEW.minDialogueFrames}
            onCommit={(durationFrames) => updateDialogue(selected.id, { durationFrames })}
          />
          <div className="flex items-center gap-1">
            {(['standing', 'sitting'] as const).map((posture) => (
              <Button
                key={posture}
                className="h-7 px-2 text-xs"
                variant={selected.posture === posture ? 'primary' : 'secondary'}
                aria-label={`姿态-${POSTURE_LABELS[posture]}`}
                onClick={() => updateDialogue(selected.id, { posture })}
              >
                {POSTURE_LABELS[posture]}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              className="h-7 px-2 text-xs"
              aria-label="前移对白"
              onClick={() => moveDialogue(selected.id, 'up')}
            >
              前移
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              aria-label="后移对白"
              onClick={() => moveDialogue(selected.id, 'down')}
            >
              后移
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              aria-label="跳转到对白开始"
              onClick={() => setCurrentFrame(selected.startFrame)}
            >
              跳转到开始
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              aria-label="在此后插入对白"
              onClick={() => insertDialogue(selected.id)}
            >
              插入
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              variant="danger"
              aria-label="删除对白"
              onClick={() => removeDialogue(selected.id)}
            >
              删除
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function TrackRow({
  label,
  testId,
  contentWidth,
  children,
}: {
  label: string;
  testId: string;
  contentWidth: number;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex h-8 border-b border-line">
      <div
        className="sticky left-0 z-20 flex w-[116px] shrink-0 items-center border-r border-line bg-panel px-2 text-[11px] text-muted"
        style={{ width: LABEL_WIDTH }}
      >
        {label}
      </div>
      <div className="relative h-full" style={{ width: contentWidth }}>
        {children}
      </div>
    </div>
  );
}

function CompactTextField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };
  return (
    <input
      data-testid="dialogue-text-input"
      aria-label="对白文本"
      className="field-input h-7 w-52 px-2 py-0 text-xs"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function CompactFrameField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.floor(parsed));
    onCommit(next);
    setDraft(String(next));
  };
  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
      {label}
      <input
        type="number"
        aria-label={label}
        className="field-input h-7 w-20 px-2 py-0 text-xs tabular-nums"
        value={draft}
        step={1}
        min={min}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
