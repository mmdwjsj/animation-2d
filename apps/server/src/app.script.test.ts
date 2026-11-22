import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

const apps: FastifyInstance[] = [];
const roots: string[] = [];

async function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-script-api-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const app = await buildApp({ dataDir });
  apps.push(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: '剧本流程验收' },
  });
  const projectId = created.json().data.id as string;
  return { app, projectId, dir: path.join(dataDir, 'projects', projectId) };
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

function animationFile(dir: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('剧本解析与草稿导入 API', () => {
  it('解析接口返回草稿与真实素材匹配结果，且不写盘', async () => {
    const { app, dir } = await createFixture();
    const before = animationFile(dir);

    const response = await app.inject({
      method: 'POST',
      url: '/api/scripts/parse',
      payload: { text: ACCEPTANCE_SCRIPT },
    });

    expect(response.statusCode).toBe(200);
    const { draft, match } = response.json().data;
    expect(draft.errors).toEqual([]);
    expect(draft.scenes).toHaveLength(1);
    expect(draft.scenes[0].dialogues).toHaveLength(5);
    expect(match.scenes[0].assetId).toBe('scene-living-room');
    expect(match.characters.map((item: { assetId: string }) => item.assetId)).toEqual([
      'char-old-wang',
      'char-xiao-li',
    ]);
    expect(match.unmatched).toEqual([]);
    expect(animationFile(dir)).toEqual(before);
  });

  it('原始剧本与解析草稿分开保存，保存动作不覆盖动画数据', async () => {
    const { app, projectId, dir } = await createFixture();
    const before = animationFile(dir);
    const parsed = await app.inject({
      method: 'POST',
      url: '/api/scripts/parse',
      payload: { text: ACCEPTANCE_SCRIPT },
    });
    const draft = parsed.json().data.draft;

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/script`,
      payload: { original: ACCEPTANCE_SCRIPT, draft },
    });
    expect(saved.statusCode).toBe(200);

    const read = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/script`,
    });
    expect(read.json().data.original).toBe(ACCEPTANCE_SCRIPT);
    expect(read.json().data.draft.scenes[0].dialogues).toHaveLength(5);
    expect(readFileSync(path.join(dir, 'scripts', 'original.txt'), 'utf8')).toBe(
      ACCEPTANCE_SCRIPT,
    );
    expect(animationFile(dir)).toEqual(before);
  });

  it('preview 只读；未确认导入被拒绝；确认后整体替换并真实落盘', async () => {
    const { app, projectId, dir } = await createFixture();
    const parsed = await app.inject({
      method: 'POST',
      url: '/api/scripts/parse',
      payload: { text: ACCEPTANCE_SCRIPT },
    });
    const draft = parsed.json().data.draft;
    const before = animationFile(dir);

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/draft/preview`,
      payload: { draft },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.hasExistingData).toBe(false);
    expect(preview.json().data.next).toEqual({ scenes: 1, characters: 2, dialogues: 5 });
    expect(animationFile(dir)).toEqual(before);

    const unconfirmed = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/draft/import`,
      payload: { draft },
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json().error.code).toBe('VALIDATION_ERROR');
    expect(animationFile(dir)).toEqual(before);

    const imported = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/draft/import`,
      payload: { draft, confirmed: true },
    });
    expect(imported.statusCode).toBe(200);
    const stage = imported.json().data;
    expect(stage.scenes).toHaveLength(1);
    expect(stage.scenes[0].backgroundAssetId).toBe('scene-living-room');
    expect(stage.scenes[0].characters).toHaveLength(2);
    expect(stage.scenes[0].dialogueEvents).toHaveLength(5);
    expect(stage.scenes[0].dialogueEvents[0].sourceLine).toBe(5);

    const persisted = animationFile(dir) as {
      scenes: { dialogueEvents: unknown[]; characters: unknown[] }[];
    };
    expect(persisted.scenes[0].dialogueEvents).toHaveLength(5);
    expect(persisted.scenes[0].characters).toHaveLength(2);
  });

  it('重新解析后保存新草稿不会覆盖已有动画数据，影响对比提示整体替换', async () => {
    const { app, projectId, dir } = await createFixture();
    const parsed = await app.inject({
      method: 'POST',
      url: '/api/scripts/parse',
      payload: { text: ACCEPTANCE_SCRIPT },
    });
    const draft = parsed.json().data.draft;
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/draft/import`,
      payload: { draft, confirmed: true },
    });
    const afterImport = animationFile(dir);

    const changedScript = ['# 场景：厨房', '# 角色：老王', '老王：换了个场景'].join('\n');
    const reparsed = await app.inject({
      method: 'POST',
      url: '/api/scripts/parse',
      payload: { text: changedScript },
    });
    const newDraft = reparsed.json().data.draft;
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/script`,
      payload: { original: changedScript, draft: newDraft },
    });

    expect(animationFile(dir)).toEqual(afterImport);
    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/draft/preview`,
      payload: { draft: newDraft },
    });
    expect(preview.json().data.hasExistingData).toBe(true);
    expect(preview.json().data.current.dialogues).toBe(5);
    expect(preview.json().data.next.dialogues).toBe(1);
    expect(preview.json().data.warning).toContain('不可撤销');
  });

  it('带解析错误的剧本不能创建动画草稿', async () => {
    const { app, projectId, dir } = await createFixture();
    const before = animationFile(dir);
    const parsed = await app.inject({
      method: 'POST',
      url: '/api/scripts/parse',
      payload: { text: '# 场景：客厅\n# 角色：老王\n老王：' },
    });
    const draft = parsed.json().data.draft;
    expect(draft.errors).toHaveLength(1);

    const imported = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/draft/import`,
      payload: { draft, confirmed: true },
    });
    expect(imported.statusCode).toBe(400);
    expect(imported.json().error.code).toBe('SCRIPT_PARSE_ERROR');
    expect(animationFile(dir)).toEqual(before);
  });
});
