/**
 * Remotion 导出的输入契约（架构 8 节：预览与导出共用动画核心）。
 *
 * 所有画面状态都由服务端用 `@animation/animation-core` 的 `getStateAtFrame`、
 * `characterFrame`、`resolveCharacterLayers` 预计算成「绘制指令」，
 * Remotion 只负责把指令画成视频帧，不实现第二套动画逻辑。
 *
 * 本文件只含类型、常量与纯函数，不 import 任何 workspace 包，
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

export interface SubtitleView {
  text: string;
  characterName: string;
  /** 服务端预计算好的断行结果；Remotion 只绘制，不实现第二套排版逻辑。 */
  lines: string[];
  /** 行高（逻辑像素）：泰文更大，给上下标元音与声调符号留空间。 */
  lineHeight: number;
  /** 排版语言，决定字体栈与断行方式。 */
  language: 'zh' | 'th';
}

/** 一层完整画面：背景 + 图层 + 字幕。转场时「上一场景定格」与当前画面各占一层。 */
export interface RenderFrameVisual {
  /** 该帧所属场景的背景素材 key；null 表示无背景。 */
  background: string | null;
  /** 道具与人物已按统一 zIndex 排好序，顺序与工作台预览完全一致。 */
  layers: RenderLayer[];
  subtitle: SubtitleView | null;
}

export interface RenderFrame extends RenderFrameVisual {
  /**
   * 场景间交叉淡化：previous 是上一场景最后一帧的定格画面，
   * opacity 是当前场景画面的不透明度（previous 用 1 - opacity）。
   * 转场不额外占用帧，只叠加在目标场景开头的前 N 帧。
   */
  transition?: {
    previous: RenderFrameVisual;
    opacity: number;
  } | null;
}

/**
 * 帧块：连续若干个画面完全相同的视频帧合并为一块。
 * inputProps 的体积因此与「画面状态变化次数」相关，而不是与总帧数线性相关
 * （嘴型循环、字幕切换、转场淡入才会产生新块）。
 */
export interface RenderFrameChunk {
  /** 起始视频帧（含）。 */
  fromFrame: number;
  /** 结束视频帧（不含）。 */
  toFrame: number;
  frame: RenderFrame;
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
  /** key → data:image/svg+xml;base64,...；包含所有导出场景用到的素材。 */
  assets: Record<string, string>;
  /** 按 fromFrame 升序排列的帧块；覆盖 [0, durationInFrames)。 */
  frameChunks: RenderFrameChunk[];
}

/**
 * 按视频帧号取绘制指令（二分查找）。
 * 越界时钳到首 / 末帧块，保证任意帧都有确定画面；无帧块时返回 null。
 */
export function frameAtFrame(props: CompositionProps, frame: number): RenderFrame | null {
  const chunks = props.frameChunks;
  if (chunks.length === 0) return null;
  if (!Number.isFinite(frame) || frame < chunks[0].fromFrame) return chunks[0].frame;

  let low = 0;
  let high = chunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const chunk = chunks[middle];
    if (frame < chunk.fromFrame) {
      high = middle - 1;
    } else if (frame >= chunk.toFrame) {
      low = middle + 1;
    } else {
      return chunk.frame;
    }
  }
  // 越界或落在块间空隙时取最接近的前一个块（等价于旧逐帧数组的钳制规则）。
  const fallback = Math.max(0, Math.min(chunks.length - 1, low - 1));
  return chunks[fallback].frame;
}
