import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  characterFrame,
  getStateAtFrame,
  resolveCharacterLayers,
} from '@animation/animation-core';
import {
  audioAssetFileSchema,
  PROJECT_DEFAULTS,
  resolutionById,
  videoFrameToProjectFrame,
  type CharacterDescriptor,
  type RenderConfig,
  type StageData,
  type StageScene,
} from '@animation/shared';
import { errors } from '../errors';
import type { AssetService } from '../services/assetService';
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type CompositionProps,
  type RenderFrame,
  type RenderLayer,
} from './composition/props';

/** FFmpeg 合成音轨所需的真实音频片段（位置来自项目逻辑帧，与导出帧率无关）。 */
export interface AudioTrack {
  file: string;
  startMs: number;
  durationMs: number;
}

export interface BuildPropsOptions {
  projectDir: string;
  assets: AssetService;
  stage: StageData;
  scene: StageScene;
  config: RenderConfig;
  totalFrames: number;
}

export interface BuildPropsResult {
  props: CompositionProps;
  audioTracks: AudioTrack[];
}

function toDataUri(content: Buffer): string {
  return `data:image/svg+xml;base64,${content.toString('base64')}`;
}

/**
 * 把项目数据编译成 Remotion 的 inputProps。
 *
 * 严格复用共享动画核心：getStateAtFrame 决定每一帧的对白/姿态/嘴型/字幕，
 * characterFrame + resolveCharacterLayers 决定人物分层与坐标。
 * Remotion 侧只做绘制，不实现任何动画计算（架构 8 节 / ADR-005）。
 */
export function buildCompositionProps(options: BuildPropsOptions): BuildPropsResult {
  const { projectDir, assets, stage, scene, config, totalFrames } = options;
  const resolution = resolutionById(config.resolution);
  const images: Record<string, string> = {};

  // 1. 素材：背景、道具、人物所有姿态与面部变体，全部内联成 data URI。
  if (scene.backgroundAssetId) {
    images[scene.backgroundAssetId] = toDataUri(assets.readFile(scene.backgroundAssetId).content);
  }
  for (const object of scene.objects) {
    if (!object.visible) continue;
    images[object.assetId] = toDataUri(assets.readFile(object.assetId).content);
  }

  const descriptors = new Map<string, CharacterDescriptor>();
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
  for (const dialogue of scene.dialogueEvents) {
    if (!dialogue.audioAssetId) continue;
    const asset = readyAssets.get(dialogue.audioAssetId);
    if (!asset) continue;
    const file = path.resolve(projectDir, asset.filePath);
    if (!existsSync(file)) continue;
    audioTracks.push({
      file,
      startMs: (dialogue.startFrame / PROJECT_DEFAULTS.fps) * 1000,
      durationMs: asset.durationMs,
    });
  }

  // 3. 静态道具层（锚点换算与 PixiJS 的 sprite.anchor 完全一致）。
  const propEntries: Array<{ zIndex: number; layers: RenderLayer[] }> = scene.objects
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

  const project = { scenes: stage.scenes };
  const frames: RenderFrame[] = [];

  for (let videoFrame = 0; videoFrame < totalFrames; videoFrame += 1) {
    const projectFrame = videoFrameToProjectFrame(videoFrame, config.fps);
    const state = getStateAtFrame(project, scene.id, projectFrame, {
      fps: PROJECT_DEFAULTS.fps,
      audioEnvelopes: envelopes,
    });
    if (!state) {
      throw errors.render('动画帧状态计算失败，无法继续渲染。');
    }

    const entries = propEntries.map((entry) => ({ ...entry }));
    for (const instance of scene.characters) {
      const frameCharacter = state.characters.find((item) => item.id === instance.id);
      if (frameCharacter && !frameCharacter.visible) continue;
      if (!instance.visible) continue;
      const descriptor = descriptors.get(instance.assetId);
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
    frames.push({
      layers: entries.flatMap((entry) => entry.layers),
      subtitle: state.subtitle
        ? { text: state.subtitle.text, characterName: state.subtitle.characterName }
        : null,
    });
  }

  return {
    props: {
      width: resolution.width,
      height: resolution.height,
      fps: config.fps,
      durationInFrames: totalFrames,
      logicalWidth: LOGICAL_WIDTH,
      logicalHeight: LOGICAL_HEIGHT,
      assets: images,
      background: scene.backgroundAssetId ?? null,
      frames,
    },
    audioTracks,
  };
}
