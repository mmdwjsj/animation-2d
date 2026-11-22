import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDefaultStage,
  PROJECT_DEFAULTS,
  type CharacterInstance,
  type DialogueEvent,
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
  synthesize: (request: TtsSynthesisRequest) => TtsSynthesisResult,
): TtsSynthesisProvider {
  return { descriptor: { ...local.descriptor, id }, synthesize };
}

function fixture(providerIds: TtsSynthesisProvider[]) {
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
  const dialogues: DialogueEvent[] = [
    { id: 'dlg-1', characterId: 'char-1', text: '你回来了？', posture: 'sitting', startFrame: 0, durationFrames: 60 },
    { id: 'dlg-2', characterId: 'char-1', text: '我的蛋糕呢？', posture: 'standing', startFrame: 75, durationFrames: 60 },
    { id: 'dlg-3', characterId: 'char-1', text: '这是牙膏！', posture: 'standing', startFrame: 150, durationFrames: 60 },
  ];
  const base = createDefaultStage(projectId);
  const stage: StageData = {
    ...base,
    scenes: [{ ...base.scenes[0], characters: [character], dialogueEvents: dialogues }],
  };
  writeFileSync(path.join(dir, 'animation', 'animation.json'), JSON.stringify(stage), 'utf8');

  const assets = new AssetService(path.join(appConfig.repoRoot, 'assets'));
  const stages = new StageService(assets, projectsDir);
  const tts = new TtsService(new TtsProviderRegistry(providerIds), stages, projectsDir);
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
  it('单句失败只跳过该句，其余照常生成并回写', () => {
    const mixed = providerWith('mixed', (request) => {
      if (request.text.includes('蛋糕')) throw errors.tts('模拟单句生成失败。');
      return local.synthesize(request);
    });
    const { tts, dir, projectId } = fixture([mixed]);
    const result = tts.generate(projectId, {
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

  it('全部失败时回滚：动画数据不变、无残留 wav、无 assets.json 写入', () => {
    const failing = providerWith('failing', () => {
      throw errors.tts('模拟 TTS 全部失败。');
    });
    const { tts, dir, projectId } = fixture([failing]);
    const before = readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8');
    expect(() =>
      tts.generate(projectId, { projectId, providerId: 'failing', confirmed: true }),
    ).toThrow(AppError);
    expect(readFileSync(path.join(dir, 'animation', 'animation.json'), 'utf8')).toBe(before);
    expect(existsSync(path.join(dir, 'audio', 'assets.json'))).toBe(false);
    expect(
      readdirSync(path.join(dir, 'audio')).filter((name) => name.endsWith('.wav')),
    ).toHaveLength(0);
  });

  it('角色级音色与语速覆盖通用参数，未设置的角色沿用全局默认', () => {
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

    const result = tts.generate(projectId, {
      projectId,
      providerId: 'local-tone',
      voiceId: 'voice-warm',
      speed: 1,
      confirmed: true,
    });
    expect(result.generated).toHaveLength(3);
    const assets = JSON.parse(
      readFileSync(path.join(dir, 'audio', 'assets.json'), 'utf8'),
    ) as { assets: Array<{ voiceId: string; speed: number; envelopeFps: number }> };
    expect(assets.assets.every((asset) => asset.voiceId === 'voice-bright')).toBe(true);
    expect(assets.assets.every((asset) => asset.speed === 1.5)).toBe(true);
    expect(assets.assets.every((asset) => asset.envelopeFps === PROJECT_DEFAULTS.fps)).toBe(true);
  });
});
