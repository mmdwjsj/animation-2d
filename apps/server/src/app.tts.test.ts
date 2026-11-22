import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROJECT_DEFAULTS, TTS_AUDIO, type StageData } from '@animation/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readWavDurationMs } from './services/tts/wav';

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

async function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-tts-api-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const app = await buildApp({ dataDir });
  apps.push(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: '配音流程验收' },
  });
  const projectId = created.json().data.id as string;
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
  return { app, projectId, dir: path.join(dataDir, 'projects', projectId) };
}

function stageFile(dir: string): StageData {
  return JSON.parse(
    readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8'),
  ) as StageData;
}

function assetFile(dir: string) {
  return JSON.parse(readFileSync(path.join(dir, 'audio', 'assets.json'), 'utf8')) as {
    version: number;
    assets: Array<{
      id: string;
      status: string;
      durationMs: number;
      envelope: number[];
      sourceDialogueId: string;
      filePath: string;
    }>;
  };
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

describe('TTS Provider 与影响预览 API', () => {
  it('列出统一 Provider 描述，只含通用字段', async () => {
    const { app } = await createFixture();
    const response = await app.inject({ method: 'GET', url: '/api/tts/providers' });
    expect(response.statusCode).toBe(200);
    const providers = response.json().data.providers;
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('local-tone');
    expect(providers[0].voices).toHaveLength(6);
    expect(providers[0].languages).toEqual(['zh', 'th']);
    expect(providers[0].defaultVoiceByLanguage).toEqual({
      zh: 'voice-warm',
      th: 'voice-thai-warm',
    });
    expect(Object.keys(providers[0])).not.toContain('apiKey');
  });

  it('plan 只读返回影响，不生成音频也不改动动画数据', async () => {
    const { app, projectId, dir } = await createFixture();
    const before = readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8');
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tts/plan`,
      payload: { providerId: 'local-tone', voiceId: 'voice-bright', speed: 1.2 },
    });
    expect(response.statusCode).toBe(200);
    const plan = response.json().data;
    expect(plan.targetCount).toBe(5);
    expect(plan.dialogues).toHaveLength(5);
    expect(plan.protectedCount).toBe(0);
    expect(plan.voiceId).toBe('voice-bright');
    expect(plan.speed).toBe(1.2);
    expect(plan.warning).toContain('重设对白时长');
    expect(plan.warning).toContain('不会');
    expect(readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8')).toBe(before);
    expect(existsSync(path.join(dir, 'audio', 'assets.json'))).toBe(false);
  });

  it('缺 confirmed 一律拒绝，且动画数据零变化', async () => {
    const { app, projectId, dir } = await createFixture();
    const before = readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8');
    const response = await app.inject({
      method: 'POST',
      url: '/api/tts/generate',
      payload: { projectId, providerId: 'local-tone' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8')).toBe(before);
  });

  it('未知引擎 / 声音 / 对白 ID 分别给出明确错误', async () => {
    const { app, projectId } = await createFixture();
    const badProvider = await app.inject({
      method: 'POST',
      url: '/api/tts/generate',
      payload: { projectId, providerId: 'nope', confirmed: true },
    });
    expect(badProvider.statusCode).toBe(502);
    expect(badProvider.json().error.code).toBe('TTS_FAILED');

    const badVoice = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tts/plan`,
      payload: { providerId: 'local-tone', voiceId: 'nope' },
    });
    expect(badVoice.statusCode).toBe(502);

    const badDialogue = await app.inject({
      method: 'POST',
      url: '/api/tts/generate',
      payload: { projectId, providerId: 'local-tone', dialogueIds: ['missing'], confirmed: true },
    });
    expect(badDialogue.statusCode).toBe(400);
    expect(badDialogue.json().error.message).toContain('不存在');
  });
});

