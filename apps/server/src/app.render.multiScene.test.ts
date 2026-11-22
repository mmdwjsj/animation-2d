import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

const apps: FastifyInstance[] = [];
const roots: string[] = [];

/** 两段不同背景的场景，验证按序拼接与全局音轨对齐。 */
const TWO_SCENE_SCRIPT = [
  '# 场景：客厅',
  '',
  '# 角色：老王、小李',
  '',
  '老王（坐着）：你回来了？',
  '小李（站着）：我的蛋糕呢？',
  '',
  '# 场景：厨房',
  '',
  '# 角色：老王、小李',
  '',
  '老王：我在这儿。',
  '小李：原来如此。',
].join('\n');

async function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-multi-scene-'));
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
    payload: { name: '多场景拼接验收' },
  });
  expect(created.statusCode).toBe(201);
  const projectId = created.json().data.id as string;

  const parsed = await app.inject({
    method: 'POST',
    url: '/api/scripts/parse',
    payload: { text: TWO_SCENE_SCRIPT },
  });
  expect(parsed.json().data.draft.errors).toEqual([]);
  const draft = parsed.json().data.draft;
  const imported = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/draft/import`,
    payload: { draft, confirmed: true },
  });
  expect(imported.statusCode).toBe(200);
  expect(imported.json().data.scenes).toHaveLength(2);

  return { app, projectId, dataDir };
}

async function validate(app: FastifyInstance, projectId: string, query = '') {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/render/validate?fps=30${query}`,
  });
  return { statusCode: response.statusCode, body: response.json() };
}

