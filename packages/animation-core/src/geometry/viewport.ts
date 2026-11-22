/**
 * 画布视口与坐标几何（架构 4 节 animation-core/geometry）。
 *
 * 该模块是纯函数：不依赖 React、PixiJS、DOM 或浏览器时钟，
 * 供 PixiJS 预览适配层与后续 Remotion 导出适配层共用，
 * 保证「屏幕坐标 <-> 画布逻辑坐标」只有一套实现。
 *
 * 坐标约定：
 * - 逻辑坐标系：画布固定 1080 × 1920，原点在画布左上角，单位为逻辑像素。
 * - 屏幕坐标系：画布容器（DOM 元素）左上角为原点，单位为 CSS 像素。
 * - Viewport 表示 stage 变换：screen = logical * scale + offset。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** 先缩放、后平移的仿射变换。offset 是逻辑原点在屏幕上的位置。 */
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 命中测试所需的最小对象描述，避免几何模块反向依赖具体数据 Schema。 */
export interface HitTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  visible: boolean;
  zIndex: number;
}

export const DEFAULT_MIN_SCALE = 0.05;
export const DEFAULT_MAX_SCALE = 2;
export const DEFAULT_FIT_PADDING = 32;
export const DEFAULT_SAFE_AREA_RATIO = 0.05;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 「适应窗口」：按较短边等比缩放，禁止拉伸，居中放置。
 * 容器过小或 padding 过大时退化为最小缩放，不会产生负尺寸。
 */
export function fitViewport(
  container: Size,
  logical: Size,
  padding: number = DEFAULT_FIT_PADDING,
  minScale: number = DEFAULT_MIN_SCALE,
  maxScale: number = DEFAULT_MAX_SCALE,
): Viewport {
  const availableWidth = Math.max(1, container.width - padding * 2);
  const availableHeight = Math.max(1, container.height - padding * 2);
  const raw = Math.min(availableWidth / logical.width, availableHeight / logical.height);
  const scale = clamp(raw, minScale, maxScale);
  return centerViewport(container, logical, scale);
}

/** 保持给定缩放比例，把逻辑画布在容器中居中。 */
export function centerViewport(container: Size, logical: Size, scale: number): Viewport {
  return {
    scale,
    offsetX: (container.width - logical.width * scale) / 2,
    offsetY: (container.height - logical.height * scale) / 2,
  };
}

export function screenToLogical(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.offsetX) / viewport.scale,
    y: (point.y - viewport.offsetY) / viewport.scale,
  };
}

export function logicalToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.offsetX,
    y: point.y * viewport.scale + viewport.offsetY,
  };
}

/**
 * 以屏幕锚点为中心缩放：缩放前后该屏幕点对应的逻辑坐标保持不变。
 * 这是画布滚轮缩放不「跑偏」的关键，必须由纯函数保证并可测试。
 */
export function zoomAt(
  viewport: Viewport,
  factor: number,
  anchor: Point,
  minScale: number = DEFAULT_MIN_SCALE,
  maxScale: number = DEFAULT_MAX_SCALE,
): Viewport {
  const nextScale = clamp(viewport.scale * factor, minScale, maxScale);
  const ratio = nextScale / viewport.scale;
  return {
    scale: nextScale,
    offsetX: anchor.x - (anchor.x - viewport.offsetX) * ratio,
    offsetY: anchor.y - (anchor.y - viewport.offsetY) * ratio,
  };
}

export function panViewport(viewport: Viewport, dx: number, dy: number): Viewport {
  return { scale: viewport.scale, offsetX: viewport.offsetX + dx, offsetY: viewport.offsetY + dy };
}

/** 安全区辅助线矩形（PRD 7.4）。ratio 为四边留白占画布宽/高的比例。 */
export function safeAreaRect(
  logical: Size,
  ratio: number = DEFAULT_SAFE_AREA_RATIO,
): Rect {
  const clamped = clamp(ratio, 0, 0.45);
  const marginX = logical.width * clamped;
  const marginY = logical.height * clamped;
  return {
    x: marginX,
    y: marginY,
    width: logical.width - marginX * 2,
    height: logical.height - marginY * 2,
  };
}

/** 对象包围盒：x/y 是锚点位置，anchor 为素材内归一化锚点。 */
export function objectBounds(target: Pick<HitTarget, 'x' | 'y' | 'width' | 'height' | 'anchorX' | 'anchorY'>): Rect {
  return {
    x: target.x - target.anchorX * target.width,
    y: target.y - target.anchorY * target.height,
    width: target.width,
    height: target.height,
  };
}

/**
 * 把对象锚点约束在画布内，保证整个包围盒可见。
 * 对象比画布还大时退化为画布中心，避免 min > max 产生 NaN。
 */
export function clampObjectPosition(
  point: Point,
  logical: Size,
  objectSize: Size,
  anchor: Pick<HitTarget, 'anchorX' | 'anchorY'>,
): Point {
  const minX = anchor.anchorX * objectSize.width;
  const maxX = logical.width - (1 - anchor.anchorX) * objectSize.width;
  const minY = anchor.anchorY * objectSize.height;
  const maxY = logical.height - (1 - anchor.anchorY) * objectSize.height;
  return {
    x: maxX >= minX ? clamp(point.x, minX, maxX) : logical.width / 2,
    y: maxY >= minY ? clamp(point.y, minY, maxY) : logical.height / 2,
  };
}

export function isPointInCanvas(point: Point, logical: Size): boolean {
  return point.x >= 0 && point.x <= logical.width && point.y >= 0 && point.y <= logical.height;
}

/**
 * 从最上层往下命中测试。返回命中的对象 id，未命中返回 null。
 * 不修改传入数组（内部复制后再排序）。
 */
export function hitTest(point: Point, targets: readonly HitTarget[]): string | null {
  const ordered = targets
    .filter((target) => target.visible)
    .slice()
    .sort((a, b) => b.zIndex - a.zIndex);
  for (const target of ordered) {
    const bounds = objectBounds(target);
    if (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    ) {
      return target.id;
    }
  }
  return null;
}
