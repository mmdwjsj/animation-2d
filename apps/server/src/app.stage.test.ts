import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

const apps: FastifyInstance[] = [];
const roots: string[] = [];

async function createFixture(): Promise<{ app: FastifyInstance; dataDir: string }> {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-stage-api-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const app = await buildApp({ dataDir });
  apps.push(app);
  return { app, dataDir };
}

afterEach(async () => {
  for (const app of apps) {
    try {
      await app.close();
    } catch {
      // 已关闭时忽略
    }
  }
  apps.length = 0;
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响测试结果
    }
  }
  roots.length = 0;
});

describe('素材与舞台 API', () => {
  it('素材列表来自真实索引，人物描述文件与分层文件可读取', async () => {
    const { app } = await createFixture();
    const scenes = await app.inject({ method: 'GET', url: '/api/assets/scenes' });
    const props = await app.inject({ method: 'GET', url: '/api/assets/props' });
    const characters = await app.inject({ method: 'GET', url: '/api/assets/characters' });
    expect(scenes.statusCode).toBe(200);
    expect(scenes.json().data).toHaveLength(3);
    expect(props.json().data).toHaveLength(6);
    expect(characters.json().data).toHaveLength(2);
    expect(characters.json().data[0].descriptor.postures.standing.anchor).toEqual({ x: 180, y: 600 });
    expect(characters.json().data[0].descriptor.postures.sitting.anchor).toEqual({ x: 180, y: 580 });
    expect((await app.inject({ method: 'GET', url: '/api/assets' })).json().data).toHaveLength(11);

    const layer = await app.inject({
      method: 'GET',
      url: '/api/assets/layers/char-old-wang/standing/body.svg',
    });
    expect(layer.statusCode).toBe(200);
    expect(layer.headers['content-type']).toContain('image/svg+xml');
    expect(layer.body).toContain('<svg');

    const illegal = await app.inject({
      method: 'GET',
      url: '/api/assets/layers/char-old-wang/faces/not-exist.svg',
    });
    expect(illegal.statusCode).toBe(404);
    expect(illegal.json().error.code).toBe('ASSET_NOT_FOUND');

    const status = await app.inject({ method: 'GET', url: '/api/assets/status' });
    expect(status.json().data.missing).toEqual([]);
  });

  it('素材文件可读取且不存在的素材返回 ASSET_NOT_FOUND', async () => {
    const { app } = await createFixture();
    const file = await app.inject({ method: 'GET', url: '/api/assets/files/prop-sofa' });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('image/svg+xml');
    expect(file.body).toContain('<svg');

    const missing = await app.inject({ method: 'GET', url: '/api/assets/files/not-exist' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ASSET_NOT_FOUND');
  });

  it('舞台读写闭环：默认场景 -> 保存逻辑坐标 -> 重新读取一致', async () => {
    const { app, dataDir } = await createFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '舞台验收' },
    });
    const projectId = String(created.json().data.id);

    const initial = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/stage` });
    expect(initial.statusCode).toBe(200);
    const stage = initial.json().data as Record<string, unknown>;
    expect((stage.scenes as unknown[])).toHaveLength(1);

    const next = {
      ...stage,
      scenes: [
        {
          id: 'scene-default',
          name: '场景 1',
          backgroundAssetId: 'scene-living-room',
          objects: [
            {
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
            },
          ],
        },
      ],
    };
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/stage`,
      payload: next,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.version).toBe(1);

    const reread = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/stage` });
    const objects = reread.json().data.scenes[0].objects;
    expect(objects[0].x).toBe(540);
    expect(objects[0].y).toBe(1600);
    expect(objects[0].assetId).toBe('prop-sofa');
    expect(existsSync(path.join(dataDir, 'projects', projectId, 'animation', 'animation.json'))).toBe(true);
  });

  it('保存不存在的素材引用与不存在项目的舞台都给出明确错误', async () => {
    const { app } = await createFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '错误分类验收' },
    });
    const projectId = String(created.json().data.id);
    const stage = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/stage` })).json().data;

    const bad = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/stage`,
      payload: {
        ...stage,
        scenes: [
          {
            id: 'scene-default',
            name: '场景 1',
            backgroundAssetId: null,
            objects: [
              {
                id: 'obj-1',
                assetId: 'prop-not-exist',
                name: '幽灵道具',
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                rotation: 0,
                zIndex: 0,
                visible: true,
              },
            ],
          },
        ],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    const missing = await app.inject({
      method: 'GET',
      url: '/api/projects/00000000-0000-4000-8000-000000000000/stage',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('人物实例保存后落盘姿态 / 嘴型 / 逻辑坐标，重新读取一致', async () => {
    const { app } = await createFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '人物验收' },
    });
    const projectId = String(created.json().data.id);
    const stage = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/stage` })).json()
      .data;

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/stage`,
      payload: {
        ...stage,
        scenes: [
          {
            id: 'scene-default',
            name: '场景 1',
            backgroundAssetId: 'scene-living-room',
            objects: [],
            characters: [
              {
                id: 'char-1',
                assetId: 'char-old-wang',
                name: '老王',
                x: 540,
                y: 1600,
                width: 300,
                posture: 'sitting',
                eyeState: 'closed',
                mouthState: 'open_large',
                visible: true,
                zIndex: 0,
              },
            ],
          },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);

    const reread = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/stage` });
    expect(reread.json().data.scenes[0].characters[0]).toMatchObject({
      assetId: 'char-old-wang',
      posture: 'sitting',
      eyeState: 'closed',
      mouthState: 'open_large',
      x: 540,
      y: 1600,
    });
  });
});
