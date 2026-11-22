import {
  getStateAtFrame,
  hitTest,
  screenToLogical,
  type Point,
  type Size,
  type Viewport,
} from '@animation/animation-core';
import {
  detectSubtitleLanguage,
  PROJECT_DEFAULTS,
  STAGE_VIEWPORT,
  subtitleLineHeight,
  wrapSubtitle,
  type Asset,
  type CharacterAsset,
  type StageScene,
} from '@animation/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../../components/Button';
import { useTimelineStore } from '../../stores/timelineStore';
import { ASSET_DRAG_MIME } from './constants';
import { buildHitTargets } from './layerGeometry';
import { createStageRenderer, type RenderInput, type StageRendererHandle } from './stageRenderer';

interface PixiStageProps {
  scene: StageScene;
  assets: Asset[];
  characters: CharacterAsset[];
  viewport: Viewport;
  selectedId: string | null;
  showSafeArea: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onZoom: (anchor: Point, factor: number) => void;
  onPan: (dx: number, dy: number) => void;
  onFit: (size: Size) => void;
  onToggleSafeArea: () => void;
  onDropAsset: (assetId: string, point: Point) => void;
  /** 双击人物打开分层素材弹窗（PRD 7.4）。 */
  onOpenCharacter: (id: string) => void;
  /** 拖动开始 / 结束：把连续 pointermove 合并成一步撤销历史。 */
  onDragStart: () => void;
  onDragEnd: () => void;
  /** 阶段 7：按 audioAssetId 索引的缓存振幅包络，用于音频驱动嘴型。 */
  audioEnvelopes: Readonly<Record<string, readonly number[]>>;
}

type DragState =
  | { kind: 'object'; id: string; offset: Point }
  | { kind: 'pan'; last: Point }
  | null;

/**
 * 中央动画画布容器（PRD 7.4）。
 * PixiJS 只负责显示；选中、拖动、缩放、平移全部走 animation-core 纯函数，
 * 屏幕坐标经 screenToLogical 转成 1080×1920 逻辑坐标后才写回数据。
 */