/** 等后台导出任务进入终态，避免测试关闭夹具后残留 DB 写入噪音。 */
async function waitTerminal(app: FastifyInstance, jobId: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const polled = await app.inject({ method: 'GET', url: `/api/render/${jobId}` });
    const stage = polled.json().data.stage as string;
    if (stage === 'completed' || stage === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function readStage(dataDir: string, projectId: string) {
  return JSON.parse(
    readFileSync(path.join(dataDir, 'projects', projectId, 'animation', 'animation.json'), 'utf8'),
  ) as {
    scenes: Array<{
      id: string;
      name: string;
      dialogueEvents: Array<{ startFrame: number; audioAssetId?: string }>;
    }>;
  };
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('多场景自动拼接 · 导出校验（PRD 14 步骤 1-5）', () => {
  it('scope=all 按场景顺序拼接，总帧数为各场景之和', async () => {
    const { app, projectId } = await createFixture();
    const { statusCode, body } = await validate(app, projectId, '&scope=all');
    expect(statusCode).toBe(200);
    const v = body.data;

    expect(v.scope).toBe('all');
    expect(v.sceneCount).toBe(2);
    expect(v.sceneSpans.map((s: { sceneName: string }) => s.sceneName)).toEqual(['客厅', '厨房']);
    expect(v.sceneSpans[1].startFrame).toBe(v.sceneSpans[0].endFrame);
    expect(v.projectDurationFrames).toBe(
      v.sceneSpans.reduce((sum: number, s: { durationFrames: number }) => sum + s.durationFrames, 0),
    );
    // 30 FPS 下重采样帧数与项目逻辑帧一致。
    expect(v.totalFrames).toBe(v.projectDurationFrames);
    expect(v.canRender).toBe(true);

    const dialoguesCheck = v.checks.find((c: { id: string }) => c.id === 'dialogues');
    expect(dialoguesCheck.detail).toContain('2 个场景共 4 条对白');
    const assetsCheck = v.checks.find((c: { id: string }) => c.id === 'assets');
    expect(assetsCheck.ok).toBe(true);
    expect(assetsCheck.detail).toContain('2 个场景');
  });

  it('scope=active 只导出当前场景，并明确提示其余场景不进视频', async () => {
    const { app, projectId } = await createFixture();
    const all = (await validate(app, projectId, '&scope=all')).body.data;
    const active = (await validate(app, projectId, '&scope=active')).body.data;

    expect(active.scope).toBe('active');
    expect(active.sceneCount).toBe(1);
    expect(active.sceneSpans).toHaveLength(1);
    expect(active.totalFrames).toBeLessThan(all.totalFrames);
    expect(active.warnings.join(' ')).toContain('仅导出当前场景');
  });

  it('scope 参数非法时返回 400', async () => {
    const { app, projectId } = await createFixture();
    const { statusCode, body } = await validate(app, projectId, '&scope=everything');
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('未生成配音时按场景名列出缺音频的对白', async () => {
    const { app, projectId } = await createFixture();
    const v = (await validate(app, projectId, '&scope=all')).body.data;
    const audioCheck = v.checks.find((c: { id: string }) => c.id === 'audio');
    expect(audioCheck.ok).toBe(false);
    expect(audioCheck.blocking).toBe(false);
    expect(audioCheck.detail).toContain('客厅 2 句');
    expect(audioCheck.detail).toContain('厨房 2 句');
  });
});

describe('多场景自动拼接 · 配音覆盖全部场景', () => {
  it('一次生成配音即覆盖两个场景的 4 条对白，各场景独立串排', async () => {
    const { app, projectId, dataDir } = await createFixture();
    const plan = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tts/plan`,
      payload: { providerId: 'local-tone' },
    });
    expect(plan.json().data.sceneCount).toBe(2);
    expect(plan.json().data.targetCount).toBe(4);
    expect(plan.json().data.dialogues.map((d: { sceneName: string }) => d.sceneName)).toEqual([
      '客厅',
      '客厅',
      '厨房',
      '厨房',
    ]);

    const generated = await app.inject({
      method: 'POST',
      url: '/api/tts/generate',
      payload: { projectId, providerId: 'local-tone', confirmed: true },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().data.generated).toHaveLength(4);

    const stage = readStage(dataDir, projectId);
    for (const scene of stage.scenes) {
      expect(scene.dialogueEvents).toHaveLength(2);
      expect(scene.dialogueEvents.every((event) => Boolean(event.audioAssetId))).toBe(true);
      expect(scene.dialogueEvents[0].audioAssetId).not.toBe(scene.dialogueEvents[1].audioAssetId);
    }
    // 两个场景的时间轴各自从 0 开始，不会被全局串排改写。
    expect(stage.scenes[0].dialogueEvents[0].startFrame).toBe(0);
    expect(stage.scenes[1].dialogueEvents[0].startFrame).toBe(0);

    const v = (await validate(app, projectId, '&scope=all')).body.data;
    const audioCheck = v.checks.find((c: { id: string }) => c.id === 'audio');
    expect(audioCheck.ok).toBe(true);
    expect(audioCheck.detail).toContain('4 条对白均已生成配音');
  });
});

describe('多场景自动拼接 · 任务创建', () => {
  const baseConfig = {
    fileName: 'multi',
    resolution: '540x960',
    fps: 30,
    quality: 'draft',
    outputDir: 'renders',
  };

  it('未传 scope 时默认 all，显式 active 时按单场景计算帧数', async () => {
    const { app, projectId } = await createFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/render',
      payload: { projectId, config: baseConfig },
    });
    expect(created.statusCode).toBe(200);
    const job = created.json().data;
    expect(job.config.scope).toBe('all');
    expect(job.totalFrames).toBe((await validate(app, projectId, '&scope=all')).body.data.totalFrames);
    await waitTerminal(app, job.id);
  });

  it('显式 active 时任务帧数小于 all', async () => {
    const { app, projectId } = await createFixture();
    const all = (await validate(app, projectId, '&scope=all')).body.data;
    const created = await app.inject({
      method: 'POST',
      url: '/api/render',
      payload: { projectId, config: { ...baseConfig, scope: 'active' } },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.config.scope).toBe('active');
    expect(created.json().data.totalFrames).toBeLessThan(all.totalFrames);
    await waitTerminal(app, created.json().data.id);
  });

  it('非法 scope 的创建请求被拒绝', async () => {
    const { app, projectId } = await createFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/render',
      payload: { projectId, config: { ...baseConfig, scope: 'everything' } },
    });
    expect(created.statusCode).toBe(400);
  });
});

describe('多场景自动拼接 · 场景间转场校验明细', () => {
  it('目标场景配置进入转场后，校验返回明细且总帧数不变', async () => {
    const { app, projectId, dataDir } = await createFixture();
    const before = (await validate(app, projectId, '&scope=all')).body.data;
    expect(before.sceneTransitions).toEqual([]);

    const stagePath = path.join(dataDir, 'projects', projectId, 'animation', 'animation.json');
    const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as {
      scenes: Array<Record<string, unknown>>;
    };
    stage.scenes[1].transition = { type: 'fade', durationFrames: 9 };
    writeFileSync(stagePath, JSON.stringify(stage));

    const after = (await validate(app, projectId, '&scope=all')).body.data;
    expect(after.sceneTransitions).toHaveLength(1);
    expect(after.sceneTransitions[0]).toMatchObject({
      fromSceneName: '客厅',
      toSceneName: '厨房',
      durationFrames: 9,
      exportFrames: 9,
    });
    // 转场叠加在边界，不插入额外帧，不改写 sceneSpans / 音频偏移。
    expect(after.totalFrames).toBe(before.totalFrames);
    expect(after.projectDurationFrames).toBe(before.projectDurationFrames);
    expect(after.sceneSpans).toEqual(before.sceneSpans);
    expect(after.warnings.join(' ')).toContain('转场');
    expect(after.canRender).toBe(true);
  });

  it('scope=active 只导出一个场景时不返回任何转场', async () => {
    const { app, projectId, dataDir } = await createFixture();
    const stagePath = path.join(dataDir, 'projects', projectId, 'animation', 'animation.json');
    const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as {
      scenes: Array<Record<string, unknown>>;
    };
    stage.scenes[1].transition = { type: 'fade', durationFrames: 15 };
    writeFileSync(stagePath, JSON.stringify(stage));

    const active = (await validate(app, projectId, '&scope=active')).body.data;
    expect(active.sceneCount).toBe(1);
    expect(active.sceneTransitions).toEqual([]);
  });
});
