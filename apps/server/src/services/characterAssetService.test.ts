import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetService } from './assetService';

const roots: string[] = [];

const FULL_BOX = { x: 0, y: 0, width: 360, height: 600 };

function layers() {
  return [
    { role: 'body', file: 'standing/body.svg', box: FULL_BOX, zIndex: 0 },
    { role: 'head', file: 'standing/head.svg', box: FULL_BOX, zIndex: 1 },
    { role: 'eyes', variant: 'open', file: 'faces/eyes_open.svg', box: FULL_BOX, zIndex: 2 },
    { role: 'eyes', variant: 'closed', file: 'faces/eyes_closed.svg', box: FULL_BOX, zIndex: 2 },
    { role: 'mouth', variant: 'closed', file: 'faces/mouth_closed.svg', box: FULL_BOX, zIndex: 3 },
    { role: 'mouth', variant: 'open_small', file: 'faces/mouth_open_small.svg', box: FULL_BOX, zIndex: 3 },
    { role: 'mouth', variant: 'open_large', file: 'faces/mouth_open_large.svg', box: FULL_BOX, zIndex: 3 },
  ];
}

function descriptor() {
  const posture = (anchorY: number) => ({
    size: { width: 360, height: 600 },
    anchor: { x: 180, y: anchorY },
    layers: layers(),
  });
  return { id: 'char-old-wang', name: '老王', version: 1, postures: { standing: posture(600), sitting: posture(580) } };
}

const index = {
  version: 1,
  assets: [
    {
      id: 'char-old-wang',
      kind: 'character',
      name: '老王',
      file: 'characters/old-wang/character.json',
      width: 360,
      height: 600,
      category: '角色',
    },
  ],
};

const LAYER_FILES = [
  'standing/body.svg',
  'standing/head.svg',
  'faces/eyes_open.svg',
  'faces/eyes_closed.svg',
  'faces/mouth_closed.svg',
  'faces/mouth_open_small.svg',
  'faces/mouth_open_large.svg',
];

function createFixture(options: { descriptorValue?: unknown; skipLayers?: string[]; skipDescriptor?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-character-assets-'));
  roots.push(root);
  const base = path.join(root, 'characters', 'old-wang');
  mkdirSync(base, { recursive: true });
  writeFileSync(path.join(root, 'index.json'), JSON.stringify(index), 'utf8');
  if (!options.skipDescriptor) {
    writeFileSync(
      path.join(base, 'character.json'),
      JSON.stringify(options.descriptorValue ?? descriptor()),
      'utf8',
    );
  }
  for (const file of LAYER_FILES) {
    if (options.skipLayers?.includes(file)) continue;
    const full = path.join(base, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="600"/>`, 'utf8');
  }
  return root;
}

afterEach(() => {
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响测试结果
    }
  }
  roots.length = 0;
});

describe('AssetService 分层人物素材', () => {
  it('读取并校验描述文件，返回两姿态与锚点', () => {
    const service = new AssetService(createFixture());
    const list = service.listCharacters();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('char-old-wang');
    expect(list[0].descriptor.postures.standing.anchor.y).toBe(600);
    expect(list[0].descriptor.postures.sitting.anchor.y).toBe(580);
    expect(service.hasCharacter('char-old-wang')).toBe(true);
    expect(service.getCharacter('char-old-wang').name).toBe('老王');
    expect(service.list()).toHaveLength(1);
  });

  it('分层文件按白名单读取，未经声明的路径一律拒绝', () => {
    const service = new AssetService(createFixture());
    const { content } = service.readLayer('char-old-wang', 'standing/body');
    expect(content.toString('utf8')).toContain('<svg');
    expect(() => service.readLayer('char-old-wang', '../../index.json')).toThrow(/未声明/);
    expect(() => service.readLayer('char-old-wang', 'standing/not-exist')).toThrow(/未声明/);
    expect(() => service.readLayer('not-exist', 'standing/body')).toThrow(/人物素材不存在/);
    expect(() => service.readFile('char-old-wang')).toThrow(/分层素材接口/);
  });

  it('真实缺失检测覆盖描述文件与每个分层文件', () => {
    expect(new AssetService(createFixture()).checkMissing()).toEqual({ total: 1, missing: [] });

    const withMissingLayer = new AssetService(
      createFixture({ skipLayers: ['faces/mouth_open_large.svg'] }),
    );
    expect(withMissingLayer.checkMissing().missing).toEqual([
      'char-old-wang:characters/old-wang/faces/mouth_open_large.svg',
    ]);
    expect(() => withMissingLayer.readLayer('char-old-wang', 'faces/mouth_open_large')).toThrow(
      /分层素材文件缺失/,
    );

    const noDescriptor = new AssetService(createFixture({ skipDescriptor: true }));
    expect(noDescriptor.listCharacters()).toEqual([]);
    expect(noDescriptor.checkMissing().missing).toContain('char-old-wang:character.json');
    expect(() => noDescriptor.getCharacter('char-old-wang')).toThrow(/人物素材不可用/);
  });

  it('描述文件缺层或 id 不匹配时不影响其他素材加载，且如实上报', () => {
    const broken = descriptor();
    broken.postures.standing.layers = broken.postures.standing.layers.filter(
      (layer) => !(layer.role === 'mouth' && layer.variant === 'open_large'),
    );
    const service = new AssetService(createFixture({ descriptorValue: broken }));
    expect(service.listCharacters()).toEqual([]);
    expect(service.checkMissing().missing).toContain('char-old-wang:character.json');

    const wrongId = new AssetService(
      createFixture({ descriptorValue: { ...descriptor(), id: 'other' } }),
    );
    expect(wrongId.listCharacters()).toEqual([]);
  });
});
