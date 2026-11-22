import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

const apps: FastifyInstance[] = [];
const roots: string[] = [];

const ACCEPTANCE_SCRIPT = [
  '# 场景：客厅',
  '',
  '# 角色：老王、小李',
  '',
  '老王（坐着）：你回来了？',
  '小李（站着）：我的蛋糕呢？',
  '老王：我不知道啊。',
  '小李：那你嘴角的奶油是什么？',
  '老王（站着）：这是牙膏！',
].join('\n');

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 导出 API 集成测试（PRD 14 / 架构 12）。
 * Remotion 入口被指向不存在的文件，任务会真实失败——
 * 这正好验证「失败时如实标记 failed，不静默回退成成功」。
 * 真实 MP4 渲染另由 scripts/_uicheck/verify-stage8-api.mjs 端到端验证。
 */
async function createFixture(withScript: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-render-api-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const app = await buildApp({
    dataDir,
    renderEntryPoint: path.join(root, 'missing-entry.tsx'),
    renderBrowserExecutable: null,
  });
  apps.push(app);

  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: '导出流程验收' },
  });
  expect(created.statusCode).toBe(201);
  const projectId = created.json().data.id as string;

  if (withScript) {
    const parsed = await app.inject({
      method: 'POST',
      url: '/api/scripts/parse',
      payload: { text: ACCEPTANCE_SCRIPT },
    });
    const draft = parsed.json().data.draft;
    const imported = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/draft/import`,
      payload: { draft, confirmed: true },
    });
    expect(imported.statusCode).toBe(200);
  }

  return { app, projectId, dataDir };
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('阶段 8：导出前检查（PRD 14 步骤 1-5）', () => {
  it('空项目无法导出，对白检查作为阻断项', async () => {
    const { app, projectId } = await createFixture(false);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/render/validate?fps=30`,
    });
    expect(response.statusCode).toBe(200);
    const validation = response.json().data;
    expect(validation.canRender).toBe(false);
    const dialogueCheck = validation.checks.find(
      (item: { id: string }) => item.id === 'dialogues',
    );
    expect(dialogueCheck.ok).toBe(false);
    expect(dialogueCheck.blocking).toBe(true);
    expect(validation.totalFrames).toBe(0);
  });

  it('导入剧本后可通过检查，缺配音只提示不阻断', async () => {
    const { app, projectId } = await createFixture(true);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/render/validate?fps=30`,
    });
    const validation = response.json().data;
    expect(validation.canRender).toBe(true);
    expect(validation.totalFrames).toBeGreaterThan(0);
    expect(validation.sceneId).toBeTruthy();

    const audioCheck = validation.checks.find((item: { id: string }) => item.id === 'audio');
    expect(audioCheck.ok).toBe(false);
    expect(audioCheck.blocking).toBe(false);
    expect(validation.warnings.length).toBeGreaterThan(0);
  });

  it('帧率参数非法时返回校验错误', async () => {
    const { app, projectId } = await createFixture(true);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/render/validate?fps=abc`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('阶段 8：导出任务与状态机', () => {
  it('无法通过检查时拒绝创建任务', async () => {
    const { app, projectId } = await createFixture(false);
    const response = await app.inject({
      method: 'POST',
      url: '/api/render',
      payload: {
        projectId,
        config: {
          fileName: 'x',
          resolution: '540x960',
          fps: 30,
          quality: 'draft',
          outputDir: 'renders',
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('参数非法（分辨率越界）时拒绝创建任务', async () => {
    const { app, projectId } = await createFixture(true);
    const response = await app.inject({
      method: 'POST',
      url: '/api/render',
      payload: {
        projectId,
        config: {
          fileName: 'x',
          resolution: '9999x9999',
          fps: 30,
          quality: 'draft',
          outputDir: 'renders',
        },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('渲染入口不可用时任务如实标记 failed，不伪造成功', async () => {
    const { app, projectId } = await createFixture(true);
    const created = await app.inject({
      method: 'POST',
      url: '/api/render',
      payload: {
        projectId,
        config: {
          fileName: 'stage8-test',
          resolution: '540x960',
          fps: 30,
          quality: 'draft',
          outputDir: 'renders',
        },
      },
    });
    expect(created.statusCode).toBe(200);
    const jobId = created.json().data.id as string;

    let job = created.json().data;
    for (let i = 0; i < 40; i += 1) {
      await delay(250);
      const polled = await app.inject({ method: 'GET', url: `/api/render/${jobId}` });
      job = polled.json().data;
      if (job.stage === 'completed' || job.stage === 'failed') break;
    }

    expect(job.stage).toBe('failed');
    expect(job.error?.code).toBe('RENDER_FAILED');
    expect(job.progress).toBeNull();
    expect(job.outputFile).toBeNull();

    // 未完成的任务不能下载文件。
    const file = await app.inject({ method: 'GET', url: `/api/render/${jobId}/file` });
    expect(file.statusCode).toBe(400);
  });

  it('查询不存在的任务返回 404', async () => {
    const { app } = await createFixture(false);
    const response = await app.inject({
      method: 'GET',
      url: '/api/render/00000000-0000-4000-8000-000000000000',
    });
    expect(response.statusCode).toBe(404);
  });

  it('删除项目时一并清理渲染任务元数据，不留孤儿记录', async () => {
    const { app, projectId, dataDir } = await createFixture(true);
    const created = await app.inject({
      method: 'POST',
      url: '/api/render',
      payload: {
        projectId,
        config: {
          fileName: 'cleanup',
          resolution: '540x960',
          fps: 30,
          quality: 'draft',
          outputDir: 'renders',
        },
      },
    });
    const jobId = created.json().data.id as string;

    for (let i = 0; i < 40; i += 1) {
      await delay(250);
      const polled = await app.inject({ method: 'GET', url: `/api/render/${jobId}` });
      const stage = polled.json().data.stage;
      if (stage === 'completed' || stage === 'failed') break;
    }

    const removed = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}` });
    expect(removed.statusCode).toBe(204);

    const db = new DatabaseSync(path.join(dataDir, 'workbench.sqlite'));
    try {
      const rows = db
        .prepare('SELECT id FROM render_jobs WHERE project_id = ?')
        .all(projectId) as unknown as Array<{ id: string }>;
      expect(rows.length).toBe(0);
    } finally {
      db.close();
    }
  });
});
