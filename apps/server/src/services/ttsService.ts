import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { sceneDurationFrames } from '@animation/animation-core';
import {
  audioAssetFileSchema,
  DRAFT_TIMING,
  PROJECT_DEFAULTS,
  TTS_AUDIO,
  type AudioAsset,
  type AudioAssetFile,
  type DialogueEvent,
  type StageData,
  type StageScene,
  type TtsGenerateRequest,
  type TtsGenerateResult,
  type TtsPlan,
  type TtsPlanRequest,
} from '@animation/shared';
import { appConfig } from '../config';
import { errors } from '../errors';
import { atomicWriteBuffer, atomicWriteJson } from '../utils/atomicWrite';
import { assertProjectId, resolveProjectDir } from '../utils/projectPaths';
import type { StageService } from './stageService';
import type { TtsProviderRegistry, TtsSynthesisProvider, TtsSynthesisResult } from './tts/provider';

/**
 * TTS 编排服务（架构 5.7 / 9 / 11 节，PRD 12.3 / 13）。
 *
 * 职责边界：
 * - 只依赖统一 Provider 接口，不写死任何厂商参数；
 * - 音频文件与元数据放文件系统，不进 SQLite；
 * - 原始剧本、解析草稿、动画数据仍互不覆盖；
 * - plan 只读说明影响，generate 仅在 confirmed=true 时写回动画数据。
 */
export class TtsService {
  private readonly projectsDir: string;

  constructor(
    private readonly providers: TtsProviderRegistry,
    private readonly stages: StageService,
    projectsDir: string = appConfig.projectsDir,
  ) {
    this.projectsDir = path.resolve(projectsDir);
  }

  listProviders() {
    return this.providers.list();
  }

  /** 供前端构建音频包络索引与音频轨道；文件缺失不影响读取元数据。 */
  listAudio(projectId: string): AudioAssetFile {
    this.projectDir(projectId);
    return this.readAssetFile(projectId);
  }

  /** 试听：只暴露 assets.json 中已登记且真实存在的 wav，避免路径穿越。 */
  readAudio(projectId: string, assetId: string): { buffer: Buffer; asset: AudioAsset } {
    const dir = this.projectDir(projectId);
    const asset = this.readAssetFile(projectId).assets.find((item) => item.id === assetId);
    if (!asset) throw errors.assetNotFound('音频资产不存在或已被移除。');
    const filePath = path.resolve(dir, asset.filePath);
    if (!filePath.startsWith(path.resolve(dir, 'audio') + path.sep)) {
      throw errors.validation('非法的音频文件路径。');
    }
    try {
      return { buffer: readFileSync(filePath), asset };
    } catch (cause) {
      throw errors.io('音频文件缺失或无法读取。', cause);
    }
  }

  /** 只读影响预览：不生成音频、不写盘、不改动动画数据。 */
  plan(projectId: string, request: TtsPlanRequest): TtsPlan {
    const provider = this.providers.resolve(request.providerId);
    const normalized = this.providers.normalize(provider, request.voiceId, request.speed);
    const { scene, stage } = this.sceneOf(projectId);
    const targets = this.selectDialogues(scene, request.dialogueIds);
    const assets = this.readAssetFile(projectId);
    const readyIds = new Set(
      assets.assets.filter((item) => item.status === 'ready').map((item) => item.id),
    );

    const dialogues = targets.map((dialogue) => ({
      dialogueId: dialogue.id,
      characterName:
        scene.characters.find((item) => item.id === dialogue.characterId)?.name ?? '未绑定角色',
      text: dialogue.text,
      currentStartFrame: dialogue.startFrame,
      currentDurationFrames: dialogue.durationFrames,
      manuallyTimed: Boolean(dialogue.manuallyTimed),
      hasAudio: Boolean(dialogue.audioAssetId && readyIds.has(dialogue.audioAssetId)),
    }));
    const protectedCount = dialogues.filter((item) => item.manuallyTimed).length;

    return {
      providerId: provider.descriptor.id,
      voiceId: normalized.voiceId,
      speed: normalized.speed,
      targetCount: dialogues.length,
      dialogues,
      protectedCount,
      replacingCount: dialogues.filter((item) => item.hasAudio).length,
      currentSceneDurationFrames: sceneDurationFrames(scene),
      warning: this.warningText(protectedCount, stage.scenes.length),
    };
  }

