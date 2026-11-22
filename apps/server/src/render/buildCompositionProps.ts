import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  characterFrame,
  getStateAtFrame,
  resolveCharacterLayers,
} from '@animation/animation-core';
import {
  audioAssetFileSchema,
  detectSubtitleLanguage,
  PROJECT_DEFAULTS,
  resolutionById,
  subtitleLineHeight,
  videoFrameToProjectFrame,
  wrapSubtitle,
  type CharacterDescriptor,
  type RenderConfig,
  type RenderSceneSpan,
  type StageScene,
} from '@animation/shared';
import { errors } from '../errors';
import type { AssetService } from '../services/assetService';
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type CompositionProps,
  type RenderFrame,
  type RenderFrameChunk,
  type RenderFrameVisual,
  type RenderLayer,
  type SubtitleView,
} from './composition/props';
import { globalStartMs, locateFrame } from './sceneSpans';
import { buildTransitionPlan, transitionOpacity } from './transitions';

/** FFmpeg 合成音轨所需的真实音频片段（位置为全局时间轴毫秒，与导出帧率无关）。 */
export interface AudioTrack {
  file: string;
  startMs: number;
  durationMs: number;
}

export interface BuildPropsOptions {
  projectDir: string;
  assets: AssetService;
  /** 参与导出的场景，顺序即拼接顺序。 */
  scenes: readonly StageScene[];
  /** 与 scenes 一一对应的全局时间轴片段。 */
  spans: readonly RenderSceneSpan[];
  config: RenderConfig;
  totalFrames: number;
}

export interface BuildPropsResult {
  props: CompositionProps;
  audioTracks: AudioTrack[];
  /** 合并后的帧块数（远小于总帧数时说明 inputProps 已分块压缩）。 */
  frameChunkCount: number;
  /** inputProps 序列化后的真实字节数，供日志与体积回归验证。 */
  propsBytes: number;
}

interface ScenePrep {
  background: string | null;
  propEntries: Array<{ zIndex: number; layers: RenderLayer[] }>;
  descriptors: Map<string, CharacterDescriptor>;
}

function toDataUri(content: Buffer): string {
  return `data:image/svg+xml;base64,${content.toString('base64')}`;
}

function sameSubtitle(a: SubtitleView | null, b: SubtitleView | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.text === b.text &&
    a.characterName === b.characterName &&
    a.language === b.language &&
    a.lineHeight === b.lineHeight &&
    a.lines.length === b.lines.length &&
    a.lines.every((line, index) => line === b.lines[index])
  );
}

function sameLayer(a: RenderLayer, b: RenderLayer): boolean {
  return (
    a.src === b.src &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotation === b.rotation &&
    a.anchorX === b.anchorX &&
    a.anchorY === b.anchorY
  );
}

/** 两层画面是否完全一致；用于把连续相同的视频帧合并为一个帧块。 */
function sameVisual(a: RenderFrameVisual, b: RenderFrameVisual): boolean {
  if (a.background !== b.background || !sameSubtitle(a.subtitle, b.subtitle)) return false;
  if (a.layers.length !== b.layers.length) return false;
  return a.layers.every((layer, index) => sameLayer(layer, b.layers[index]));
}

function sameRenderFrame(a: RenderFrame, b: RenderFrame): boolean {
  if (!sameVisual(a, b)) return false;
  const left = a.transition ?? null;
  const right = b.transition ?? null;
  if (left === null || right === null) return left === right;
  return left.opacity === right.opacity && sameVisual(left.previous, right.previous);
}

/**
 * 把项目数据编译成 Remotion 的 inputProps。
 *
 * 严格复用共享动画核心：getStateAtFrame 决定每一帧的对白/姿态/嘴型/字幕，
 * characterFrame + resolveCharacterLayers 决定人物分层与坐标。
 * Remotion 侧只做绘制，不实现任何动画计算（架构 8 节 / ADR-005）。
 *
 * 多场景拼接：全局帧经 locateFrame 映射到「场景 + 场景内局部帧」，
 * 每帧携带自己的背景，因此场景切换点会自然换图；音频延迟按
 * 场景起始帧做全局偏移，保证第 2 个场景的声音落在正确位置。
 *
 * 分块渲染（控制 inputProps 体积）：逐帧求值后把连续「画面完全相同」的帧
 * 合并成 RenderFrameChunk，props 只保存帧块而不是 totalFrames 份绘制指令。
 * 体积与画面变化次数（字幕、姿态、嘴型、转场淡入）相关，不再随视频时长线性膨胀。
 *
 * 场景间转场：目标场景开头前 N 帧叠加上一场景最后一帧的定格画面做交叉淡化，
 * 不插入额外帧，因此 sceneSpans、音频偏移与导出总帧数都不变。
 */
