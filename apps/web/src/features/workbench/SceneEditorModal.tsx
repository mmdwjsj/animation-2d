import { sceneDurationFrames } from '@animation/animation-core';
import {
  PROJECT_DEFAULTS,
  SCENE_TRANSITION_PRESETS,
  normalizeSceneTransition,
  sceneTransitionPresetById,
  type Asset,
  type SceneTransition,
  type SceneTransitionPresetId,
  type StageScene,
} from '@animation/shared';
import { useEffect, useRef, useState } from 'react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { assetFileUrl } from '../../lib/api';
import { SCENE_NAME_MAX_LENGTH, normalizeSceneName } from './sceneOperations';

export type SceneEditFocus = 'name' | 'background' | 'order' | 'transition';

export interface SceneEditorPatch {
  name: string;
  backgroundAssetId: string | null;
  /** 0 基目标位置，即导出拼接顺序。 */
  index: number;
  /** 进入本场景的转场；null 表示关闭。 */
  transition: SceneTransition | null;
}

interface SceneEditorModalProps {
  open: boolean;
  scene: StageScene | null;
  index: number;
  sceneCount: number;
  /** 仅 kind === 'scene' 的背景素材。 */
  assets: readonly Asset[];
  focus: SceneEditFocus;
  onClose: () => void;
  onSave: (patch: SceneEditorPatch) => void;
}

/** 把落盘的转场配置映射成下拉选项；非预设帧数保留为「自定义」。 */
function transitionChoiceOf(scene: StageScene | null): string {
  const transition = normalizeSceneTransition(scene?.transition);
  if (!transition) return 'none';
  const preset = SCENE_TRANSITION_PRESETS.find(
    (item) => item.durationFrames === transition.durationFrames,
  );
  return preset?.id ?? `custom:${transition.durationFrames}`;
}

function transitionFromChoice(choice: string): SceneTransition | null {
  if (choice === 'none') return null;
  const durationFrames = choice.startsWith('custom:')
    ? Number(choice.slice('custom:'.length))
    : sceneTransitionPresetById(choice as SceneTransitionPresetId).durationFrames;
  return normalizeSceneTransition({ type: 'fade', durationFrames });
}

/**
 * PRD 7.3「双击场景：打开场景编辑」。
 * 一次提交同时应用名称、背景、进入转场与播放顺序，只产生一步撤销历史。
 */
