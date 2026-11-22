import { describe, expect, it } from 'vitest';
import { MAX_CHARACTERS_PER_SCENE } from '../constants';
import {
  characterDescriptorSchema,
  characterInstanceSchema,
  characterPostureSchema,
  type CharacterLayer,
} from './character';
import { assetSchema } from './asset';
import { stageSceneSchema } from './stage';

const FULL_BOX = { x: 0, y: 0, width: 360, height: 600 };

function makeLayers(directory: string): CharacterLayer[] {
  const box = FULL_BOX;
  return [
    { role: 'body', file: `${directory}/body.svg`, box, zIndex: 0 },
    { role: 'head', file: `${directory}/head.svg`, box, zIndex: 1 },
    { role: 'eyes', variant: 'open', file: 'faces/eyes_open.svg', box, zIndex: 2 },
    { role: 'eyes', variant: 'closed', file: 'faces/eyes_closed.svg', box, zIndex: 2 },
    { role: 'mouth', variant: 'closed', file: 'faces/mouth_closed.svg', box, zIndex: 3 },
    { role: 'mouth', variant: 'open_small', file: 'faces/mouth_open_small.svg', box, zIndex: 3 },
    { role: 'mouth', variant: 'open_large', file: 'faces/mouth_open_large.svg', box, zIndex: 3 },
  ];
}

function makePosture(anchorY = 600) {
  return {
    size: { width: 360, height: 600 },
    anchor: { x: 180, y: anchorY },
    layers: makeLayers('standing'),
  };
}

function makeDescriptor() {
  return {
    id: 'char-old-wang',
    name: '老王',
    version: 1,
    postures: {
      standing: makePosture(600),
      sitting: makePosture(580),
    },
  };
}

describe('characterDescriptorSchema', () => {
  it('合法描述文件通过，两姿态锚点可不同', () => {
    const parsed = characterDescriptorSchema.parse(makeDescriptor());
    expect(parsed.postures.standing.anchorLabel).toBe('脚底中心');
    expect(parsed.postures.sitting.anchor.y).toBe(580);
    expect(parsed.postures.standing.layers).toHaveLength(7);
  });

  it('缺少任一层变体时拒绝，避免运行时静默降级', () => {
    const descriptor = makeDescriptor();
    descriptor.postures.standing.layers = descriptor.postures.standing.layers.filter(
      (layer) => !(layer.role === 'mouth' && layer.variant === 'open_large'),
    );
    expect(characterDescriptorSchema.safeParse(descriptor).success).toBe(false);
  });

  it('锚点越界、层超出画布、重复层定义均拒绝', () => {
    expect(
      characterPostureSchema.safeParse({ ...makePosture(), anchor: { x: 400, y: 600 } }).success,
    ).toBe(false);

    const outOfBox = makePosture();
    outOfBox.layers[0].box = { x: 300, y: 0, width: 200, height: 600 };
    expect(characterPostureSchema.safeParse(outOfBox).success).toBe(false);

    const duplicated = makePosture();
    duplicated.layers.push({ ...duplicated.layers[0] });
    expect(characterPostureSchema.safeParse(duplicated).success).toBe(false);
  });

  it('层文件路径拒绝穿越与非 SVG', () => {
    const bad = makePosture();
    bad.layers[0].file = '../../secret.svg';
    expect(characterPostureSchema.safeParse(bad).success).toBe(false);
    const png = makePosture();
    png.layers[0].file = 'standing/body.png';
    expect(characterPostureSchema.safeParse(png).success).toBe(false);
  });
});

describe('characterInstanceSchema', () => {
  const base = {
    id: 'char-1',
    assetId: 'char-old-wang',
    name: '老王',
    x: 540,
    y: 1600,
    width: 300,
    zIndex: 0,
  };

  it('补齐姿态、眼睛、嘴型与可见性默认值', () => {
    expect(characterInstanceSchema.parse(base)).toMatchObject({
      posture: 'standing',
      eyeState: 'open',
      mouthState: 'closed',
      visible: true,
    });
  });

  it('拒绝非法姿态 / 嘴型 / 非有限坐标', () => {
    expect(characterInstanceSchema.safeParse({ ...base, posture: 'running' }).success).toBe(false);
    expect(characterInstanceSchema.safeParse({ ...base, mouthState: 'smile' }).success).toBe(false);
    expect(characterInstanceSchema.safeParse({ ...base, x: Number.NaN }).success).toBe(false);
  });

  it('只存宽度，不存会随姿态失效的高度', () => {
    const parsed = characterInstanceSchema.parse({ ...base, height: 999 });
    expect(parsed).not.toHaveProperty('height');
  });
});

describe('阶段 3 数据兼容', () => {
  it('人物描述文件可作为素材索引条目（.json 路径）', () => {
    expect(
      assetSchema.safeParse({
        id: 'char-old-wang',
        kind: 'character',
        name: '老王',
        file: 'characters/old-wang/character.json',
        width: 360,
        height: 600,
        category: '角色',
      }).success,
    ).toBe(true);
  });

  it('阶段 2 的场景数据自动补齐空人物列表', () => {
    const scene = stageSceneSchema.parse({ id: 's', name: '场景 1', objects: [] });
    expect(scene.characters).toEqual([]);
  });

  it(`场景人物数超过 ${MAX_CHARACTERS_PER_SCENE} 个时拒绝，不静默截断`, () => {
    const characters = Array.from({ length: MAX_CHARACTERS_PER_SCENE + 1 }, (_, index) => ({
      id: `char-${index}`,
      assetId: 'char-old-wang',
      name: '老王',
      x: 0,
      y: 0,
      width: 300,
      zIndex: index,
    }));
    expect(
      stageSceneSchema.safeParse({ id: 's', name: '场景 1', objects: [], characters }).success,
    ).toBe(false);
  });
});
