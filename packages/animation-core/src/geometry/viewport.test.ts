import { describe, expect, it } from 'vitest';
import {
  centerViewport,
  clamp,
  clampObjectPosition,
  fitViewport,
  hitTest,
  isPointInCanvas,
  logicalToScreen,
  objectBounds,
  panViewport,
  safeAreaRect,
  screenToLogical,
  zoomAt,
  type HitTarget,
  type Size,
} from './viewport';

const LOGICAL: Size = { width: 1080, height: 1920 };
const CONTAINER: Size = { width: 800, height: 900 };

function target(overrides: Partial<HitTarget> = {}): HitTarget {
  return {
    id: 'obj-1',
    x: 540,
    y: 1600,
    width: 300,
    height: 160,
    anchorX: 0.5,
    anchorY: 1,
    visible: true,
    zIndex: 0,
    ...overrides,
  };
}

describe('clamp', () => {
  it('限制在闭区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('非有限值退化为下界，不产生 NaN 视口', () => {
    expect(clamp(Number.NaN, 0.05, 2)).toBe(0.05);
  });
});

describe('fitViewport 适应窗口', () => {
  it('按较短边等比缩放，9:16 不被拉伸', () => {
    const viewport = fitViewport(CONTAINER, LOGICAL, 32);
    expect(viewport.scale).toBeCloseTo((900 - 64) / 1920, 6);
  });

  it('缩放后画布完整落在容器内并居中', () => {
    const viewport = fitViewport(CONTAINER, LOGICAL, 32);
    const origin = logicalToScreen({ x: 0, y: 0 }, viewport);
    const bottomRight = logicalToScreen({ x: 1080, y: 1920 }, viewport);
    expect(origin.x).toBeGreaterThanOrEqual(0);
    expect(origin.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(CONTAINER.width);
    expect(bottomRight.y).toBeLessThanOrEqual(CONTAINER.height);
    expect(origin.x).toBeCloseTo(CONTAINER.width - bottomRight.x, 6);
    expect(origin.y).toBeCloseTo(CONTAINER.height - bottomRight.y, 6);
  });

  it('宽容器改为受高度约束', () => {
    const viewport = fitViewport({ width: 2000, height: 1000 }, LOGICAL, 0);
    expect(viewport.scale).toBeCloseTo(1000 / 1920, 6);
  });

  it('极小容器不会得到负尺寸或超过最大缩放', () => {
    const viewport = fitViewport({ width: 10, height: 10 }, LOGICAL, 32);
    expect(viewport.scale).toBeGreaterThanOrEqual(0.05);
    expect(Number.isFinite(viewport.offsetX)).toBe(true);
    expect(Number.isFinite(viewport.offsetY)).toBe(true);
  });

  it('遵守传入的缩放上下界', () => {
    const viewport = fitViewport({ width: 20000, height: 20000 }, LOGICAL, 0, 0.1, 1.5);
    expect(viewport.scale).toBe(1.5);
  });
});

describe('坐标往返转换', () => {
  it('screenToLogical 与 logicalToScreen 互逆', () => {
    const viewport = fitViewport(CONTAINER, LOGICAL, 24);
    for (const point of [
      { x: 0, y: 0 },
      { x: 540, y: 960 },
      { x: 1080, y: 1920 },
      { x: 137.5, y: 1811.25 },
    ]) {
      const back = screenToLogical(logicalToScreen(point, viewport), viewport);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it('平移后同一逻辑点的屏幕位置按位移变化', () => {
    const viewport = centerViewport(CONTAINER, LOGICAL, 0.4);
    const panned = panViewport(viewport, 30, -20);
    const before = logicalToScreen({ x: 500, y: 500 }, viewport);
    const after = logicalToScreen({ x: 500, y: 500 }, panned);
    expect(after.x - before.x).toBeCloseTo(30, 6);
    expect(after.y - before.y).toBeCloseTo(-20, 6);
  });
});

describe('zoomAt 以锚点缩放', () => {
  it('放大/缩小时锚点对应的逻辑坐标保持不变', () => {
    const base = fitViewport(CONTAINER, LOGICAL, 24);
    const anchor = { x: 321, y: 456 };
    const logicalBefore = screenToLogical(anchor, base);
    for (const factor of [1.2, 0.8, 2.5, 0.4]) {
      const next = zoomAt(base, factor, anchor);
      const logicalAfter = screenToLogical(anchor, next);
      expect(logicalAfter.x).toBeCloseTo(logicalBefore.x, 6);
      expect(logicalAfter.y).toBeCloseTo(logicalBefore.y, 6);
    }
  });

  it('连续缩放累积结果与锚点保持一致', () => {
    const anchor = { x: 200, y: 300 };
    let viewport = fitViewport(CONTAINER, LOGICAL, 24);
    const original = screenToLogical(anchor, viewport);
    for (let i = 0; i < 8; i += 1) viewport = zoomAt(viewport, 1.15, anchor);
    const result = screenToLogical(anchor, viewport);
    expect(result.x).toBeCloseTo(original.x, 6);
    expect(result.y).toBeCloseTo(original.y, 6);
  });

  it('缩放被限制在上下界内', () => {
    const base = fitViewport(CONTAINER, LOGICAL, 24);
    expect(zoomAt(base, 1000, { x: 0, y: 0 }).scale).toBe(2);
    expect(zoomAt(base, 0.00001, { x: 0, y: 0 }).scale).toBe(0.05);
  });
});

describe('安全区与画布边界', () => {
  it('安全区四边等比例留白且居中', () => {
    const rect = safeAreaRect(LOGICAL, 0.05);
    expect(rect.x).toBeCloseTo(54, 6);
    expect(rect.width).toBeCloseTo(972, 6);
    expect(rect.y).toBeCloseTo(96, 6);
    expect(rect.height).toBeCloseTo(1728, 6);
  });

  it('比例被限制，不会产生负尺寸矩形', () => {
    const rect = safeAreaRect(LOGICAL, 5);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it('isPointInCanvas 判断边界包含端点', () => {
    expect(isPointInCanvas({ x: 0, y: 0 }, LOGICAL)).toBe(true);
    expect(isPointInCanvas({ x: 1080, y: 1920 }, LOGICAL)).toBe(true);
    expect(isPointInCanvas({ x: 1081, y: 100 }, LOGICAL)).toBe(false);
  });
});

describe('objectBounds 与 clampObjectPosition', () => {
  it('底部中心锚点的包围盒计算正确', () => {
    expect(objectBounds(target())).toEqual({ x: 390, y: 1440, width: 300, height: 160 });
  });

  it('把越界对象约束回画布内且保持包围盒可见', () => {
    const result = clampObjectPosition(
      { x: -500, y: 9999 },
      LOGICAL,
      { width: 300, height: 160 },
      { anchorX: 0.5, anchorY: 1 },
    );
    const bounds = objectBounds({ ...target(), ...result });
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(LOGICAL.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(LOGICAL.height);
  });

  it('对象大于画布时退化为画布中心，不产生 NaN', () => {
    const result = clampObjectPosition(
      { x: 1, y: 1 },
      LOGICAL,
      { width: 2000, height: 3000 },
      { anchorX: 0.5, anchorY: 1 },
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    expect(result.x).toBeCloseTo(540, 6);
  });
});

describe('hitTest 命中测试', () => {
  it('命中包围盒内的点', () => {
    expect(hitTest({ x: 500, y: 1500 }, [target()])).toBe('obj-1');
  });

  it('空白返回 null', () => {
    expect(hitTest({ x: 0, y: 0 }, [target()])).toBeNull();
  });

  it('重叠时优先命中 zIndex 更大的对象', () => {
    const lower = target({ id: 'lower', zIndex: 1 });
    const upper = target({ id: 'upper', zIndex: 5 });
    expect(hitTest({ x: 500, y: 1500 }, [lower, upper])).toBe('upper');
  });

  it('隐藏对象不可命中', () => {
    expect(hitTest({ x: 500, y: 1500 }, [target({ visible: false })])).toBeNull();
  });

  it('边界点算命中，且不修改输入数组顺序', () => {
    const targets = [target({ id: 'a', zIndex: 0 }), target({ id: 'b', zIndex: 2 })];
    expect(hitTest({ x: 390, y: 1440 }, targets)).toBe('b');
    expect(targets.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('确定性', () => {
  it('相同输入多次调用结果完全一致', () => {
    const a = fitViewport(CONTAINER, LOGICAL, 24);
    const b = fitViewport(CONTAINER, LOGICAL, 24);
    expect(a).toEqual(b);
    expect(zoomAt(a, 1.2, { x: 100, y: 100 })).toEqual(zoomAt(b, 1.2, { x: 100, y: 100 }));
  });
});