export function buildCompositionProps(options: BuildPropsOptions): BuildPropsResult {
  const { projectDir, assets, scenes, spans, config, totalFrames } = options;
  if (scenes.length === 0 || scenes.length !== spans.length) {
    throw errors.render('导出场景与时间轴不一致，无法编译画面。');
  }
  const resolution = resolutionById(config.resolution);
  const images: Record<string, string> = {};
  const preps = new Map<string, ScenePrep>();

  // 1. 素材：所有导出场景的背景、道具、人物全部姿态与面部变体，内联成 data URI。
  //    同时按场景预计算静态道具层与人物描述，避免逐帧重复读取。
  for (const scene of scenes) {
    if (scene.backgroundAssetId) {
      images[scene.backgroundAssetId] = toDataUri(assets.readFile(scene.backgroundAssetId).content);
    }
    const descriptors = new Map<string, CharacterDescriptor>();
    for (const object of scene.objects) {
      if (!object.visible) continue;
      images[object.assetId] = toDataUri(assets.readFile(object.assetId).content);
    }
    for (const instance of scene.characters) {
      if (descriptors.has(instance.assetId)) continue;
      const descriptor = assets.getCharacter(instance.assetId).descriptor;
      descriptors.set(instance.assetId, descriptor);
      for (const posture of Object.values(descriptor.postures)) {
        for (const layer of posture.layers) {
          const key = `${instance.assetId}:${layer.file}`;
          // readLayer 内部会自动补 .svg 后缀。
          const relative = layer.file.replace(/\.svg$/i, '');
          images[key] = toDataUri(assets.readLayer(instance.assetId, relative).content);
        }
      }
    }

    // 静态道具层（锚点换算与 PixiJS 的 sprite.anchor 完全一致）。
    const propEntries = scene.objects
      .filter((object) => object.visible)
      .map((object) => {
        const asset = assets.get(object.assetId);
        const anchorX = asset.anchorX;
        const anchorY = asset.anchorY;
        return {
          zIndex: object.zIndex,
          layers: [
            {
              src: object.assetId,
              x: object.x - anchorX * object.width,
              y: object.y - anchorY * object.height,
              width: object.width,
              height: object.height,
              rotation: object.rotation,
              anchorX,
              anchorY,
            },
          ],
        };
      });

    preps.set(scene.id, {
      background: scene.backgroundAssetId ?? null,
      propEntries,
      descriptors,
    });
  }

  // 2. 音频：包络供嘴型求值，音频片段供 FFmpeg 合成。索引损坏不阻断无声导出。
  const readyAssets = new Map<string, { filePath: string; durationMs: number; envelope: number[] }>();
  try {
    const file = audioAssetFileSchema.parse(
      JSON.parse(readFileSync(path.join(projectDir, 'audio', 'assets.json'), 'utf8')) as unknown,
    );
    for (const asset of file.assets) {
      if (asset.status !== 'ready') continue;
      readyAssets.set(asset.id, {
        filePath: asset.filePath,
        durationMs: asset.durationMs,
        envelope: [...asset.envelope],
      });
    }
  } catch {
    // 校验阶段已给出「导出将无声音」提示；这里不伪造音频，也不静默降级为成功。
  }
  const envelopes: Record<string, number[]> = {};
  for (const [id, asset] of readyAssets) envelopes[id] = asset.envelope;

  const audioTracks: AudioTrack[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const span = spans[sceneIndex];
    for (const dialogue of scene.dialogueEvents) {
      if (!dialogue.audioAssetId) continue;
      const asset = readyAssets.get(dialogue.audioAssetId);
      if (!asset) continue;
      const file = path.resolve(projectDir, asset.filePath);
      if (!existsSync(file)) continue;
      audioTracks.push({
        file,
        startMs: globalStartMs(span, dialogue.startFrame, PROJECT_DEFAULTS.fps),
        durationMs: asset.durationMs,
      });
    }
  });

  // 3. 逐帧求值：全局帧 → 场景 + 局部帧；同时按画面状态合并帧块。
  const project = { scenes: [...scenes] };
  const transitionPlans = buildTransitionPlan(scenes, spans);
  const chunks: RenderFrameChunk[] = [];
  /** 每个场景最后一帧的画面，供下一场景转场淡出时定格。 */
  const lastVisualByScene = new Map<string, RenderFrameVisual>();
  let previousSpanIndex = -1;
  let previousVisual: RenderFrameVisual | null = null;

  for (let videoFrame = 0; videoFrame < totalFrames; videoFrame += 1) {
    const projectFrame = videoFrameToProjectFrame(videoFrame, config.fps);
    const location = locateFrame(spans, projectFrame);
    if (!location) throw errors.render('导出时间轴为空，无法计算帧状态。');
    const scene = scenes[location.spanIndex];
    const prep = preps.get(scene.id);
    if (!scene || !prep) throw errors.render(`场景「${location.span.sceneName}」的画面数据不可用。`);

    // 跨过场景边界时，把上一场景的最后一帧存下来作为转场淡出画面。
    if (previousSpanIndex !== location.spanIndex) {
      if (previousSpanIndex >= 0 && previousVisual) {
        lastVisualByScene.set(scenes[previousSpanIndex].id, previousVisual);
      }
      previousSpanIndex = location.spanIndex;
    }

    const state = getStateAtFrame(project, scene.id, location.localFrame, {
      fps: PROJECT_DEFAULTS.fps,
      audioEnvelopes: envelopes,
    });
    if (!state) {
      throw errors.render('动画帧状态计算失败，无法继续渲染。');
    }

    const entries = prep.propEntries.map((entry) => ({ ...entry }));
    for (const instance of scene.characters) {
      const frameCharacter = state.characters.find((item) => item.id === instance.id);
      if (frameCharacter && !frameCharacter.visible) continue;
      if (!instance.visible) continue;
      const descriptor = prep.descriptors.get(instance.assetId);
      if (!descriptor) {
        throw errors.render(`人物素材「${instance.assetId}」描述文件不可用。`);
      }
      const posture = descriptor.postures[frameCharacter?.posture ?? instance.posture];
      const placement = characterFrame(instance, posture);
      const layers = resolveCharacterLayers(
        { width: instance.width },
        posture,
        frameCharacter?.eyeState ?? instance.eyeState,
        frameCharacter?.mouthState ?? instance.mouthState,
      );
      entries.push({
        zIndex: instance.zIndex,
        layers: layers.map((layer) => ({
          src: `${instance.assetId}:${layer.file}`,
          x: placement.originX + layer.x,
          y: placement.originY + layer.y,
          width: layer.width,
          height: layer.height,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
        })),
      });
    }

    // 道具与人物共用一条 zIndex 序列，与工作台预览的混合图层顺序一致。
    entries.sort((a, b) => a.zIndex - b.zIndex);
    // 字幕排版在服务端预计算：泰文按字素簇断行、行高更大，Remotion 只绘制。
    let subtitle: SubtitleView | null = null;
    if (state.subtitle) {
      const text = state.subtitle.text;
      const language = detectSubtitleLanguage(text);
      subtitle = {
        text,
        characterName: state.subtitle.characterName,
        lines: wrapSubtitle(text, language, 18),
        lineHeight: subtitleLineHeight(language, 36),
        language,
      };
    }
    const visual: RenderFrameVisual = {
      background: prep.background,
      layers: entries.flatMap((entry) => entry.layers),
      subtitle,
    };

    const opacity = transitionOpacity(transitionPlans, location.spanIndex, location.localFrame);
    const previous = opacity === null
      ? null
      : lastVisualByScene.get(scenes[location.spanIndex - 1]?.id ?? '');
    const frame: RenderFrame = {
      ...visual,
      ...(opacity !== null && previous
        ? { transition: { previous, opacity } }
        : {}),
    };
    previousVisual = visual;

    // 连续相同的画面只保留一块，避免逐帧 inputProps 随视频时长线性膨胀。
    const last = chunks[chunks.length - 1];
    if (last && sameRenderFrame(last.frame, frame)) {
      last.toFrame = videoFrame + 1;
    } else {
      chunks.push({ fromFrame: videoFrame, toFrame: videoFrame + 1, frame });
    }
  }

  const props: CompositionProps = {
    width: resolution.width,
    height: resolution.height,
    fps: config.fps,
    durationInFrames: totalFrames,
    logicalWidth: LOGICAL_WIDTH,
    logicalHeight: LOGICAL_HEIGHT,
    assets: images,
    frameChunks: chunks,
  };

  return {
    props,
    audioTracks,
    frameChunkCount: chunks.length,
    propsBytes: Buffer.byteLength(JSON.stringify(props), 'utf8'),
  };
}
