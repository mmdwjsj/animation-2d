import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDefaultStage,
  PROJECT_DEFAULTS,
  type CharacterInstance,
  type DialogueEvent,
  type ProjectLanguage,
  type StageData,
} from '@animation/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config';
import { AppError, errors } from '../errors';
import { AssetService } from './assetService';
import { StageService } from './stageService';
import { LocalToneProvider } from './tts/localToneProvider';
import type { TtsSynthesisProvider, TtsSynthesisRequest, TtsSynthesisResult } from './tts/provider';
import { TtsProviderRegistry } from './tts/provider';
import { TtsService } from './ttsService';

const roots: string[] = [];
const local = new LocalToneProvider();

function providerWith(
  id: string,
  synthesize: (request: TtsSynthesisRequest) => Promise<TtsSynthesisResult>,
): TtsSynthesisProvider {
  return { descriptor: { ...local.descriptor, id }, synthesize };
}

/** 构造只支持单一语言的引擎，用来验证按语言自动路由。 */
function languageProvider(
  id: string,
  language: ProjectLanguage,
  calls: string[],
): TtsSynthesisProvider {
  const voices = local.descriptor.voices.filter((voice) => voice.language === language);
  return {
    descriptor: {
      ...local.descriptor,
      id,
      languages: [language],
      voices,
      defaultVoiceId: voices[0].id,
      defaultVoiceByLanguage: language === 'zh' ? { zh: voices[0].id } : { th: voices[0].id },
    },
    synthesize: async (request) => {
      calls.push(`${id}:${request.language}:${request.text}`);
      return local.synthesize(request);
    },
  };
}

function fixture(providers: TtsSynthesisProvider[], dialogues?: DialogueEvent[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-tts-service-'));
  roots.push(root);
  const projectsDir = path.join(root, 'projects');
  const projectId = '11111111-1111-4111-8111-111111111111';
  const dir = path.join(projectsDir, projectId);
  mkdirSync(path.join(dir, 'animation'), { recursive: true });
  mkdirSync(path.join(dir, 'audio'), { recursive: true });
  writeFileSync(path.join(dir, 'project.json'), '{}', 'utf8');

  const character: CharacterInstance = {
    id: 'char-1',
    assetId: 'char-old-wang',
    name: '老王',
    x: 300,
    y: 1600,
    width: 300,
    posture: 'standing',
    eyeState: 'open',
    mouthState: 'closed',
    visible: true,
    zIndex: 0,
  };
  const defaultDialogues: DialogueEvent[] = [
    { id: 'dlg-1', characterId: 'char-1', text: '你回来了？', posture: 'sitting', startFrame: 0, durationFrames: 60 },
    { id: 'dlg-2', characterId: 'char-1', text: '我的蛋糕呢？', posture: 'standing', startFrame: 75, durationFrames: 60 },
    { id: 'dlg-3', characterId: 'char-1', text: '这是牙膏！', posture: 'standing', startFrame: 150, durationFrames: 60 },
  ];
  const base = createDefaultStage(projectId);
  const stage: StageData = {
    ...base,
    scenes: [{ ...base.scenes[0], characters: [character], dialogueEvents: dialogues ?? defaultDialogues }],
  };
  writeFileSync(path.join(dir, 'animation', 'animation.json'), JSON.stringify(stage), 'utf8');

  const assets = new AssetService(path.join(appConfig.repoRoot, 'assets'));
  const stages = new StageService(assets, projectsDir);
  const tts = new TtsService(new TtsProviderRegistry(providers), stages, projectsDir);
  return { tts, stages, dir, projectId };
}

function stageFile(dir: string): StageData {
  return JSON.parse(
    readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8'),
  ) as StageData;
}

afterEach(() => {
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试
    }
  }
  roots.length = 0;
});

