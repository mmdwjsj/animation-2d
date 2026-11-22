import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetService } from './assetService';

const roots: string[] = [];

const validIndex = {
  version: 1,
  assets: [
    {
      id: 'prop-sofa',
      kind: 'prop',
      name: '沙发',
      file: 'props/sofa.svg',
      width: 320,
      height: 180,
      category: '家具',
    },
    {
      id: 'scene-living-room',
      kind: 'scene',
      name: '客厅',
      file: 'scenes/living-room.svg',
      width: 1080,
      height: 1920,
      category: '室内',
    },
  ],
};

function createFixture(index: unknown = validIndex, files: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-assets-'));
  roots.push(root);
  writeFileSync(path.join(root, 'index.json'), JSON.stringify(index), 'utf8');
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
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

describe('AssetService', () => {
  it('读取真实索引并按类型过滤，锚点默认底部中心', () => {
    const service = new AssetService(createFixture());
    expect(service.list()).toHaveLength(2);
    expect(service.list('prop').map((item) => item.id)).toEqual(['prop-sofa']);
    expect(service.list('character')).toEqual([]);
    expect(service.get('prop-sofa').anchorY).toBe(1);
    expect(service.has('prop-sofa')).toBe(true);
  });

  it('按白名单读取素材文件内容', () => {
    const root = createFixture(validIndex, { 'props/sofa.svg': '<svg>sofa</svg>' });
    const { asset, content } = new AssetService(root).readFile('prop-sofa');
    expect(asset.name).toBe('沙发');
    expect(content.toString('utf8')).toContain('<svg>');
  });

  it('未知素材或文件缺失返回 ASSET_NOT_FOUND，并给出真实缺失清单', () => {
    const service = new AssetService(createFixture());
    expect(() => service.readFile('not-exist')).toThrow(/素材不存在/);
    expect(service.checkMissing().missing).toEqual(['prop-sofa', 'scene-living-room']);
    expect(service.checkMissing().total).toBe(2);
  });

  it('文件补齐后缺失清单清空', () => {
    const root = createFixture(validIndex, {
      'props/sofa.svg': '<svg/>',
      'scenes/living-room.svg': '<svg/>',
    });
    expect(new AssetService(root).checkMissing().missing).toEqual([]);
  });

  it('索引含路径穿越时构造失败，不加载素材库', () => {
    const bad = {
      version: 1,
      assets: [{ ...validIndex.assets[0], file: '../secret.svg' }],
    };
    expect(() => new AssetService(createFixture(bad))).toThrow(/素材索引校验失败/);
  });

  it('索引重复 ID 时构造失败', () => {
    const bad = { version: 1, assets: [validIndex.assets[0], validIndex.assets[0]] };
    expect(() => new AssetService(createFixture(bad))).toThrow(/素材索引校验失败/);
  });
});