  /**
   * 生成配音并回写真实时长。confirmed 由共享 Schema 强制为 true；
   * 单句失败只跳过该句，不阻断其他对白（PRD 13「每句独立生成」）。
   */
  generate(projectId: string, request: TtsGenerateRequest): TtsGenerateResult {
    const dir = this.projectDir(projectId);
    const provider = this.providers.resolve(request.providerId);
    const normalized = this.providers.normalize(provider, request.voiceId, request.speed);
    const { scene, stage } = this.sceneOf(projectId);
    const targets = this.selectDialogues(scene, request.dialogueIds);
    if (targets.length === 0) {
      return {
        stage,
        audio: this.readAssetFile(projectId),
        generated: [],
        skipped: [{ dialogueId: '-', reason: '当前场景没有可生成配音的对白。' }],
        sceneDurationFrames: sceneDurationFrames(scene),
      };
    }

    const audioDir = path.join(dir, 'audio');
    mkdirSync(audioDir, { recursive: true });
    const assetsPath = path.join(audioDir, 'assets.json');
    const hadIndex = existsSync(assetsPath);
    const previousFile = this.readAssetFile(projectId);
    const nextAssets = previousFile.assets.map((asset) => ({ ...asset }));
    const generated: TtsGenerateResult['generated'] = [];
    const skipped: TtsGenerateResult['skipped'] = [];
    const createdFiles: string[] = [];
    const updates = new Map<string, { assetId: string; durationFrames: number }>();

    for (const [index, dialogue] of targets.entries()) {
      const params = this.resolveParams(provider, scene, dialogue, normalized);
      let synthesis: TtsSynthesisResult | undefined;
      try {
        synthesis = params.provider.synthesize({
          text: dialogue.text,
          voiceId: params.voiceId,
          speed: params.speed,
          fps: PROJECT_DEFAULTS.fps,
        });
      } catch (cause) {
        skipped.push({
          dialogueId: dialogue.id,
          reason: cause instanceof Error ? cause.message : '该句配音生成失败，已跳过。',
        });
        continue;
      }

      const audioFrames = Math.ceil((synthesis.durationMs / 1000) * PROJECT_DEFAULTS.fps);
      // 防截断：向上取整 + 尾部余量，且不小于最短对白帧数。
      // 未手动调整的对白按真实时长「重设」；手动调整过的只延长不缩短（PRD 12.3 保护策略）。
      const floorFrames = Math.max(
        audioFrames + TTS_AUDIO.tailFrames,
        TTS_AUDIO.minDialogueFrames,
      );
      const durationFrames = dialogue.manuallyTimed
        ? Math.max(floorFrames, dialogue.durationFrames)
        : floorFrames;
      const assetId = `audio-${synthesis.textHash}-${String(previousFile.assets.length + index + 1).padStart(3, '0')}`;
      const filePath = `audio/${assetId}.wav`;
      const absolute = path.join(audioDir, `${assetId}.wav`);

      const asset: AudioAsset = {
        id: assetId,
        filePath,
        durationMs: synthesis.durationMs,
        sampleRate: synthesis.sampleRate,
        channels: synthesis.channels,
        format: synthesis.format,
        providerId: params.provider.descriptor.id,
        voiceId: params.voiceId,
        speed: params.speed,
        sourceDialogueId: dialogue.id,
        textHash: synthesis.textHash,
        createdAt: new Date().toISOString(),
        status: 'ready',
        envelope: synthesis.envelope,
        envelopeFps: synthesis.envelopeFps,
      };

      try {
        atomicWriteBuffer(absolute, synthesis.audio);
      } catch (cause) {
        throw errors.tts(`写入配音文件失败：${cause instanceof Error ? cause.message : '未知错误'}`);
      }
      createdFiles.push(absolute);

      // 同一对白的旧资产标记替换，不删除文件（AGENTS 8：不擅自删除用户数据），
      // 新资产立即登记，保证落盘后没有任何指向旧文件的悬空引用。
      for (const existing of nextAssets) {
        if (existing.sourceDialogueId === dialogue.id && existing.status === 'ready') {
          existing.status = 'superseded';
        }
      }
      nextAssets.push(asset);
      updates.set(dialogue.id, { assetId, durationFrames });
      generated.push({
        dialogueId: dialogue.id,
        assetId,
        durationMs: synthesis.durationMs,
        durationFrames,
        startFrame: dialogue.startFrame,
      });
    }

    if (generated.length === 0) {
      this.rollback(createdFiles, assetsPath, previousFile, hadIndex);
      throw errors.tts(`所有对白配音生成失败：${skipped[0]?.reason ?? '未知原因'}`);
    }

    const nextEvents = this.reflowDialogues(scene.dialogueEvents, updates);
    const nextStage: StageData = {
      ...stage,
      scenes: stage.scenes.map((item) =>
        item.id === scene.id ? { ...item, dialogueEvents: nextEvents } : item,
      ),
    };

    const nextFile: AudioAssetFile = {
      version: previousFile.version + 1,
      assets: nextAssets,
    };

    let savedStage: StageData;
    try {
      atomicWriteJson(assetsPath, nextFile);
      savedStage = this.stages.saveStage(projectId, nextStage);
    } catch (cause) {
      // 动画数据保存失败：回滚元数据与新建音频文件，绝不留下「引用了写坏的数据」。
      this.rollback(createdFiles, assetsPath, previousFile, hadIndex);
      throw errors.io('配音已生成但动画数据保存失败，原有动画数据未被修改，请重试。', cause);
    }

    const savedScene = savedStage.scenes.find((item) => item.id === scene.id) ?? scene;
    const startById = new Map(
      savedScene.dialogueEvents.map((event) => [event.id, event.startFrame]),
    );
    return {
      stage: savedStage,
      audio: nextFile,
      generated: generated.map((item) => ({
        ...item,
        startFrame: startById.get(item.dialogueId) ?? item.startFrame,
      })),
      skipped,
      sceneDurationFrames: sceneDurationFrames(savedScene),
    };
  }