export default function PixiStage(props: PixiStageProps) {
  const {
    scene,
    assets,
    characters,
    viewport,
    selectedId,
    showSafeArea,
    onSelect,
    onMove,
    onZoom,
    onPan,
    onFit,
    onToggleSafeArea,
    onDropAsset,
    onOpenCharacter,
    onDragStart,
    onDragEnd,
    audioEnvelopes,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StageRendererHandle | null>(null);
  const dragRef = useRef<DragState>(null);
  const spaceRef = useRef(false);
  const didFitRef = useRef(false);
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const currentFrame = useTimelineStore((state) => state.currentFrame);
  const playing = useTimelineStore((state) => state.playing);

  // 静止在第 0 帧时显示人工编辑态；播放或跳帧后画面完全由确定性求值器驱动。
  // 音频包络是生成时缓存的数据，这里只读，不依赖播放时钟或实时音频分析。
  const frameState = useMemo(
    () =>
      playing || currentFrame > 0
        ? getStateAtFrame({ scenes: [scene] }, scene.id, currentFrame, {
            fps: PROJECT_DEFAULTS.fps,
            audioEnvelopes,
          })
        : null,
    [scene, currentFrame, playing, audioEnvelopes],
  );

  const latest = useRef<RenderInput>({
    scene, assets, characters, viewport, selectedId, showSafeArea, frameState,
  });
  latest.current = { scene, assets, characters, viewport, selectedId, showSafeArea, frameState };

  const interaction = useRef({
    scene,
    assets,
    characters,
    viewport,
    onSelect,
    onMove,
    onZoom,
    onPan,
    onFit,
    onDropAsset,
    onOpenCharacter,
    onDragStart,
    onDragEnd,
  });
  interaction.current = {
    scene,
    assets,
    characters,
    viewport,
    onSelect,
    onMove,
    onZoom,
    onPan,
    onFit,
    onDropAsset,
    onOpenCharacter,
    onDragStart,
    onDragEnd,
  };

  useEffect(() => {
    rendererRef.current?.update(latest.current);
  }, [scene, assets, characters, viewport, selectedId, showSafeArea, frameState]);

  useEffect(() => {
    const container = containerRef.current;
    const host = hostRef.current;
    if (!container || !host) return;

    let cancelled = false;
    let renderer: StageRendererHandle | null = null;
    /** 双击检测基于 pointerdown，避免依赖被 preventDefault 抑制的 dblclick 兼容事件。 */
    let lastTap: { id: string; time: number } | null = null;

    const toLocal = (event: { clientX: number; clientY: number }): Point => {
      const rect = container.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const buildTargets = () =>
      buildHitTargets(
        interaction.current.scene,
        interaction.current.assets,
        interaction.current.characters,
      );

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 1 || spaceRef.current) {
        event.preventDefault();
        dragRef.current = { kind: 'pan', last: toLocal(event) };
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      const screen = toLocal(event);
      const logical = screenToLogical(screen, interaction.current.viewport);
      const hit = hitTest(logical, buildTargets());
      interaction.current.onSelect(hit);

      const now = Date.now();
      const isDoubleTap =
        hit !== null && lastTap !== null && lastTap.id === hit && now - lastTap.time < 400;
      lastTap = hit ? { id: hit, time: now } : null;

      // 道具与人物都能拖动，命中目标从两类实例里统一查找。
      const target = hit
        ? (interaction.current.scene.objects.find((item) => item.id === hit) ??
          interaction.current.scene.characters.find((item) => item.id === hit))
        : undefined;
      if (hit && target) {
        dragRef.current = {
          kind: 'object',
          id: hit,
          offset: { x: logical.x - target.x, y: logical.y - target.y },
        };
        interaction.current.onDragStart();
      }

      if (isDoubleTap && hit && interaction.current.scene.characters.some((item) => item.id === hit)) {
        interaction.current.onOpenCharacter(hit);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // 一旦开始拖动就取消双击判定，避免快速连续拖动误打开素材弹窗。
      lastTap = null;
      const screen = toLocal(event);
      if (drag.kind === 'pan') {
        interaction.current.onPan(screen.x - drag.last.x, screen.y - drag.last.y);
        dragRef.current = { kind: 'pan', last: screen };
        return;
      }
      const logical = screenToLogical(screen, interaction.current.viewport);
      interaction.current.onMove(drag.id, logical.x - drag.offset.x, logical.y - drag.offset.y);
    };

    const onPointerUp = () => {
      if (dragRef.current?.kind === 'object') interaction.current.onDragEnd();
      dragRef.current = null;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? STAGE_VIEWPORT.zoomStep : 1 / STAGE_VIEWPORT.zoomStep;
      interaction.current.onZoom(toLocal(event), factor);
    };

    const isTypingTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        spaceRef.current = true;
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceRef.current = false;
    };

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      sizeRef.current = { width: rect.width, height: rect.height };
      rendererRef.current?.resize(rect.width, rect.height);
      if (!didFitRef.current) {
        didFitRef.current = true;
        interaction.current.onFit(sizeRef.current);
      }
    });
    observer.observe(container);

    void createStageRenderer(
      host,
      container.clientWidth || 800,
      container.clientHeight || 600,
      () => {
        if (!cancelled && rendererRef.current) rendererRef.current.update(latest.current);
      },
    )
      .then((created) => {
        if (cancelled) {
          // 只销毁本次实例自己的 canvas。绝不能清空 host：
          // React StrictMode 会连续挂载两次，清空 host 会误删第二次挂载的 canvas，
          // 表现为「素材已加载但画布一片空白」。
          created.destroy();
          return;
        }
        renderer = created;
        rendererRef.current = created;
        created.update(latest.current);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRendererError(error instanceof Error ? error.message : '画布初始化失败');
        }
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer?.destroy();
      rendererRef.current = null;
      host.replaceChildren();
    };
  }, []);

  const center: Point = {
    x: sizeRef.current.width / 2,
    y: sizeRef.current.height / 2,
  };
  // 字幕排版与导出共用 shared 规则：泰文按字素簇断行、行高更大。
  const subtitle = frameState?.subtitle ?? null;
  const subtitleLanguage = subtitle ? detectSubtitleLanguage(subtitle.text) : 'zh';
  const subtitleLines = subtitle ? wrapSubtitle(subtitle.text, subtitleLanguage, 18) : [];

  return (
    <div
      ref={containerRef}
      data-testid="stage-canvas"
      data-frame={frameState?.frame ?? -1}
      data-speaking={
        frameState?.characters.filter((item) => item.isSpeaking).map((item) => item.id).join(',') ?? ''
      }
      data-subtitle={frameState?.subtitle?.text ?? ''}
      data-mouth={
        frameState?.characters
          .map((item) => `${item.id}:${item.mouthState}:${item.mouthSource}`)
          .join(',') ?? ''
      }
      data-audio-mouth={frameState?.characters.some((item) => item.mouthSource === 'audio') ?? false}
      className="relative h-full w-full overflow-hidden bg-page"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const assetId = event.dataTransfer.getData(ASSET_DRAG_MIME);
        if (!assetId) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        onDropAsset(assetId, screenToLogical(screen, viewport));
      }}
    >
      <div ref={hostRef} className="absolute inset-0" />

      {!ready && !rendererError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-page">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            正在初始化画布…
          </div>
        </div>
      )}

      {rendererError && (
        <div className="absolute inset-0 flex items-center justify-center bg-page px-6 text-center">
          <div>
            <p className="text-sm text-danger">画布初始化失败</p>
            <p className="mt-2 text-xs text-muted">{rendererError}</p>
          </div>
        </div>
      )}

      {/* 预览字幕：内容来自 getStateAtFrame，与 Remotion 导出共用同一帧状态。 */}
      {subtitle && (
        <div
          data-testid="subtitle-overlay"
          className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-8"
        >
          <div
            className="max-w-[80%] rounded px-4 py-2 text-center text-sm text-ink"
            style={{
              background: 'rgba(12,14,18,0.78)',
              border: '1px solid rgba(255,255,255,0.18)',
              lineHeight: `${subtitleLineHeight(subtitleLanguage, 14)}px`,
              fontFamily:
                subtitleLanguage === 'th'
                  ? '"Leelawadee UI", "Noto Sans Thai", "Tahoma", sans-serif'
                  : undefined,
              overflowWrap: 'anywhere',
            }}
          >
            {subtitleLines.map((line, index) => (
              <span key={index} style={{ display: index === 0 ? 'inline' : 'block' }}>
                {index === 0 && subtitle.characterName && (
                  <span className="mr-1.5 text-xs text-muted">{subtitle.characterName}：</span>
                )}
                {line}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-1.5 rounded border border-line bg-panel px-2 py-1.5 shadow-lg">
          <Button
            className="h-7 px-2.5 text-xs"
            aria-label="缩小画布"
            onClick={() => onZoom(center, 1 / STAGE_VIEWPORT.zoomStep)}
          >
            −
          </Button>
          <span
            data-testid="zoom-percent"
            className="w-14 text-center text-xs tabular-nums text-ink"
          >
            {Math.round(viewport.scale * 100)}%
          </span>
          <Button
            className="h-7 px-2.5 text-xs"
            aria-label="放大画布"
            onClick={() => onZoom(center, STAGE_VIEWPORT.zoomStep)}
          >
            +
          </Button>
          <span className="mx-1 h-5 w-px bg-line" />
          <Button
            className="h-7 px-2.5 text-xs"
            onClick={() => onFit(sizeRef.current)}
          >
            适应窗口
          </Button>
          <Button
            className="h-7 px-2.5 text-xs"
            variant={showSafeArea ? 'primary' : 'ghost'}
            aria-pressed={showSafeArea}
            onClick={onToggleSafeArea}
          >
            安全区
          </Button>
        </div>

        <div className="absolute bottom-3 left-3 rounded border border-line bg-panel px-3 py-1.5 text-[11px] leading-5 text-muted">
          逻辑坐标 1080 × 1920 · 滚轮缩放 · 空格 / 中键平移 · 双击人物查看分层素材 · Delete 删除
        </div>
      </div>
    </div>
  );
}
