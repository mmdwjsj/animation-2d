import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

const apps: FastifyInstance[] = [];
const tempRoots: string[] = [];

async function createFixture(): Promise<{ app: FastifyInstance; dataDir: string }> {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-video-api-'));
  tempRoots.push(root);
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
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响测试结果
    }
  }
  tempRoots.length = 0;
});

describe('项目管理 API', () => {
  it('覆盖列表、校验、创建、保存、删除的完整闭环', async () => {
    const { app, dataDir } = await createFixture();

    const empty = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ data: [] });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '   ' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '老王和小李' },
    });
    expect(created.statusCode).toBe(201);
    const createdData = created.json().data as Record<string, unknown>;
    const projectId = String(createdData.id);
    const version = Number(createdData.version);
    expect(createdData.name).toBe('老王和小李');
    expect(existsSync(path.join(dataDir, 'projects', projectId, 'project.json'))).toBe(true);

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}`,
      payload: { ...createdData, name: '第二稿' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.name).toBe('第二稿');
    expect(saved.json().data.version).toBe(version + 1);

    const removed = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}` });
    expect(removed.statusCode).toBe(204);
    expect(existsSync(path.join(dataDir, 'projects', projectId))).toBe(false);

    const after = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(after.json().data).toHaveLength(0);
  });

  it('返回真实运行配置，并对不存在的资源给出明确错误', async () => {
    const { app } = await createFixture();

    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().data.nodeVersion).toBe(process.version);
    expect(settings.json().data.projectsRoot).toBe('data/projects');
    expect(settings.json().data.fps).toBe(30);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/projects/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('保存时项目 ID 与路径不一致会被拒绝', async () => {
    const { app } = await createFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '原稿' },
    });
    const project = created.json().data;

    const mismatch = await app.inject({
      method: 'PUT',
      url: '/api/projects/11111111-1111-4111-8111-111111111111',
      payload: project,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('VALIDATION_ERROR');
  });
});