  /** 按既定间隔串排；手动调整过的对白不移动起始帧（PRD 12.3 保护策略）。 */
  private reflowDialogues(
    events: readonly DialogueEvent[],
    updates: ReadonlyMap<string, { assetId: string; durationFrames: number }>,
  ): DialogueEvent[] {
    const withUpdates = events.map((event) => {
      const update = updates.get(event.id);
      return update
        ? { ...event, audioAssetId: update.assetId, durationFrames: update.durationFrames }
        : { ...event };
    });
    const ordered = withUpdates
      .slice()
      .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
    let cursor = 0;
    return ordered.map((event) => {
      const gap = DRAFT_TIMING.gapFrames;
      if (event.manuallyTimed) {
        cursor = Math.max(cursor, event.startFrame + event.durationFrames + gap);
        return event;
      }
      const startFrame = cursor;
      cursor = startFrame + event.durationFrames + gap;
      return { ...event, startFrame };
    });
  }

  /** 角色级音色 / 语速覆盖通用参数；引擎由 Provider 注册表全局决定。 */
  private resolveParams(
    defaultProvider: TtsSynthesisProvider,
    scene: StageScene,
    dialogue: DialogueEvent,
    base: { voiceId: string; speed: number },
  ): { provider: TtsSynthesisProvider; voiceId: string; speed: number } {
    const character = scene.characters.find((item) => item.id === dialogue.characterId);
    const normalized = this.providers.normalize(
      defaultProvider,
      character?.voiceId ?? base.voiceId,
      character?.speed ?? base.speed,
    );
    return { provider: defaultProvider, ...normalized };
  }

  private selectDialogues(scene: StageScene, ids?: readonly string[]): DialogueEvent[] {
    if (!ids) return scene.dialogueEvents.slice();
    const known = new Set(scene.dialogueEvents.map((event) => event.id));
    for (const id of ids) {
      if (!known.has(id)) {
        throw errors.validation(`对白「${id}」不存在，无法生成配音。`);
      }
    }
    const wanted = new Set(ids);
    return scene.dialogueEvents.filter((event) => wanted.has(event.id));
  }

  private sceneOf(projectId: string): { scene: StageScene; stage: StageData } {
    const stage = this.stages.getStage(projectId);
    const scene =
      stage.scenes.find((item) => item.id === stage.activeSceneId) ?? stage.scenes[0] ?? null;
    if (!scene) throw errors.validation('项目还没有场景，请先创建动画草稿。');
    return { scene, stage };
  }

  private readAssetFile(projectId: string): AudioAssetFile {
    const filePath = path.join(this.projectDir(projectId), 'audio', 'assets.json');
    if (!existsSync(filePath)) return audioAssetFileSchema.parse({ version: 0, assets: [] });
    try {
      return audioAssetFileSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
    } catch (cause) {
      throw errors.io('音频资产索引校验失败，文件可能已损坏。', cause);
    }
  }

  private rollback(
    createdFiles: readonly string[],
    assetsPath: string,
    previous: AudioAssetFile,
    hadIndex: boolean,
  ): void {
    for (const file of createdFiles) {
      try {
        rmSync(file, { force: true });
      } catch {
        // 回滚清理失败不覆盖主错误，后续由人工检查
      }
    }
    try {
      if (hadIndex) {
        atomicWriteJson(assetsPath, previous);
      } else {
        // 原本没有索引：删除本次可能写出的文件，保证失败后零变化。
        rmSync(assetsPath, { force: true });
      }
    } catch {
      // 同上
    }
  }

  private projectDir(id: string): string {
    assertProjectId(id);
    const dir = resolveProjectDir(this.projectsDir, id);
    if (!existsSync(path.join(dir, 'project.json'))) {
      throw errors.notFound('项目不存在或已被删除。');
    }
    return dir;
  }

  private warningText(protectedCount: number, sceneCount: number): string {
    return [
      `生成后按音频真实时长重设对白时长：向上取整并追加 ${TTS_AUDIO.tailFrames} 帧余量，保证配音不会被提前截断。`,
      `未手动调整的对白会按新时长重新串排；${protectedCount > 0 ? `其中 ${protectedCount} 句已手动调整时间，起始位置不会被自动移动，时长只延长不缩短。` : '当前没有手动调整过的对白。'}`,
      `重新生成会创建新音频资产并更新引用，旧文件保留但标记为已替换，不会留下悬空引用。当前共 ${sceneCount} 个场景，本次只影响当前场景。`,
    ].join(' ');
  }
}
