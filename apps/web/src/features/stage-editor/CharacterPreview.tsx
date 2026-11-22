import { resolveCharacterLayers } from '@animation/animation-core';
import type { CharacterAsset, EyeState, MouthState, Posture } from '@animation/shared';
import { characterLayerUrl } from '../../lib/api';

interface CharacterPreviewProps {
  character: CharacterAsset;
  posture?: Posture;
  eyeState?: EyeState;
  mouthState?: MouthState;
  className?: string;
  title?: string;
}

/**
 * 用真实分层 SVG 合成人物预览，不依赖额外整图、也不使用示例图片。
 * 层的位置与尺寸全部来自 animation-core 的 resolveCharacterLayers，
 * 因此缩略图、素材管理页与画布渲染看到的是同一套素材与同一套坐标。
 */
export default function CharacterPreview({
  character,
  posture = 'standing',
  eyeState = 'open',
  mouthState = 'closed',
  className = 'w-full',
  title,
}: CharacterPreviewProps) {
  const definition = character.descriptor.postures[posture];
  const layers = resolveCharacterLayers(
    { width: definition.size.width },
    definition,
    eyeState,
    mouthState,
  );
  const { width, height } = definition.size;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      title={title}
      data-testid="character-preview"
      data-layer-count={String(layers.length)}
    >
      {layers.map((layer) => (
        <img
          key={`${layer.role}-${layer.variant ?? ''}`}
          src={characterLayerUrl(character.id, layer.file)}
          alt=""
          draggable={false}
          className="absolute object-fill"
          style={{
            left: `${(layer.x / width) * 100}%`,
            top: `${(layer.y / height) * 100}%`,
            width: `${(layer.width / width) * 100}%`,
            height: `${(layer.height / height) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
