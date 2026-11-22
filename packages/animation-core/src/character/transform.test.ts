import { describe, expect, it } from 'vitest';
import { objectBounds } from '../geometry/viewport';
import {
  MOUTH_CYCLE_FRAMES,
  characterFrame,
  mouthStateAtFrame,
  resolveCharacterLayers,
  type CharacterLayerDef,
  type CharacterPostureDef,
} from './transform';

function makePosture(anchorY: number, headY: number): CharacterPostureDef {
  const full = { x: 0, y: 0, width: 360, height: 600 };
  const head = { x: 90, y: headY, width: 180, height: 200 };
  const face = { x: 128, y: headY + 80, width: 104, height: 34 };
  const mouth = { x: 146, y: headY + 130, width: 68, height: 40 };
  const layers: CharacterLayerDef[] = [
    { role: 'body', file: 'body.svg', box: full, zIndex: 0 },
    { role: 'head', file: 'head.svg', box: head, zIndex: 1 },
    { role: 'eyes', variant: 'open', file: 'eyes_open.svg', box: face, zIndex: 2 },
    { role: 'eyes', variant: 'closed', file: 'eyes_closed.svg', box: face, zIndex: 2 },
    { role: 'mouth', variant: 'closed', file: 'mouth_closed.svg', box: mouth, zIndex: 3 },
    { role: 'mouth', variant: 'open_small', file: 'mouth_open_small.svg', box: mouth, zIndex: 3 },
    { role: 'mouth', variant: 'open_large', file: 'mouth_open_large.svg', box: mouth, zIndex: 3 },
  ];
  return {
    size: { width: 360, height: 600 },
    anchor: { x: 180, y: anchorY },
    layers,
  };
}

const standing = makePosture(600, 20);
const sitting = makePosture(580, 120);
const instance = { x: 540, y: 1600, width: 300 };

describe('characterFrame 姿态锚点校准', () => {
  it('归一化锚点与 objectBounds 组合后，包围盒左上角就是校准后的局部原点', () => {
    const frame = characterFrame(instance, standing);
    const bounds = objectBounds({
      x: instance.x,
      y: instance.y,
      width: frame.width,
      height: frame.height,
      anchorX: frame.anchorX,
      anchorY: frame.anchorY,
    });
    expect(bounds.x).toBeCloseTo(frame.originX, 8);
    expect(bounds.y).toBeCloseTo(frame.originY, 8);
    expect(bounds.width).toBeCloseTo(300, 8);
    expect(bounds.height).toBeCloseTo(500, 8);
  });

  it('站立与坐着切换时逻辑锚点不动：脚底 / 接触点始终落在 (x, y)', () => {
    for (const posture of [standing, sitting]) {
      const frame = characterFrame(instance, posture);
      expect(frame.originX + posture.anchor.x * frame.scale).toBeCloseTo(instance.x, 8);
      expect(frame.originY + posture.anchor.y * frame.scale).toBeCloseTo(instance.y, 8);
    }
  });

  it('坐姿接触点锚点不同导致局部原点上移补偿，人物变矮但不跳', () => {
    const standFrame = characterFrame(instance, standing);
    const sitFrame = characterFrame(instance, sitting);
    expect(sitFrame.originY - standFrame.originY).toBeCloseTo(20 * sitFrame.scale, 8);
    expect(sitFrame.scale).toBeCloseTo(standFrame.scale, 8);
  });

  it('显示宽度变化时缩放线性变化，包围盒不拉伸', () => {
    const bigger = characterFrame({ ...instance, width: 600 }, standing);
    expect(bigger.scale).toBeCloseTo(600 / 360, 8);
    expect(bigger.height / bigger.width).toBeCloseTo(standing.size.height / standing.size.width, 8);
  });
});

