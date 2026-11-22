import {
  MOUTH_LABELS,
  MOUTH_VALUES,
  POSTURE_LABELS,
  POSTURE_VALUES,
  PROJECT_DEFAULTS,
  PROJECT_LANGUAGES,
  PROJECT_LANGUAGE_LABELS,
  type Asset,
  type CharacterAsset,
  type CharacterInstance,
  type Project,
  type StageObject,
  type TtsProvider,
} from '@animation/shared';
import { useEffect, useState } from 'react';
import Button from '../../components/Button';
import { formatDateTime } from '../../lib/format';
import NumberField from './NumberField';

interface PropertyPanelProps {
  selected: StageObject | null;
  asset: Asset | null;
  selectedCharacter: CharacterInstance | null;
  characterAsset: CharacterAsset | null;
  /** 人物高度由姿态素材比例推导，只读展示。 */
  characterHeight: number | null;
  /** 动画数据（animation.json）中的场景数，是场景的真相来源。 */
  sceneCount: number;
  project: Project;
  /** 阶段 7：统一 Provider 描述，UI 只展示通用参数。 */
  ttsProviders: readonly TtsProvider[];
  onUpdate: (patch: Partial<StageObject>) => void;
  onUpdateCharacter: (patch: Partial<CharacterInstance>) => void;
  onOpenCharacterEditor: () => void;
  onReorder: (direction: 'up' | 'down') => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/** 右侧属性面板（PRD 7.5）。数值改动写回的是逻辑坐标，不是浏览器像素。 */
export default function PropertyPanel({
  selected,
  asset,
  selectedCharacter,
  characterAsset,
  characterHeight,
  sceneCount,
  project,
  ttsProviders,
  onUpdate,
  onUpdateCharacter,
  onOpenCharacterEditor,
  onReorder,
  onRemove,
  canMoveUp,
  canMoveDown,
}: PropertyPanelProps) {
  const isCharacter = selectedCharacter !== null;
  const target: StageObject | CharacterInstance | null = selectedCharacter ?? selected;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <p className="section-title">当前选中对象</p>
        {!target && (
          <p className="mt-2 text-xs leading-6 text-muted">选择画布中的人物或道具以编辑属性。</p>
        )}
      </div>

      {target ? (
        <>
          <div
            data-testid="property-scroll"
            className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3"
          >
            <EditableName
              value={target.name}
              onCommit={(name) =>
                isCharacter ? onUpdateCharacter({ name }) : onUpdate({ name })
              }
            />
            <InfoRow label="素材" value={(isCharacter ? characterAsset?.name : asset?.name) ?? '素材缺失'} />
            <InfoRow label="素材 ID" value={target.assetId} />

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="X"
                value={target.x}
                min={0}
                max={PROJECT_DEFAULTS.width}
                onCommit={(x) => (isCharacter ? onUpdateCharacter({ x }) : onUpdate({ x }))}
              />
              <NumberField
                label="Y"
                value={target.y}
                min={0}
                max={PROJECT_DEFAULTS.height}
                onCommit={(y) => (isCharacter ? onUpdateCharacter({ y }) : onUpdate({ y }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="宽度"
                value={target.width}
                min={1}
                max={PROJECT_DEFAULTS.width}
                onCommit={(width) =>
                  isCharacter ? onUpdateCharacter({ width }) : onUpdate({ width })
                }
              />
              {isCharacter ? (
                <ReadOnlyField label="高度（姿态推导）" value={characterHeight ?? 0} />
              ) : (
                <NumberField
                  label="高度"
                  value={selected?.height ?? 0}
                  min={1}
                  max={PROJECT_DEFAULTS.height}
                  onCommit={(height) => onUpdate({ height })}
                />
              )}
            </div>
            <p className="text-[11px] leading-5 text-muted">
              {isCharacter
                ? '逻辑坐标以人物锚点（脚底 / 坐姿接触点）为准，姿态切换不改变该位置。'
                : '坐标为 1080 × 1920 逻辑坐标，锚点为素材底部中心。'}
            </p>

            {isCharacter && selectedCharacter && (
              <>
                <div className="border-t border-line pt-3">
                  <p className="field-label">姿态</p>
                  <div className="flex gap-2">
                    {POSTURE_VALUES.map((posture) => (
                      <Button
                        key={posture}
                        className="h-9 flex-1 text-xs"
                        variant={selectedCharacter.posture === posture ? 'primary' : 'secondary'}
                        aria-label={`姿态-${POSTURE_LABELS[posture]}`}
                        aria-pressed={selectedCharacter.posture === posture}
                        onClick={() => onUpdateCharacter({ posture })}
                      >
                        {POSTURE_LABELS[posture]}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-line pt-3">
                  <p className="field-label">嘴型预览（播放时由音频包络驱动）</p>
                  <div className="flex gap-1.5">
                    {MOUTH_VALUES.map((state) => (
                      <Button
                        key={state}
                        className="h-8 flex-1 px-1 text-[11px]"
                        variant={selectedCharacter.mouthState === state ? 'primary' : 'secondary'}
                        aria-label={`嘴型-${MOUTH_LABELS[state]}`}
                        aria-pressed={selectedCharacter.mouthState === state}
                        onClick={() => onUpdateCharacter({ mouthState: state })}
                      >
                        {MOUTH_LABELS[state]}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* 阶段 7 / 双语：角色级配音参数。引擎与音色按语言自动路由，UI 只暴露通用字段。 */}
                {ttsProviders.length > 0 &&
                  (() => {
                    const seen = new Set<string>();
                    const allVoices: TtsProvider['voices'] = [];
                    for (const item of ttsProviders) {
                      for (const voice of item.voices) {
                        if (seen.has(voice.id)) continue;
                        seen.add(voice.id);
                        allVoices.push(voice);
                      }
                    }
                    const speedProvider = ttsProviders[0];
                    return (
                      <div className="border-t border-line pt-3">
                        <p className="field-label">配音设置（角色覆盖）</p>
                        <dl className="mb-2 text-[11px]">
                          <InfoRow
                            label="TTS 引擎"
                            value={ttsProviders
                              .map(
                                (item) =>
                                  `${item.name}（${item.languages
                                    .map((lang) => PROJECT_LANGUAGE_LABELS[lang])
                                    .join('/')}）`,
                              )
                              .join('、')}
                          />
                        </dl>
                        <label className="mb-2 block">
                          <span className="mb-1 block text-[11px] text-muted">
                            默认声音（不分语言）
                          </span>
                          <select
                            aria-label="角色配音声音"
                            className="field-input w-full"
                            value={selectedCharacter.voiceId ?? ''}
                            onChange={(event) =>
                              onUpdateCharacter({ voiceId: event.target.value || undefined })
                            }
                          >
                            <option value="">跟随生成时的默认声音</option>
                            {allVoices.map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name}（{PROJECT_LANGUAGE_LABELS[voice.language]}）
                              </option>
                            ))}
                          </select>
                        </label>
                        {PROJECT_LANGUAGES.map((lang) => {
                          const voices = allVoices.filter((voice) => voice.language === lang);
                          if (voices.length === 0) return null;
                          return (
                            <label key={lang} className="mb-2 block">
                              <span className="mb-1 block text-[11px] text-muted">
                                {PROJECT_LANGUAGE_LABELS[lang]}台词音色（优先于默认声音）
                              </span>
                              <select
                                aria-label={`${PROJECT_LANGUAGE_LABELS[lang]}台词音色`}
                                className="field-input w-full"
                                value={selectedCharacter.voiceByLanguage?.[lang] ?? ''}
                                onChange={(event) => {
                                  const value = event.target.value || undefined;
                                  const current = selectedCharacter.voiceByLanguage ?? {};
                                  onUpdateCharacter({
                                    voiceByLanguage:
                                      lang === 'zh'
                                        ? { ...current, zh: value }
                                        : { ...current, th: value },
                                  });
                                }}
                              >
                                <option value="">跟随引擎按语言默认</option>
                                {voices.map((voice) => (
                                  <option key={voice.id} value={voice.id}>
                                    {voice.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                        <label className="block">
                          <span className="mb-1 block text-[11px] text-muted">
                            语速 {(selectedCharacter.speed ?? speedProvider.defaultSpeed).toFixed(1)}×
                          </span>
                          <input
                            aria-label="角色配音语速"
                            type="range"
                            min={speedProvider.minSpeed}
                            max={speedProvider.maxSpeed}
                            step={0.1}
                            value={selectedCharacter.speed ?? speedProvider.defaultSpeed}
                            onChange={(event) =>
                              onUpdateCharacter({ speed: Number(event.target.value) })
                            }
                            className="w-full accent-accent"
                          />
                        </label>
                        <p className="mt-1.5 text-[11px] leading-5 text-muted">
                          按语言音色优先于默认声音；未单独设置时沿用「生成配音」弹窗中的自动路由结果。
                        </p>
                      </div>
                    );
                  })()}

                <Button className="h-8 w-full text-xs" onClick={onOpenCharacterEditor}>
                  查看分层素材与锚点
                </Button>
              </>
            )}

            <div className="border-t border-line pt-3">
              <p className="field-label">显示状态</p>
              <div className="flex gap-2">
                <Button
                  className="h-8 flex-1 text-xs"
                  variant={target.visible ? 'primary' : 'secondary'}
                  onClick={() =>
                    isCharacter ? onUpdateCharacter({ visible: true }) : onUpdate({ visible: true })
                  }
                >
                  显示
                </Button>
                <Button
                  className="h-8 flex-1 text-xs"
                  variant={!target.visible ? 'primary' : 'secondary'}
                  onClick={() =>
                    isCharacter ? onUpdateCharacter({ visible: false }) : onUpdate({ visible: false })
                  }
                >
                  隐藏
                </Button>
              </div>
            </div>

            <div className="border-t border-line pt-3">
              <p className="field-label">图层顺序（第 {target.zIndex + 1} 层）</p>
              <div className="flex gap-2">
                <Button className="h-8 flex-1 text-xs" disabled={!canMoveDown} onClick={() => onReorder('down')}>
                  下移一层
                </Button>
                <Button className="h-8 flex-1 text-xs" disabled={!canMoveUp} onClick={() => onReorder('up')}>
                  上移一层
                </Button>
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-line px-4 py-3">
            <Button variant="danger" className="h-8 w-full text-xs" onClick={onRemove}>
              删除对象
            </Button>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="border-b border-line px-4 py-3">
            <p className="section-title">项目概览（只读）</p>
            <dl className="mt-2 space-y-1.5 text-xs">
              <InfoRow label="画面尺寸" value={`${project.width} × ${project.height}`} />
              <InfoRow label="帧率" value={`${project.fps} FPS`} />
              <InfoRow label="画面比例" value={project.aspectRatio} />
              <InfoRow label="动画场景数" value={String(sceneCount)} />
              <InfoRow label="数据版本" value={`v${project.version}`} />
              <InfoRow label="最近修改" value={formatDateTime(project.updatedAt)} />
            </dl>
          </div>
          <p className="px-4 py-3 text-xs leading-6 text-muted">
            人物分层、时间轴与确定性帧预览、撤销 / 重做、配音与音频驱动嘴型、多场景拼接导出
            均已接入；使用上方场景栏切换当前编辑的场景。
          </p>
        </div>
      )}
    </aside>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div
        className="field-input cursor-default text-muted"
        title="高度由人物姿态素材宽高比自动推导"
      >
        {Math.round(value * 10) / 10}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

function EditableName({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(value);
      return;
    }
    onCommit(trimmed);
  };

  return (
    <label className="block">
      <span className="field-label">名称</span>
      <input
        aria-label="对象名称"
        className="field-input"
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
    </label>
  );
}
