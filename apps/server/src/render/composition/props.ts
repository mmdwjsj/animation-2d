/**
 * Remotion 导出的输入契约（架构 8 节：预览与导出共用动画核心）。
 *
 * 所有画面状态都由服务端用 `@animation/animation-core` 的 `getStateAtFrame`、
 * `characterFrame`、`resolveCharacterLayers` 预计算成「绘制指令」，
 * Remotion 只负责把指令画成视频帧，不实现第二套动画逻辑。
 *
 * 本文件只含类型与常量，不 import 任何 workspace 包，
 * 保证 Remotion webpack bundle 可以独立打包。
 */

/** 导出 composition 的固定 ID，供 getCompositions 精确定位。 */
export const COMPOSITION_ID = 'AnimationExport';

/** 逻辑画布恒为 1080 × 1920，分辨率设置只改变输出 scale。 */
export const LOGICAL_WIDTH = 1080;
export const LOGICAL_HEIGHT = 1920;

export interface RenderLayer {
  /** assets 映射里的 key，值为 SVG 的 data URI。 */
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 旋转中心与角度，与 PixiJS 预览的 sprite.anchor 一致。人物层恒为 0。 */
  rotation: number;
  anchorX: number;
  anchorY: number;
}

export interface RenderFrame {
  /** 道具与人物已按统一 zIndex 排好序，顺序与工作台预览完全一致。 */
  layers: RenderLayer[];
  subtitle: { text: string; characterName: string } | null;
}

export interface CompositionProps {
  /** 允许 Remotion 的 Record<string, unknown> 约束；显式字段仍保留精确类型。 */
  [key: string]: unknown;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  logicalWidth: number;
  logicalHeight: number;
  /** key → data:image/svg+xml;base64,... */
  assets: Record<string, string>;
  background: string | null;
  /** 按导出帧率逐帧预计算的绘制指令。 */
  frames: RenderFrame[];
}