describe('resolveCharacterLayers 分层解析', () => {
  it('每个状态只选中 body / head / 当前眼睛 / 当前嘴型四层，并按 zIndex 排序', () => {
    const layers = resolveCharacterLayers(instance, standing, 'open', 'closed');
    expect(layers.map((layer) => layer.role)).toEqual(['body', 'head', 'eyes', 'mouth']);
    expect(layers.map((layer) => layer.file)).toEqual([
      'body.svg',
      'head.svg',
      'eyes_open.svg',
      'mouth_closed.svg',
    ]);
    expect(layers.map((layer) => layer.zIndex)).toEqual([0, 1, 2, 3]);
  });

  it('层坐标按显示缩放换算（width 300 / size 360 => scale 5/6）', () => {
    const layers = resolveCharacterLayers(instance, standing, 'open', 'closed');
    const head = layers.find((layer) => layer.role === 'head');
    expect(head?.x).toBeCloseTo(90 * (300 / 360), 8);
    expect(head?.y).toBeCloseTo(20 * (300 / 360), 8);
    expect(head?.width).toBeCloseTo(180 * (300 / 360), 8);
  });

  it('嘴型切换只替换 mouth 层文件，不改变身体 / 头部 / 眼睛位置', () => {
    const base = resolveCharacterLayers(instance, standing, 'open', 'closed');
    const large = resolveCharacterLayers(instance, standing, 'open', 'open_large');
    for (let index = 0; index < base.length - 1; index += 1) {
      expect(large[index]).toEqual(base[index]);
    }
    expect(base.at(-1)?.file).toBe('mouth_closed.svg');
    expect(large.at(-1)?.file).toBe('mouth_open_large.svg');
    expect(large.at(-1)?.x).toBe(base.at(-1)?.x);
    expect(large.at(-1)?.y).toBe(base.at(-1)?.y);
  });

  it('眼睛切换只替换 eyes 层，嘴型层保持不动', () => {
    const open = resolveCharacterLayers(instance, standing, 'open', 'open_small');
    const closed = resolveCharacterLayers(instance, standing, 'closed', 'open_small');
    expect(closed.find((layer) => layer.role === 'eyes')?.file).toBe('eyes_closed.svg');
    expect(closed.find((layer) => layer.role === 'mouth')).toEqual(
      open.find((layer) => layer.role === 'mouth'),
    );
  });

  it('姿态切换后面部层相对局部原点的位置随描述文件变化，但相对头部保持一致', () => {
    const stand = resolveCharacterLayers(instance, standing, 'open', 'closed');
    const sit = resolveCharacterLayers(instance, sitting, 'open', 'closed');
    const standHead = stand.find((layer) => layer.role === 'head');
    const sitHead = sit.find((layer) => layer.role === 'head');
    const standMouth = stand.find((layer) => layer.role === 'mouth');
    const sitMouth = sit.find((layer) => layer.role === 'mouth');
    expect(sitHead!.y - standHead!.y).toBeGreaterThan(0);
    expect(sitMouth!.y - standMouth!.y).toBeCloseTo(sitHead!.y - standHead!.y, 8);
  });
});

describe('mouthStateAtFrame 确定性嘴型', () => {
  it('不说话时恒为闭嘴，与帧号无关', () => {
    for (const frame of [-100, 0, 1, 17, 9999]) {
      expect(mouthStateAtFrame(frame, false)).toBe('closed');
    }
  });

  it('说话时按 3 帧一段循环闭嘴 / 小张嘴 / 大张嘴', () => {
    const states = Array.from({ length: MOUTH_CYCLE_FRAMES }, (_, frame) =>
      mouthStateAtFrame(frame, true),
    );
    expect(states).toEqual([
      'closed',
      'closed',
      'closed',
      'open_small',
      'open_small',
      'open_small',
      'open_large',
      'open_large',
      'open_large',
    ]);
  });

  it('循环回到起点，任意跳帧结果一致，负帧也归一化', () => {
    expect(mouthStateAtFrame(MOUTH_CYCLE_FRAMES, true)).toBe('closed');
    expect(mouthStateAtFrame(1000, true)).toBe(mouthStateAtFrame(1000 % MOUTH_CYCLE_FRAMES, true));
    expect(mouthStateAtFrame(-1, true)).toBe(mouthStateAtFrame(MOUTH_CYCLE_FRAMES - 1, true));
  });

  it('自定义循环帧数仍能均匀覆盖三种状态', () => {
    const states = new Set(Array.from({ length: 12 }, (_, frame) => mouthStateAtFrame(frame, true, 12)));
    expect(states).toEqual(new Set(['closed', 'open_small', 'open_large']));
  });
});