export default function SceneEditorModal({
  open,
  scene,
  index,
  sceneCount,
  assets,
  focus,
  onClose,
  onSave,
}: SceneEditorModalProps) {
  const [name, setName] = useState('');
  const [backgroundAssetId, setBackgroundAssetId] = useState<string | null>(null);
  const [orderIndex, setOrderIndex] = useState(0);
  const [transitionChoice, setTransitionChoice] = useState('none');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !scene) return undefined;
    setName(scene.name);
    setBackgroundAssetId(scene.backgroundAssetId ?? null);
    setOrderIndex(index);
    setTransitionChoice(transitionChoiceOf(scene));
    if (focus === 'name') {
      const timer = window.setTimeout(() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
    // 弹窗打开期间只同步初始值；scene 对象引用变化不重置用户正在输入的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scene?.id, index, focus]);

  const normalized = normalizeSceneName(name);
  const valid = normalized !== null;
  const localSeconds = scene
    ? (sceneDurationFrames(scene) / PROJECT_DEFAULTS.fps).toFixed(1)
    : '0.0';
  const customChoice = transitionChoice.startsWith('custom:') ? transitionChoice : null;

  const handleSave = () => {
    if (!normalized) return;
    onSave({
      name: normalized,
      backgroundAssetId,
      index: orderIndex,
      transition: transitionFromChoice(transitionChoice),
    });
  };

  return (
    <Modal
      open={open}
      title="编辑场景"
      widthClass="w-[520px]"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            data-testid="scene-editor-save"
            disabled={!valid}
            onClick={handleSave}
          >
            保存修改
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section
          data-testid="scene-editor-name-section"
          data-focused={focus === 'name'}
          className={`rounded border p-3 ${focus === 'name' ? 'border-accent' : 'border-line'}`}
        >
          <label htmlFor="scene-editor-name" className="mb-1.5 block text-xs text-ink">
            场景名称
          </label>
          <input
            id="scene-editor-name"
            ref={nameRef}
            data-testid="scene-editor-name"
            value={name}
            maxLength={SCENE_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) handleSave();
            }}
            className="h-9 w-full rounded border border-line bg-page px-2 text-sm text-ink outline-none focus:border-accent"
          />
          {!valid && (
            <p className="mt-1.5 text-[11px] text-danger">
              名称不能为空，且不超过 {SCENE_NAME_MAX_LENGTH} 个字符。
            </p>
          )}
        </section>

        <section
          data-testid="scene-editor-background-section"
          data-focused={focus === 'background'}
          className={`rounded border p-3 ${focus === 'background' ? 'border-accent' : 'border-line'}`}
        >
          <p className="mb-2 text-xs text-ink">场景背景</p>
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              data-testid="scene-editor-bg-none"
              aria-pressed={backgroundAssetId === null}
              onClick={() => setBackgroundAssetId(null)}
              className={`flex h-[86px] flex-col items-center justify-center gap-1 rounded border text-[11px] ${
                backgroundAssetId === null
                  ? 'border-accent bg-elevated text-ink'
                  : 'border-line bg-page text-muted hover:border-accent'
              }`}
            >
              <span className="text-lg leading-none">—</span>
              无背景
            </button>
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                data-testid={`scene-editor-bg-${asset.id}`}
                aria-pressed={backgroundAssetId === asset.id}
                title={asset.name}
                onClick={() => setBackgroundAssetId(asset.id)}
                className={`flex h-[86px] flex-col items-center justify-center gap-1 overflow-hidden rounded border p-1 text-[11px] ${
                  backgroundAssetId === asset.id
                    ? 'border-accent bg-elevated text-ink'
                    : 'border-line bg-page text-muted hover:border-accent'
                }`}
              >
                <img
                  src={assetFileUrl(asset.id)}
                  alt={asset.name}
                  className="h-[60px] w-[34px] object-contain"
                />
                <span className="w-full truncate text-center">{asset.name}</span>
              </button>
            ))}
          </div>
          {assets.length === 0 && (
            <p className="mt-2 text-[11px] text-muted">暂无场景背景素材，可使用「无背景」。</p>
          )}
        </section>

        <section
          data-testid="scene-editor-transition-section"
          data-focused={focus === 'transition'}
          className={`rounded border p-3 ${focus === 'transition' ? 'border-accent' : 'border-line'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink">进入转场</p>
            <span className="text-[10px] text-muted">从上一个场景切入本场景时生效</span>
          </div>
          <select
            aria-label="进入转场"
            data-testid="scene-editor-transition"
            value={transitionChoice}
            onChange={(event) => setTransitionChoice(event.target.value)}
            className="mt-2 h-8 w-full rounded border border-line bg-page px-2 text-xs text-ink outline-none focus:border-accent"
          >
            {SCENE_TRANSITION_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {customChoice && (
              <option value={customChoice}>
                自定义（{customChoice.slice('custom:'.length)} 帧）
              </option>
            )}
          </select>
          <p className="mt-1.5 text-[11px] leading-5 text-muted">
            交叉淡化不增加视频时长，音频仍按原全局时间轴播放；第一个场景的转场不会生效。
            {index === 0 && sceneCount > 0 && (
              <span className="text-amber-300"> 当前是第一个场景，保存后也不会应用转场。</span>
            )}
          </p>
        </section>

        <section
          data-testid="scene-editor-order-section"
          data-focused={focus === 'order'}
          className={`rounded border p-3 ${focus === 'order' ? 'border-accent' : 'border-line'}`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink">播放顺序</p>
            <span data-testid="scene-editor-order" className="text-xs tabular-nums text-muted">
              第 {orderIndex + 1} / {sceneCount} 个
            </span>
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              className="h-8 text-xs"
              disabled={orderIndex <= 0}
              onClick={() => setOrderIndex((value) => Math.max(0, value - 1))}
            >
              前移
            </Button>
            <Button
              className="h-8 text-xs"
              disabled={orderIndex >= sceneCount - 1}
              onClick={() => setOrderIndex((value) => Math.min(sceneCount - 1, value + 1))}
            >
              后移
            </Button>
            <span className="self-center text-[11px] text-muted">
              场景顺序即导出拼接顺序，也可直接拖拽场景 Tab。
            </span>
          </div>
        </section>

        {scene && (
          <div
            data-testid="scene-editor-stats"
            className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-muted"
          >
            <span>{scene.dialogueEvents.length} 句对白</span>
            <span>{scene.characters.length} 个人物</span>
            <span>{scene.objects.length} 个道具</span>
            <span>时长 {localSeconds}s</span>
          </div>
        )}
        <p className="text-[11px] leading-5 text-muted">
          保存后画布、时间轴与导出检查会立即使用新数据；所有改动可按 Ctrl+Z 撤销。
        </p>
      </div>
    </Modal>
  );
}
