import {
  CHARACTER_LAYER_ROLE_LABELS,
  EYE_LABELS,
  EYE_VALUES,
  MOUTH_LABELS,
  MOUTH_VALUES,
  POSTURE_LABELS,
  POSTURE_VALUES,
  type CharacterAsset,
  type CharacterInstance,
  type EyeState,
  type MouthState,
} from '@animation/shared';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import CharacterPreview from './CharacterPreview';

interface CharacterEditorModalProps {
  open: boolean;
  character: CharacterAsset | null;
  instance: CharacterInstance | null;
  onClose: () => void;
  onUpdate: (patch: Partial<CharacterInstance>) => void;
}

/**
 * 双击画布人物打开的「人物素材」弹窗（PRD 7.4）。
 * 展示真实分层素材、两姿态预览、锚点定义与层清单，
 * 并提供姿态 / 眼睛 / 嘴型切换；不提供素材文件编辑（超出阶段 3 范围）。
 */
export default function CharacterEditorModal({
  open,
  character,
  instance,
  onClose,
  onUpdate,
}: CharacterEditorModalProps) {
  if (!character || !instance) return null;
  const definition = character.descriptor.postures[instance.posture];
  const standing = character.descriptor.postures.standing;
  const sitting = character.descriptor.postures.sitting;

  return (
    <Modal
      open={open}
      title={`人物素材 · ${character.name}`}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="flex gap-3">
        {POSTURE_VALUES.map((posture) => (
          <button
            key={posture}
            type="button"
            aria-label={`切换姿态-${POSTURE_LABELS[posture]}`}
            aria-pressed={instance.posture === posture}
            onClick={() => onUpdate({ posture })}
            className={`w-24 rounded border p-1.5 ${
              instance.posture === posture
                ? 'border-accent bg-elevated'
                : 'border-line bg-page hover:border-accent'
            }`}
          >
            <div className="flex h-[120px] items-start justify-center overflow-hidden rounded bg-subtle">
              <CharacterPreview
                character={character}
                posture={posture}
                eyeState={instance.eyeState}
                mouthState={instance.mouthState}
                className="w-[72px]"
              />
            </div>
            <p className="mt-1 text-center text-xs text-ink">{POSTURE_LABELS[posture]}</p>
          </button>
        ))}

        <div className="min-w-0 flex-1 text-[11px] leading-6 text-muted">
          <p className="text-xs font-semibold text-ink">姿态锚点</p>
          <p>站立 ({standing.anchor.x}, {standing.anchor.y}) · {standing.anchorLabel}</p>
          <p>坐着 ({sitting.anchor.x}, {sitting.anchor.y}) · {sitting.anchorLabel}</p>
          <p>切换姿态时逻辑坐标不变，由锚点校准显示位置。</p>
          <p>局部画布 {definition.size.width} × {definition.size.height}</p>
          <p>当前姿态共 {definition.layers.length} 个分层</p>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <p className="field-label">眼睛状态</p>
        <Segmented
          values={EYE_VALUES}
          labels={EYE_LABELS}
          value={instance.eyeState}
          ariaPrefix="眼睛"
          onChange={(next: EyeState) => onUpdate({ eyeState: next })}
        />
      </div>

      <div className="mt-3">
        <p className="field-label">嘴型预览（阶段 7 起由对白与音频自动驱动）</p>
        <Segmented
          values={MOUTH_VALUES}
          labels={MOUTH_LABELS}
          value={instance.mouthState}
          ariaPrefix="嘴型"
          onChange={(next: MouthState) => onUpdate({ mouthState: next })}
        />
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <p className="field-label">分层素材清单（{POSTURE_LABELS[instance.posture]}）</p>
        <ul className="max-h-36 space-y-1 overflow-auto">
          {definition.layers.map((layer) => (
            <li
              key={`${layer.role}-${layer.variant ?? ''}`}
              className="flex items-center justify-between gap-2 rounded bg-page px-2 py-1 text-[11px]"
            >
              <span className="shrink-0 text-ink">
                {CHARACTER_LAYER_ROLE_LABELS[layer.role]}
                {layer.variant ? ` · ${layer.variant}` : ''}
              </span>
              <span className="truncate text-muted" title={layer.file}>
                {layer.file}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function Segmented<T extends string>({
  values,
  labels,
  value,
  ariaPrefix,
  onChange,
}: {
  values: readonly T[];
  labels: Record<T, string>;
  value: T;
  ariaPrefix: string;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {values.map((item) => (
        <Button
          key={item}
          className="h-7 flex-1 px-1 text-[11px]"
          variant={value === item ? 'primary' : 'secondary'}
          aria-label={`${ariaPrefix}-${labels[item]}`}
          aria-pressed={value === item}
          onClick={() => onChange(item)}
        >
          {labels[item]}
        </Button>
      ))}
    </div>
  );
}

