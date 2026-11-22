import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { sceneDurationFrames } from '@animation/animation-core';
import {
  audioAssetFileSchema,
  DRAFT_TIMING,
  PROJECT_DEFAULTS,
  PROJECT_LANGUAGE_LABELS,
  resolveDialogueLanguage,
  TTS_AUDIO,
  type AudioAsset,
  type AudioAssetFile,
  type DialogueEvent,
  type ProjectLanguage,
  type StageData,
  type StageScene,
  type TtsGenerateRequest,
  type TtsGenerateResult,
  type TtsPlan,
  type TtsPlanRequest,
  type TtsRoutingEntry,
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
 *
 * 双语：每条对白按「显式 language > 舞台默认 language」求语言，再按语言路由
 * 支持该语言的引擎与音色；角色可按语言覆盖音色。混排项目一次生成即可各走各的引擎。
 * 多场景：生成范围覆盖**全部场景**的对白，但时间轴串排按场景各自独立进行。
 */

/** 场景内的一条对白；带上所属场景，便于按场景独立串排与定位角色。 */
interface DialogueTarget {
  scene: StageScene;
  dialogue: DialogueEvent;
}

interface RoutedParams {
  provider: TtsSynthesisProvider;
  voiceId: string;
  speed: number;
  language: ProjectLanguage;
}

function flattenDialogues(stage: StageData): DialogueTarget[] {
  return stage.scenes.flatMap((scene) =>
    scene.dialogueEvents.map((dialogue) => ({ scene, dialogue })),
  );
}

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
    const stage = this.stages.getStage(projectId);
    if (stage.scenes.length === 0) {
      throw errors.validation('项目还没有场景，请先创建动画草稿。');
    }
    // 覆盖全部场景；dialogueIds 与 language 都支持跨场景过滤。
    const targets = this.selectTargets(stage, request);
    const assets = this.readAssetFile(projectId);
    const readyIds = new Set(
      assets.assets.filter((item) => item.status === 'ready').map((item) => item.id),
    );

    const dialogues = targets.map(({ scene, dialogue }) => {
      const routed = this.resolveForDialogue(scene, dialogue, stage.language, request);
      return {
        dialogueId: dialogue.id,
        sceneName: scene.name,
        characterName:
          scene.characters.find((item) => item.id === dialogue.characterId)?.name ?? '未绑定角色',
        text: dialogue.text,
        language: routed.language,
        providerId: routed.provider.descriptor.id,
        voiceId: routed.voiceId,
        currentStartFrame: dialogue.startFrame,
        currentDurationFrames: dialogue.durationFrames,
        manuallyTimed: Boolean(dialogue.manuallyTimed),
        hasAudio: Boolean(dialogue.audioAssetId && readyIds.has(dialogue.audioAssetId)),
      };
    });
    const routing = this.buildRouting(dialogues);
    const primary = dialogues[0];
    const fallbackProvider = this.providers.resolve(request.providerId);
    const protectedCount = dialogues.filter((item) => item.manuallyTimed).length;
    const firstScene = stage.scenes[0];

    return {
      providerId: primary?.providerId ?? fallbackProvider.descriptor.id,
      voiceId: primary?.voiceId ?? fallbackProvider.descriptor.defaultVoiceId,
      speed: primary ? this.providers.normalize(
        this.providers.resolve(primary.providerId), primary.voiceId, request.speed, primary.language,
      ).speed : this.providers.normalize(fallbackProvider, undefined, request.speed).speed,
      ...(request.language ? { language: request.language } : {}),
      routing,
      targetCount: dialogues.length,
      dialogues,
      protectedCount,
      replacingCount: dialogues.filter((item) => item.hasAudio).length,
      currentSceneDurationFrames: firstScene ? sceneDurationFrames(firstScene) : 0,
      sceneCount: new Set(targets.map((item) => item.scene.id)).size,
      projectDurationFrames: stage.scenes.reduce(
        (total, scene) => total + sceneDurationFrames(scene),
        0,
      ),
      warning: this.warningText(protectedCount, stage.scenes.length, routing),
    };
  }

  /**
   * 生成配音并回写真实时长。confirmed 由共享 Schema 强制为 true；
   * 单句失败只跳过该句，不阻断其他对白（PRD 13「每句独立生成」）。
   */
  async generate(projectId: string, request: TtsGenerateRequest): Promise<TtsGenerateResult> {
    const dir = this.projectDir(projectId);
    const stage = this.stages.getStage(projectId);
    if (stage.scenes.length === 0) {
      throw errors.validation('项目还没有场景，请先创建动画草稿。');
    }
    const targets = this.selectTargets(stage, request);
    if (targets.length === 0) {
      const first = stage.scenes[0];
      return {
        stage,
        audio: this.readAssetFile(projectId),
        generated: [],
        skipped: [{ dialogueId: '-', reason: '项目中没有符合当前语言筛选的可生成对白。' }],
        sceneDurationFrames: first ? sceneDurationFrames(first) : 0,
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
    /** 时间轴串排按场景各自独立：对白 startFrame 是场景内局部帧。 */
    const updatesByScene = new Map<string, Map<string, { assetId: string; durationFrames: number }>>(
      stage.scenes.map((scene) => [scene.id, new Map()]),
    );

    for (const [index, { scene, dialogue }] of targets.entries()) {
      let synthesis: TtsSynthesisResult | undefined;
      let routed: RoutedParams | undefined;
      try {
        routed = this.resolveForDialogue(scene, dialogue, stage.language, request);
        synthesis = await routed.provider.synthesize({
          text: dialogue.text,
          voiceId: routed.voiceId,
          speed: routed.speed,
          fps: PROJECT_DEFAULTS.fps,
          language: routed.language,
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
        providerId: routed.provider.descriptor.id,
        voiceId: routed.voiceId,
        speed: routed.speed,
        language: routed.language,
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
      updatesByScene.get(scene.id)?.set(dialogue.id, { assetId, durationFrames });
      generated.push({
        dialogueId: dialogue.id,
        assetId,
        durationMs: synthesis.durationMs,
        durationFrames,
        startFrame: dialogue.startFrame,
        language: routed.language,
      });
    }

    if (generated.length === 0) {
      this.rollback(createdFiles, assetsPath, previousFile, hadIndex);
      throw errors.tts(`所有对白配音生成失败：${skipped[0]?.reason ?? '未知原因'}`);
    }

    const nextScenes = stage.scenes.map((scene) => {
      const updates = updatesByScene.get(scene.id);
      if (!updates || updates.size === 0) return scene;
      return { ...scene, dialogueEvents: this.reflowDialogues(scene.dialogueEvents, updates) };
    });
    const nextStage: StageData = { ...stage, scenes: nextScenes };

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

    const startById = new Map(
      savedStage.scenes.flatMap((scene) =>
        scene.dialogueEvents.map((event) => [event.id, event.startFrame] as const),
      ),
    );
    const savedFirst = savedStage.scenes[0];
    return {
      stage: savedStage,
      audio: nextFile,
      generated: generated.map((item) => ({
        ...item,
        startFrame: startById.get(item.dialogueId) ?? item.startFrame,
      })),
      skipped,
      sceneDurationFrames: savedFirst ? sceneDurationFrames(savedFirst) : 0,
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

  /**
   * 单句路由：语言 → 支持该语言的引擎 → 该语言的音色 → 语速夹取。
   * 用户全局音色与角色通用音色若属于别的语言会被忽略（不静默错配），
   * 角色按语言覆盖优先；引擎不支持该语言时明确报错，由调用方按句跳过。
   */
  private resolveForDialogue(
    scene: StageScene,
    dialogue: DialogueEvent,
    stageLanguage: ProjectLanguage,
    request: TtsPlanRequest,
  ): RoutedParams {
    const language = resolveDialogueLanguage(dialogue.language, stageLanguage);
    const provider = this.providers.resolveFor(language, request.providerId);
    const voices = provider.descriptor.voices;
    // 用户明确指定的音色若根本不存在，必须报错，不能静默忽略（PRD 13）。
    if (
      request.voiceId &&
      !this.providers
        .list()
        .some((descriptor) => descriptor.voices.some((voice) => voice.id === request.voiceId))
    ) {
      throw errors.tts(`声音「${request.voiceId}」不属于当前 TTS 引擎。`);
    }
    const usable = (voiceId?: string): string | undefined =>
      voiceId && voices.some((voice) => voice.id === voiceId && voice.language === language)
        ? voiceId
        : undefined;

    // 优先级：角色按语言覆盖 > 角色通用覆盖 > 用户全局选择 > 引擎语言默认。
    // 全局音色若属于另一种语言则忽略，保证混排项目不会把中文音色套到泰语对白上。
    const character = scene.characters.find((item) => item.id === dialogue.characterId);
    const voiceId =
      usable(character?.voiceByLanguage?.[language]) ??
      usable(character?.voiceId) ??
      usable(request.voiceId) ??
      this.providers.defaultVoiceFor(provider, language);
    const speed = character?.speed ?? request.speed ?? provider.descriptor.defaultSpeed;
    const normalized = this.providers.normalize(provider, voiceId, speed, language);
    return {
      provider,
      voiceId: normalized.voiceId,
      speed: normalized.speed,
      language,
    };
  }

  /** 按「语言 + 引擎 + 音色」汇总路由明细，供前端展示双语配音方案。 */
  private buildRouting(
    dialogues: ReadonlyArray<{
      language: ProjectLanguage;
      providerId: string;
      voiceId: string;
    }>,
  ): TtsRoutingEntry[] {
    const groups = new Map<string, TtsRoutingEntry>();
    for (const item of dialogues) {
      const key = `${item.language}|${item.providerId}|${item.voiceId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const provider = this.providers.resolve(item.providerId);
      const voice = provider.descriptor.voices.find((entry) => entry.id === item.voiceId);
      groups.set(key, {
        language: item.language,
        providerId: item.providerId,
        providerName: provider.descriptor.name,
        voiceId: item.voiceId,
        voiceName: voice?.name ?? item.voiceId,
        count: 1,
      });
    }
    return [...groups.values()];
  }

  private selectTargets(stage: StageData, request: TtsPlanRequest): DialogueTarget[] {
    const all = flattenDialogues(stage);
    const selected = this.selectDialogues(all, request.dialogueIds);
    if (!request.language) return selected;
    return selected.filter(
      ({ dialogue }) => resolveDialogueLanguage(dialogue.language, stage.language) === request.language,
    );
  }

  private selectDialogues(
    all: readonly DialogueTarget[],
    ids?: readonly string[],
  ): DialogueTarget[] {
    if (!ids) return [...all];
    const known = new Set(all.map((item) => item.dialogue.id));
    for (const id of ids) {
      if (!known.has(id)) {
        throw errors.validation(`对白「${id}」不存在，无法生成配音。`);
      }
    }
    const wanted = new Set(ids);
    return all.filter((item) => wanted.has(item.dialogue.id));
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

  private warningText(
    protectedCount: number,
    sceneCount: number,
    routing: readonly TtsRoutingEntry[],
  ): string {
    const routingText = routing.length
      ? `本次按语言路由：${routing
          .map(
            (item) =>
              `${PROJECT_LANGUAGE_LABELS[item.language]} ${item.count} 句 → ${item.providerName} / ${item.voiceName}`,
          )
          .join('；')}。`
      : '本次没有可生成配音的对白。';
    return [
      routingText,
      `生成后按音频真实时长重设对白时长：向上取整并追加 ${TTS_AUDIO.tailFrames} 帧余量，保证配音不会被提前截断。`,
      `未手动调整的对白会按新时长重新串排；${protectedCount > 0 ? `其中 ${protectedCount} 句已手动调整时间，起始位置不会被自动移动，时长只延长不缩短。` : '当前没有手动调整过的对白。'}`,
      `重新生成会创建新音频资产并更新引用，旧文件保留但标记为已替换，不会留下悬空引用。本次按场景顺序处理全部 ${sceneCount} 个场景，各场景分别串排时间轴，多场景导出时配音不会跨场景错位。`,
    ].join(' ');
  }
}
