/**
 * 人物姿态几何与嘴型状态（架构 5.6 / 7.3 / 7.4）。
 *
 * 纯函数模块：零 React / PixiJS / DOM / 浏览器时钟依赖，
 * PixiJS 预览适配层与后续 Remotion 导出适配层共用同一套计算。
 *
 * 坐标约定（PRD 7.4、10.2）：
 * - 人物实例只保存逻辑锚点 (x, y) 与显示宽度 width。
 * - 素材描述文件为每个姿态提供 size 与 anchor（脚底中心 / 坐姿接触点）。
 * - 渲染时先由 characterFrame 把「局部原点」校准到 (x - anchor*scale, y - anchor*scale)，
 *   各层再按局部 box 缩放摆放。姿态切换只换素材与 anchor，逻辑锚点不变，
 *   因此脚底 / 接触点始终落在同一个逻辑位置，人物不会跳动。
 */

export type Posture = 'standing' | 'sitting';
export type EyeState = 'open' | 'closed';
export type MouthState = 'closed' | 'open_small' | 'open_large';
export type CharacterLayerRole = 'body' | 'head' | 'eyes' | 'mouth';

export interface CharacterLayerDef {
  role: CharacterLayerRole;
  /** eyes / mouth 的状态变体；body / head 省略。 */
  variant?: string;
  file: string;
  box: { x: number; y: number; width: number; height: number };
  zIndex: number;
}

export interface CharacterPostureDef {
  size: { width: number; height: number };
  anchor: { x: number; y: number };
  layers: readonly CharacterLayerDef[];
}

export interface CharacterPlacement {
  x: number;
  y: number;
  width: number;
}

/** 说话时嘴型循环的帧数；每 3 帧切换一次状态（30 FPS 下约 0.1 秒）。 */
export const MOUTH_CYCLE_FRAMES = 9;

export interface CharacterFrame {
  /** 姿态局部原点在画布逻辑坐标中的位置（已按 anchor 校准）。 */
  originX: number;
  originY: number;
  /** instance.width / posture.size.width */
  scale: number;
  /** 等效包围盒尺寸，供选中框与命中测试复用。 */
  width: number;
  height: number;
  /** 归一化锚点，可直接传给 objectBounds / hitTest / clampObjectPosition。 */
  anchorX: number;
  anchorY: number;
}

/**
 * 计算姿态的显示变换。返回值与 objectBounds 组合后，
 * 包围盒左上角恰好等于 (originX, originY)，即整个姿态画布缩放后的位置。
 */
export function characterFrame(
  instance: CharacterPlacement,
  posture: CharacterPostureDef,
): CharacterFrame {
  const scale = instance.width / posture.size.width;
  return {
    originX: instance.x - posture.anchor.x * scale,
    originY: instance.y - posture.anchor.y * scale,
    scale,
    width: posture.size.width * scale,
    height: posture.size.height * scale,
    anchorX: posture.anchor.x / posture.size.width,
    anchorY: posture.anchor.y / posture.size.height,
  };
}

export interface PlacedLayer {
  role: CharacterLayerRole;
  variant?: string;
  file: string;
  /** 相对姿态局部原点的坐标（渲染时再加上 frame.originX / originY）。 */
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

/** 按当前姿态 / 眼睛 / 嘴型挑出应绘制的层，并按显示缩放换算局部坐标。 */
export function resolveCharacterLayers(
  instance: Pick<CharacterPlacement, 'width'>,
  posture: CharacterPostureDef,
  eyeState: EyeState,
  mouthState: MouthState,
): PlacedLayer[] {
  const scale = instance.width / posture.size.width;
  const selected = posture.layers
    .filter((layer) => {
      if (layer.role === 'body' || layer.role === 'head') return true;
      if (layer.role === 'eyes') return layer.variant === eyeState;
      return layer.variant === mouthState;
    })
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex);

  return selected.map((layer) => ({
    role: layer.role,
    ...(layer.variant ? { variant: layer.variant } : {}),
    file: layer.file,
    x: layer.box.x * scale,
    y: layer.box.y * scale,
    width: layer.box.width * scale,
    height: layer.box.height * scale,
    zIndex: layer.zIndex,
  }));
}

/**
 * 确定性嘴型状态：不说话恒闭嘴；说话时按整数帧循环三种状态。
 * 不依赖上一帧、不使用随机数、可任意跳帧，预览与导出结果必然一致。
 */
export function mouthStateAtFrame(
  frame: number,
  speaking: boolean,
  cycleFrames: number = MOUTH_CYCLE_FRAMES,
): MouthState {
  if (!speaking) return 'closed';
  const cycle = Math.max(3, Math.floor(cycleFrames));
  const normalized = ((Math.floor(frame) % cycle) + cycle) % cycle;
  const step = Math.floor((normalized * 3) / cycle);
  if (step <= 0) return 'closed';
  if (step === 1) return 'open_small';
  return 'open_large';
}
