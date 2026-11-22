import { describe, expect, it } from 'vitest';
import { MAX_STAGE_OBJECTS } from '../constants';
import { assetIndexSchema, assetSchema } from './asset';
import { stageDataSchema, stageObjectSchema, stageSceneSchema } from './stage';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

const validAsset = {
  id: 'prop-sofa',
  kind: 'prop',
  name: '沙发',
  file: 'props/sofa.svg',
  width: 300,
  height: 160,
  category: '家具',
};

describe('assetSchema', () => {
  it('合法素材通过，锚点默认底部中心', () => {
    const parsed = assetSchema.parse(validAsset);
    expect(parsed.anchorX).toBe(0.5);
    expect(parsed.anchorY).toBe(1);
  });

  it('拒绝路径穿越与绝对路径', () => {
    for (const file of ['../secret.svg', 'props/../../secret.svg', '/etc/passwd.svg', 'C:/x.svg']) {
      expect(assetSchema.safeParse({ ...validAsset, file }).success).toBe(false);
    }
  });

  it('拒绝非 SVG 文件与非法尺寸', () => {
    expect(assetSchema.safeParse({ ...validAsset, file: 'props/sofa.png' }).success).toBe(false);
    expect(assetSchema.safeParse({ ...validAsset, width: 0 }).success).toBe(false);
  });

  it('拒绝越界锚点与未知素材类型', () => {
    expect(assetSchema.safeParse({ ...validAsset, anchorX: 1.5 }).success).toBe(false);
    expect(assetSchema.safeParse({ ...validAsset, kind: 'audio' }).success).toBe(false);
  });
});

describe('assetIndexSchema', () => {
  it('拒绝重复素材 ID', () => {
    const result = assetIndexSchema.safeParse({
      version: 1,
      assets: [validAsset, { ...validAsset, file: 'props/other.svg' }],
    });
    expect(result.success).toBe(false);
  });

  it('合法索引通过', () => {
    expect(assetIndexSchema.safeParse({ version: 1, assets: [validAsset] }).success).toBe(true);
  });
});

describe('stageDataSchema 向后兼容', () => {
  it('能解析阶段 1 写入的 { projectId, scenes: [] }', () => {
    const parsed = stageDataSchema.parse({ projectId: PROJECT_ID, scenes: [] });
    expect(parsed).toEqual({ projectId: PROJECT_ID, version: 0, activeSceneId: null, scenes: [] });
  });

  it('拒绝非法 projectId', () => {
    expect(stageDataSchema.safeParse({ projectId: 'not-a-uuid', scenes: [] }).success).toBe(false);
  });
});

describe('stageObjectSchema', () => {
  const base = {
    id: 'obj-1',
    assetId: 'prop-sofa',
    name: '沙发',
    x: 540,
    y: 1600,
    width: 300,
    height: 160,
    zIndex: 0,
  };

  it('补齐 rotation 与 visible 默认值', () => {
    expect(stageObjectSchema.parse(base)).toMatchObject({ rotation: 0, visible: true });
  });

  it('拒绝非有限坐标（防止落盘 NaN 破坏 JSON）', () => {
    expect(stageObjectSchema.safeParse({ ...base, x: Number.NaN }).success).toBe(false);
    expect(stageObjectSchema.safeParse({ ...base, y: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('拒绝负数尺寸、负图层与超大旋转', () => {
    expect(stageObjectSchema.safeParse({ ...base, width: -1 }).success).toBe(false);
    expect(stageObjectSchema.safeParse({ ...base, zIndex: -1 }).success).toBe(false);
    expect(stageObjectSchema.safeParse({ ...base, rotation: 999 }).success).toBe(false);
  });
});

describe('stageSceneSchema', () => {
  it('背景可为空，并限制对象数量', () => {
    expect(stageSceneSchema.parse({ id: 'scene-1', name: '场景 1', objects: [] }).backgroundAssetId).toBeNull();
    const tooMany = Array.from({ length: MAX_STAGE_OBJECTS + 1 }, (_, index) => ({
      id: `o${index}`,
      assetId: 'prop-sofa',
      name: '沙发',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: index,
    }));
    expect(stageSceneSchema.safeParse({ id: 's', name: 's', objects: tooMany }).success).toBe(false);
  });
});
