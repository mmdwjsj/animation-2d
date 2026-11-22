import { characterFrame, objectBounds, type HitTarget, type Rect } from '@animation/animation-core';
import type { Asset, CharacterAsset, StageScene } from '@animation/shared';

/**
 * 道具与人物的统一几何视图。
 * 命中测试、选中框、边界约束都从这里取数据，避免 PixiJS 适配层与交互层
 * 各写一份人物包围盒计算（AGENTS 6「不复制多套相同逻辑」）。
 */

export function buildHitTargets(
  scene: StageScene,
  assets: Asset[],
  characters: CharacterAsset[],
): HitTarget[] {
  const targets: HitTarget[] = [];

  for (const object of scene.objects) {
    const asset = assets.find((item) => item.id === object.assetId);
    targets.push({
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      anchorX: asset?.anchorX ?? 0.5,
      anchorY: asset?.anchorY ?? 1,
      visible: object.visible,
      zIndex: object.zIndex,
    });
  }

  for (const instance of scene.characters) {
    const asset = characters.find((item) => item.id === instance.assetId);
    if (!asset) continue;
    const frame = characterFrame(
      { x: instance.x, y: instance.y, width: instance.width },
      asset.descriptor.postures[instance.posture],
    );
    targets.push({
      id: instance.id,
      x: instance.x,
      y: instance.y,
      width: frame.width,
      height: frame.height,
      anchorX: frame.anchorX,
      anchorY: frame.anchorY,
      visible: instance.visible,
      zIndex: instance.zIndex,
    });
  }

  return targets;
}

/** 选中对象的包围盒；人物按当前姿态锚点校准后的等效包围盒计算。 */
export function boundsFor(
  scene: StageScene,
  id: string,
  assets: Asset[],
  characters: CharacterAsset[],
): Rect | null {
  const object = scene.objects.find((item) => item.id === id);
  if (object) {
    const asset = assets.find((item) => item.id === object.assetId);
    return objectBounds({
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      anchorX: asset?.anchorX ?? 0.5,
      anchorY: asset?.anchorY ?? 1,
    });
  }

  const instance = scene.characters.find((item) => item.id === id);
  if (!instance) return null;
  const asset = characters.find((item) => item.id === instance.assetId);
  if (!asset) return null;
  const frame = characterFrame(
    { x: instance.x, y: instance.y, width: instance.width },
    asset.descriptor.postures[instance.posture],
  );
  return objectBounds({
    x: instance.x,
    y: instance.y,
    width: frame.width,
    height: frame.height,
    anchorX: frame.anchorX,
    anchorY: frame.anchorY,
  });
}

/** 人物当前姿态派生出的显示高度，供属性面板只读展示。 */
export function characterDisplayHeight(
  instance: { width: number; posture: 'standing' | 'sitting' },
  asset: CharacterAsset,
): number {
  return characterFrame(
    { x: 0, y: 0, width: instance.width },
    asset.descriptor.postures[instance.posture],
  ).height;
}