describe('TtsService 编排边界', () => {
  it('单句失败只跳过该句，其余照常生成并回写', async () => {
    const mixed = providerWith('mixed', async (request) => {
      if (request.text.includes('蛋糕')) throw errors.tts('模拟单句生成失败。');
      return local.synthesize(request);
    });
    const { tts, dir, projectId } = fixture([mixed]);
    const result = await tts.generate(projectId, {
      projectId,
      providerId: 'mixed',
      confirmed: true,
    });
    expect(result.generated).toHaveLength(2);
    expect(result.skipped).toEqual([
      { dialogueId: 'dlg-2', reason: '模拟单句生成失败。' },
    ]);
    const saved = stageFile(dir);
    expect(saved.scenes[0].dialogueEvents.find((item) => item.id === 'dlg-2')?.audioAssetId).toBeUndefined();
    expect(saved.scenes[0].dialogueEvents.filter((item) => item.audioAssetId)).toHaveLength(2);
  });

  it('全部失败时回滚：动画数据不变、无残留 wav、无 assets.json 写入', async () => {
    const failing = providerWith('failing', async () => {
      throw errors.tts('模拟 TTS 全部失败。');
    });
    const { tts, dir, projectId } = fixture([failing]);
    const before = readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8');
    await expect(
      tts.generate(projectId, { projectId, providerId: 'failing', confirmed: true }),
    ).rejects.toThrow(AppError);
    expect(readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8')).toBe(before);
    expect(existsSync(path.join(dir, 'audio', 'assets.json'))).toBe(false);
    expect(
      readdirSync(path.join(dir, 'audio')).filter((name) => name.endsWith('.wav')),
    ).toHaveLength(0);
  });

  it('角色级音色与语速覆盖通用参数，未设置的角色沿用全局默认', async () => {
    const { tts, stages, dir, projectId } = fixture([local]);
    const stage = stages.getStage(projectId);
    stages.saveStage(projectId, {
      ...stage,
      scenes: stage.scenes.map((scene) => ({
        ...scene,
        characters: scene.characters.map((character) => ({
          ...character,
          voiceId: 'voice-bright',
          speed: 1.5,
        })),
      })),
    });

    const result = await tts.generate(projectId, {
      projectId,
      providerId: 'local-tone',
      voiceId: 'voice-warm',
      speed: 1,
      confirmed: true,
    });
    expect(result.generated).toHaveLength(3);
    const assets = JSON.parse(
      readFileSync(path.join(dir, 'audio', 'assets.json'), 'utf8'),
    ) as { assets: Array<{ voiceId: string; speed: number; envelopeFps: number; language?: string }> };
    expect(assets.assets.every((asset) => asset.voiceId === 'voice-bright')).toBe(true);
    expect(assets.assets.every((asset) => asset.speed === 1.5)).toBe(true);
    expect(assets.assets.every((asset) => asset.envelopeFps === PROJECT_DEFAULTS.fps)).toBe(true);
    expect(assets.assets.every((asset) => asset.language === 'zh')).toBe(true);
  });
});

describe('TtsService 双语路由', () => {
  const bilingual: DialogueEvent[] = [
    { id: 'dlg-zh', characterId: 'char-1', text: '你回来了？', posture: 'sitting', startFrame: 0, durationFrames: 60, language: 'zh' },
    { id: 'dlg-th', characterId: 'char-1', text: 'สวัสดีครับ', posture: 'standing', startFrame: 75, durationFrames: 60, language: 'th' },
    { id: 'dlg-inherit', characterId: 'char-1', text: '我在这儿。', posture: 'standing', startFrame: 150, durationFrames: 60 },
  ];

  it('plan 按语言输出路由明细，缺省语言继承舞台默认', () => {
    const calls: string[] = [];
    const { tts, projectId } = fixture(
      [languageProvider('engine-zh', 'zh', calls), languageProvider('engine-th', 'th', calls)],
      bilingual,
    );
    const plan = tts.plan(projectId, { projectId });
    expect(plan.targetCount).toBe(3);
    expect(plan.routing).toHaveLength(2);
    expect(plan.routing.find((item) => item.language === 'zh')).toMatchObject({
      providerId: 'engine-zh',
      count: 2,
    });
    expect(plan.routing.find((item) => item.language === 'th')).toMatchObject({
      providerId: 'engine-th',
      count: 1,
    });
    expect(plan.dialogues.find((item) => item.dialogueId === 'dlg-inherit')?.language).toBe('zh');
    expect(plan.warning).toContain('按语言路由');
  });

  it('一次生成把中泰对白分别送到各自引擎，并写入 language 元数据', async () => {
    const calls: string[] = [];
    const { tts, dir, projectId } = fixture(
      [languageProvider('engine-zh', 'zh', calls), languageProvider('engine-th', 'th', calls)],
      bilingual,
    );
    const result = await tts.generate(projectId, { projectId, confirmed: true });
    expect(result.generated).toHaveLength(3);
    expect(result.skipped).toEqual([]);
    expect(calls.filter((item) => item.startsWith('engine-zh'))).toHaveLength(2);
    expect(calls.filter((item) => item.startsWith('engine-th'))).toHaveLength(1);
    expect(result.generated.find((item) => item.dialogueId === 'dlg-th')?.language).toBe('th');

    const assets = JSON.parse(
      readFileSync(path.join(dir, 'audio', 'assets.json'), 'utf8'),
    ) as { assets: Array<{ providerId: string; language?: string; sourceDialogueId: string }> };
    const byDialogue = new Map(assets.assets.map((asset) => [asset.sourceDialogueId, asset]));
    expect(byDialogue.get('dlg-zh')?.providerId).toBe('engine-zh');
    expect(byDialogue.get('dlg-th')?.providerId).toBe('engine-th');
    expect(byDialogue.get('dlg-th')?.language).toBe('th');
  });

  it('language 筛选只生成指定语言，另一语言不受影响', async () => {
    const calls: string[] = [];
    const { tts, projectId } = fixture(
      [languageProvider('engine-zh', 'zh', calls), languageProvider('engine-th', 'th', calls)],
      bilingual,
    );
    const plan = tts.plan(projectId, { projectId, language: 'th' });
    expect(plan.targetCount).toBe(1);
    expect(plan.language).toBe('th');
    expect(plan.routing).toHaveLength(1);
    const result = await tts.generate(projectId, { projectId, language: 'th', confirmed: true });
    expect(result.generated).toHaveLength(1);
    expect(result.generated[0].language).toBe('th');
    expect(calls.every((item) => item.startsWith('engine-th'))).toBe(true);
  });

  it('显式指定不支持该语言的引擎时单句跳过，不整体失败', async () => {
    const calls: string[] = [];
    const { tts, projectId } = fixture(
      [languageProvider('engine-zh-only', 'zh', calls)],
      bilingual,
    );
    const result = await tts.generate(projectId, {
      projectId,
      providerId: 'engine-zh-only',
      confirmed: true,
    });
    expect(result.generated).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].dialogueId).toBe('dlg-th');
    expect(result.skipped[0].reason).toContain('不支持泰语');
  });

  it('角色按语言音色覆盖，通用 voiceId 不会串到另一种语言', async () => {
    const { tts, stages, dir, projectId } = fixture([local], bilingual);
    const stage = stages.getStage(projectId);
    stages.saveStage(projectId, {
      ...stage,
      scenes: stage.scenes.map((scene) => ({
        ...scene,
        characters: scene.characters.map((character) => ({
          ...character,
          voiceId: 'voice-bright',
          voiceByLanguage: { th: 'voice-thai-calm' },
        })),
      })),
    });
    const result = await tts.generate(projectId, { projectId, confirmed: true });
    expect(result.generated).toHaveLength(3);
    const assets = JSON.parse(
      readFileSync(path.join(dir, 'audio', 'assets.json'), 'utf8'),
    ) as { assets: Array<{ voiceId: string; language?: string }> };
    expect(assets.assets.filter((asset) => asset.language === 'zh').every((a) => a.voiceId === 'voice-bright')).toBe(true);
    expect(assets.assets.filter((asset) => asset.language === 'th').every((a) => a.voiceId === 'voice-thai-calm')).toBe(true);
  });
});
