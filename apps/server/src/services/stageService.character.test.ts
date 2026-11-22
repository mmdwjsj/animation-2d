import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { AssetService } from './assetService';
import { StageService } from './stageService';

const roots: string[] = [];
const FULL_BOX = { x: 0, y: 0, width: 360, height: 600 };

function layerDefinitions() {
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

const descriptor = {
  id: 'char-old-wang',
  name: '老王',
  version: 1,
  postures: {
    standing: { size: { width: 360, height: 600 }, anchor: { x: 180, y: 600 }, layers: layerDefinitions() },
    sitting: { size: { width: 360, height: 600 }, anchor: { x: 180, y: 580 }, layers: layerDefinitions() },
  },
};

const index = {
  version: 1,
  assets: [
    { id: 'prop-sofa', kind: 'prop', name: '沙发', file: 'props/sofa.svg', width: 320, height: 180, category: '家具' },
    { id: 'scene-living-room', kind: 'scene', name: '客厅', file: 'scenes/living-room.svg', width: 1080, height: 1920, category: '室内' },
    { id: 'char-old-wang', kind: 'character', name: '老王', file: 'characters/old-wang/character.json', width: 360, height: 600, category: '角色' },
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

function createFixture(options: { skipDescriptor?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-stage-character-'));
  roots.push(root);
  const assetsDir = path.join(root, 'assets');
  const characterDir = path.join(assetsDir, 'characters', 'old-wang');
  mkdirSync(path.join(assetsDir, 'props'), { recursive: true });
  mkdirSync(path.join(assetsDir, 'scenes'), { recursive: true });
  mkdirSync(characterDir, { recursive: true });
  writeFileSync(path.join(assetsDir, 'index.json'), JSON.stringify(index), 'utf8');
  writeFileSync(path.join(assetsDir, 'props', 'sofa.svg'), '<svg/>', 'utf8');
  writeFileSync(path.join(assetsDir, 'scenes', 'living-room.svg'), '<svg/>', 'utf8');
  if (!options.skipDescriptor) {
    writeFileSync(path.join(characterDir, 'character.json'), JSON.stringify(descriptor), 'utf8');
    for (const file of LAYER_FILES) {
      const full = path.join(characterDir, file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, '<svg/>', 'utf8');
    }
  }

  const projectsDir = path.join(root, 'data', 'projects');
  const projectId = randomUUID();
  const projectDir = path.join(projectsDir, projectId);
  mkdirSync(path.join(projectDir, 'animation'), { recursive: true });
  writeFileSync(path.join(projectDir, 'project.json'), '{}', 'utf8');
  writeFileSync(
    path.join(projectDir, 'animation', 'animation.json'),
    JSON.stringify({ projectId, scenes: [] }),
    'utf8',
  );

  const service = new StageService(new AssetService(assetsDir), projectsDir);
  return { service, projectId, projectDir };
}

function character(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char-1',
    assetId: 'char-old-wang',
    name: '老王',
    x: 540,
    y: 1600,
    width: 300,
    posture: 'sitting',
    eyeState: 'open',
    mouthState: 'open_small',
    visible: true,
    zIndex: 0,
    ...overrides,
  };
}

function payload(projectId: string, characters: Record<string, unknown>[]) {
  return {
    projectId,
    version: 0,
    activeSceneId: 'scene-default',
    scenes: [
      {
        id: 'scene-default',
        name: '场景 1',
        backgroundAssetId: 'scene-living-room',
        objects: [],
        characters,
      },
    ],
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

describe('StageService 人物引用校验', () => {
  it('人物实例真实落盘并可读取姿态 / 嘴型 / 逻辑坐标', () => {
    const { service, projectId, projectDir } = createFixture();
    const saved = service.saveStage(projectId, payload(projectId, [character()]));
    expect(saved.scenes[0].characters).toHaveLength(1);
    const reread = service.getStage(projectId);
    expect(reread.scenes[0].characters[0]).toMatchObject({
      x: 540,
      y: 1600,
      width: 300,
      posture: 'sitting',
      mouthState: 'open_small',
    });
    const raw = JSON.parse(
      readFileSync(path.join(projectDir, 'animation', 'animation.json'), 'utf8'),
    ) as { scenes: { characters: { posture: string }[] }[] };
    expect(raw.scenes[0].characters[0].posture).toBe('sitting');
  });

  it('阶段 2 的舞台数据自动补齐空人物列表', () => {
    const { service, projectId } = createFixture();
    const legacy = {
      projectId,
      version: 0,
      activeSceneId: 'scene-default',
      scenes: [{ id: 'scene-default', name: '场景 1', backgroundAssetId: null, objects: [] }],
    };
    const saved = service.saveStage(projectId, legacy);
    expect(saved.scenes[0].characters).toEqual([]);
  });

  it('人物引用不存在、类型不符或描述文件不可用时均拒绝保存', () => {
    const { service, projectId } = createFixture();
    const missing = payload(projectId, [character({ assetId: 'char-not-exist' })]);
    expectValidationError(() => service.saveStage(projectId, missing), /非人物类型|不存在/);

    const wrongKind = payload(projectId, [character({ assetId: 'prop-sofa' })]);
    expectValidationError(() => service.saveStage(projectId, wrongKind), /非人物类型/);

    const broken = createFixture({ skipDescriptor: true });
    expectValidationError(
      () => broken.service.saveStage(broken.projectId, payload(broken.projectId, [character()])),
      /描述文件不可用/,
    );
  });

  it('超过 4 个角色、人物与道具 ID 重复时拒绝，不静默截断', () => {
    const { service, projectId } = createFixture();
    const tooMany = payload(
      projectId,
      Array.from({ length: 5 }, (_, index) => character({ id: `char-${index}` })),
    );
    expectValidationError(() => service.saveStage(projectId, tooMany), /不合法|超过/);

    const duplicated = {
      ...payload(projectId, [character({ id: 'same-id' })]),
      scenes: [
        {
          id: 'scene-default',
          name: '场景 1',
          backgroundAssetId: null,
          objects: [
            {
              id: 'same-id',
              assetId: 'prop-sofa',
              name: '沙发',
              x: 0,
              y: 0,
              width: 320,
              height: 180,
              rotation: 0,
              zIndex: 0,
              visible: true,
            },
          ],
          characters: [character({ id: 'same-id' })],
        },
      ],
    };
    expectValidationError(() => service.saveStage(projectId, duplicated), /重复的对象 ID/);
  });

  it('非法姿态 / 嘴型由共享 Schema 拒绝', () => {
    const { service, projectId } = createFixture();
    expectValidationError(
      () => service.saveStage(projectId, payload(projectId, [character({ posture: 'running' })])),
      /不合法/,
    );
  });
});

function expectValidationError(action: () => unknown, message: RegExp): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).code).toBe('VALIDATION_ERROR');
  expect((thrown as Error).message).toMatch(message);
}