describe('生成配音：真实时长、包络与引用一致性', () => {
  async function generateAll(app: FastifyInstance, projectId: string) {
    return app.inject({
      method: 'POST',
      url: '/api/tts/generate',
      payload: { projectId, providerId: 'local-tone', confirmed: true },
    });
  }

  it('5 句独立生成，真实时长来自 WAV 样本且不被提前截断', async () => {
    const { app, projectId, dir } = await createFixture();
    const response = await generateAll(app, projectId);
    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result.generated).toHaveLength(5);
    expect(result.skipped).toEqual([]);

    const assets = assetFile(dir);
    const ready = assets.assets.filter((item) => item.status === 'ready');
    expect(ready).toHaveLength(5);

    for (const item of result.generated) {
      const asset = ready.find((entry) => entry.id === item.assetId);
      expect(asset).toBeDefined();
      const minFrames = Math.ceil((item.durationMs / 1000) * PROJECT_DEFAULTS.fps) + TTS_AUDIO.tailFrames;
      expect(item.durationFrames).toBeGreaterThanOrEqual(minFrames);
      // 未手动调整的对白按真实时长重设，不再保留偏长的估算值。
      expect(item.durationFrames).toBeGreaterThanOrEqual(TTS_AUDIO.minDialogueFrames);
      const wav = readFileSync(path.join(dir, asset!.filePath));
      expect(readWavDurationMs(wav)).toBeCloseTo(item.durationMs, 3);
      expect(asset!.envelope.length).toBe(
        Math.ceil((item.durationMs / 1000) * PROJECT_DEFAULTS.fps),
      );
    }

    const stage = stageFile(dir);
    const ids = new Set(ready.map((item) => item.id));
    for (const dialogue of stage.scenes[0].dialogueEvents) {
      expect(dialogue.audioAssetId).toBeTruthy();
      expect(ids.has(dialogue.audioAssetId!)).toBe(true);
    }
    expect(result.sceneDurationFrames).toBeGreaterThan(0);
  });

  it('试听接口返回真实 WAV，且拒绝未登记的路径', async () => {
    const { app, projectId } = await createFixture();
    const generated = await generateAll(app, projectId);
    const assetId = generated.json().data.generated[0].assetId as string;

    const audio = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/audio/${assetId}`,
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toContain('audio/wav');
    expect(audio.rawPayload.toString('ascii', 0, 4)).toBe('RIFF');

    const missing = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/audio/not-registered`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ASSET_NOT_FOUND');
  });

  it('音频资产索引可通过只读接口获取，包络为 0..1 缓存数据', async () => {
    const { app, projectId } = await createFixture();
    await generateAll(app, projectId);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/audio`,
    });
    expect(response.statusCode).toBe(200);
    const assets = response.json().data.assets;
    expect(assets).toHaveLength(5);
    expect(assets.every((a: { envelope: number[] }) => a.envelope.every((v) => v >= 0 && v <= 1))).toBe(true);
  });

  it('手动调整过起始位置的对白不被自动移动，但仍延长到不短于音频', async () => {
    const { app, projectId, dir } = await createFixture();
    const original = stageFile(dir);
    const targetId = original.scenes[0].dialogueEvents[2].id;
    const modified: StageData = {
      ...original,
      scenes: original.scenes.map((scene) => ({
        ...scene,
        dialogueEvents: scene.dialogueEvents.map((event) =>
          event.id === targetId ? { ...event, startFrame: 500, manuallyTimed: true } : event,
        ),
      })),
    };
    expect(
      (await app.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/stage`,
        payload: modified,
      })).statusCode,
    ).toBe(200);

    const plan = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tts/plan`,
      payload: { providerId: 'local-tone' },
    });
    expect(plan.json().data.protectedCount).toBe(1);
    expect(plan.json().data.warning).toContain('不会被自动移动');

    const generated = await generateAll(app, projectId);
    expect(generated.statusCode).toBe(200);
    const saved = generated.json().data.stage as StageData;
    const protectedDialogue = saved.scenes[0].dialogueEvents.find((item) => item.id === targetId);
    expect(protectedDialogue?.startFrame).toBe(500);
    const item = generated.json().data.generated.find(
      (entry: { dialogueId: string }) => entry.dialogueId === targetId,
    );
    expect(protectedDialogue?.durationFrames).toBeGreaterThanOrEqual(item.durationFrames);
  });

  it('单句重新生成创建新资产、更新引用，不留下悬空引用', async () => {
    const { app, projectId, dir } = await createFixture();
    const first = await generateAll(app, projectId);
    const targetId = first.json().data.generated[2].dialogueId as string;
    const oldAssetId = first.json().data.generated[2].assetId as string;

    const second = await app.inject({
      method: 'POST',
      url: '/api/tts/generate',
      payload: {
        projectId,
        providerId: 'local-tone',
        voiceId: 'voice-bright',
        dialogueIds: [targetId],
        confirmed: true,
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.generated).toHaveLength(1);
    const newAssetId = second.json().data.generated[0].assetId as string;
    expect(newAssetId).not.toBe(oldAssetId);

    const assets = assetFile(dir);
    expect(assets.assets.find((item) => item.id === oldAssetId)?.status).toBe('superseded');
    expect(assets.assets.find((item) => item.id === newAssetId)?.status).toBe('ready');

    const stage = stageFile(dir);
    const readyIds = new Set(
      assets.assets.filter((item) => item.status === 'ready').map((item) => item.id),
    );
    for (const dialogue of stage.scenes[0].dialogueEvents) {
      expect(dialogue.audioAssetId).toBeTruthy();
      expect(readyIds.has(dialogue.audioAssetId!)).toBe(true);
    }
    expect(
      stage.scenes[0].dialogueEvents.find((item) => item.id === targetId)?.audioAssetId,
    ).toBe(newAssetId);
  });
});
