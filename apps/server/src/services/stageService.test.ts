import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { AssetService } from './assetService';
import { StageService } from './stageService';

const roots: string[] = [];

const assetIndex = {
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

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-stage-'));
  roots.push(root);
  const assetsDir = path.join(root, 'assets');
  mkdirSync(path.join(assetsDir, 'props'), { recursive: true });
  mkdirSync(path.join(assetsDir, 'scenes'), { recursive: true });
  writeFileSync(path.join(assetsDir, 'index.json'), JSON.stringify(assetIndex), 'utf8');
  writeFileSync(path.join(assetsDir, 'props', 'sofa.svg'), '<svg/>', 'utf8');
  writeFileSync(path.join(assetsDir, 'scenes', 'living-room.svg'), '<svg/>', 'utf8');

  const projectsDir = path.join(root, 'data', 'projects');
  const projectId = randomUUID();
  const projectDir = path.join(projectsDir, projectId);
  mkdirSync(path.join(projectDir, 'animation'), { recursive: true });
  writeFileSync(path.join(projectDir, 'project.json'), '{}', 'utf8');
  const emptyStage = { projectId, scenes: [] };
  writeFileSync(
    path.join(projectDir, 'animation', 'animation.json'),
    JSON.stringify(emptyStage),
    'utf8',
  );

  const service = new StageService(new AssetService(assetsDir), projectsDir);
  return { service, projectId, projectDir };
}

function object(overrides: Record<string, unknown> = {}) {
  return {
    id: 'obj-1',
    assetId: 'prop-sofa',
    name: '沙发',
    x: 540,
    y: 1600,
    width: 320,
    height: 180,
    rotation: 0,
    zIndex: 0,
    visible: true,
    ...overrides,
  };
}

function payload(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    version: 0,
    activeSceneId: 'scene-default',
    scenes: [
      {
        id: 'scene-default',
        name: '场景 1',
        backgroundAssetId: 'scene-living-room',
        objects: [object()],
      },
    ],
    ...overrides,
  };
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

describe('StageService', () => {
  it('阶段 1 的空动画文件返回确定性默认场景，且 GET 不写盘', () => {
    const { service, projectId, projectDir } = createFixture();
    const stage = service.getStage(projectId);
    expect(stage.scenes).toHaveLength(1);
    expect(stage.scenes[0].name).toBe('场景 1');
    expect(stage.scenes[0].objects).toEqual([]);
    expect(stage.version).toBe(0);
    const raw = readFileSync(path.join(projectDir, 'animation', 'animation.json'), 'utf8');
    expect(raw).toBe(JSON.stringify({ projectId, scenes: [] }));
  });

  it('保存后真实落盘为逻辑坐标，版本递增且可读回', () => {
    const { service, projectId, projectDir } = createFixture();
    const saved = service.saveStage(projectId, payload(projectId));
    expect(saved.version).toBe(1);
    const reread = service.getStage(projectId);
    expect(reread.scenes[0].objects[0]).toMatchObject({ x: 540, y: 1600, assetId: 'prop-sofa' });
    const raw = JSON.parse(
      readFileSync(path.join(projectDir, 'animation', 'animation.json'), 'utf8'),
    ) as { scenes: { objects: { x: number }[] }[] };
    expect(raw.scenes[0].objects[0].x).toBe(540);
  });

  it('拒绝不存在的素材引用，不落盘悬空引用', () => {
    const { service, projectId } = createFixture();
    const bad = payload(projectId);
    (bad.scenes[0].objects[0] as Record<string, unknown>).assetId = 'prop-missing';
    expect.assertions(1);
    try {
      service.saveStage(projectId, bad);
    } catch (error) {
      expect((error as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('背景必须是场景类型素材', () => {
    const { service, projectId } = createFixture();
    const bad = payload(projectId);
    bad.scenes[0].backgroundAssetId = 'prop-sofa';
    expect(() => service.saveStage(projectId, bad)).toThrow(/非场景类型/);
  });

  it('拒绝重复对象 ID', () => {
    const { service, projectId } = createFixture();
    const bad = payload(projectId);
    bad.scenes[0].objects.push(object());
    expect(() => service.saveStage(projectId, bad)).toThrow(/重复的对象 ID/);
  });

  it('拒绝项目 ID 不一致、非法 ID 与不存在的项目', () => {
    const { service, projectId } = createFixture();
    expect(() => service.saveStage(projectId, payload(randomUUID()))).toThrow(/不一致/);
    expect(() => service.getStage('not-a-uuid')).toThrow(/格式不正确/);
    expect(() => service.getStage(randomUUID())).toThrow(/项目不存在/);
  });

  it('损坏的动画数据文件给出明确错误', () => {
    const { service, projectId, projectDir } = createFixture();
    writeFileSync(path.join(projectDir, 'animation', 'animation.json'), '{broken', 'utf8');
    expect(() => service.getStage(projectId)).toThrow(/校验失败/);
  });
});
