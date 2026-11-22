import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sceneDurationFrames } from '@animation/animation-core';
import {
  audioAssetFileSchema,
  PROJECT_DEFAULTS,
  projectSchema,
  resampleFrames,
  stageDataSchema,
  type RenderCheck,
  type RenderValidation,
  type StageData,
  type StageScene,
} from '@animation/shared';
import { z } from 'zod';
import { errors } from '../errors';
import type { AssetService } from '../services/assetService';
import { assertProjectId, resolveProjectDir } from '../utils/projectPaths';

/**
 * PRD 14 导出步骤 1-5：检查项目数据、场景与人物素材、对白与音频、时间轴，
 * 并计算总帧数。只读，不写盘、不修改动画数据。
 *
 * 检查结果区分「阻断」与「提示」：素材缺失、动画数据损坏、时间轴非法会阻断；
 * 缺少配音只提示（允许导出无声视频，符合 PRD 12.3「没有音频时允许估算时长」）。
 */
export interface RenderValidationDeps {
  projectsDir: string;
  assets: AssetService;
  exportFps?: number;
}

function readJson(dir: string, ...relative: string[]): unknown {
  return JSON.parse(readFileSync(path.join(dir, ...relative), 'utf8')) as unknown;
}

function check(
  id: RenderCheck['id'],
  label: string,
  blocking: boolean,
  ok: boolean,
  okDetail: string,
  failDetail: string,
): RenderCheck {
  return { id, label, ok, blocking, detail: ok ? okDetail : failDetail };
}

/** 选出本次导出的场景：优先 activeSceneId，为空时取第一个，不猜测用户意图。 */
export function pickExportScene(stage: StageData): StageScene | null {
  if (stage.scenes.length === 0) return null;
  return (
    stage.scenes.find((scene) => scene.id === stage.activeSceneId) ?? stage.scenes[0] ?? null
  );
}

export function validateRenderInput(
  projectId: string,
  deps: RenderValidationDeps,
): RenderValidation {
  assertProjectId(projectId);
  const dir = resolveProjectDir(deps.projectsDir, projectId);
  if (!existsSync(path.join(dir, 'project.json'))) {
    throw errors.notFound('项目不存在或已被删除。');
  }

  const checks: RenderCheck[] = [];
  const warnings: string[] = [];
  const exportFps = deps.exportFps ?? PROJECT_DEFAULTS.fps;

  // 1. 项目数据
  let stage: StageData | null = null;
  let projectOk = false;
  let projectDetail = '';
  try {
    projectSchema.parse(readJson(dir, 'project.json'));
    stage = stageDataSchema.parse(readJson(dir, 'animation', 'animation.json'));
    if (stage.scenes.length === 0) {
      projectDetail = '动画数据里没有任何场景，请先导入剧本草稿。';
    } else {
      projectOk = true;
      projectDetail = `项目数据与动画数据可读取，共 ${stage.scenes.length} 个场景。`;
    }
  } catch (cause) {
    projectDetail = `项目或动画数据无法读取：${cause instanceof Error ? cause.message : '文件损坏'}`;
  }
  checks.push(check('project', '项目数据', true, projectOk, projectDetail, projectDetail));

  const scene = stage ? pickExportScene(stage) : null;
  if (stage && stage.scenes.length > 1) {
    warnings.push('第一版仅导出当前场景，多场景自动拼接尚未实现。');
  }

  // 2. 场景和人物素材
  let assetOk = false;
  let assetDetail = '没有可导出的场景。';
  if (scene) {
    const missing: string[] = [];
    const verifyAsset = (assetId: string): void => {
      if (!deps.assets.has(assetId)) {
        missing.push(assetId);
        return;
      }
      try {
        deps.assets.readFile(assetId);
      } catch {
        missing.push(assetId);
      }
    };
    if (scene.backgroundAssetId) verifyAsset(scene.backgroundAssetId);
    for (const object of scene.objects) verifyAsset(object.assetId);
    for (const character of scene.characters) {
      if (!deps.assets.hasCharacter(character.assetId)) {
        missing.push(character.assetId);
        continue;
      }
      try {
        const descriptor = deps.assets.getCharacter(character.assetId).descriptor;
        for (const posture of Object.values(descriptor.postures)) {
          for (const layer of posture.layers) {
            // readLayer 接收的是不含扩展名的相对路径（内部自行补 .svg）。
            deps.assets.readLayer(character.assetId, layer.file.replace(/\.svg$/i, ''));
          }
        }
      } catch {
        missing.push(character.assetId);
      }
    }
    assetOk = missing.length === 0;
    assetDetail = assetOk
      ? `背景、${scene.objects.length} 个道具、${scene.characters.length} 个人物素材齐全。`
      : `以下素材缺失或无法读取：${[...new Set(missing)].join('、')}`;
  }
  checks.push(check('assets', '场景与人物素材', true, assetOk, assetDetail, assetDetail));

  // 3. 对白
  const dialogues = scene?.dialogueEvents ?? [];
  const characterIds = new Set((scene?.characters ?? []).map((item) => item.id));
  const orphan = dialogues.filter((item) => !characterIds.has(item.characterId));
  const dialogueOk = dialogues.length > 0 && orphan.length === 0;
  const dialogueDetail = !scene
    ? '没有场景，无法检查对白。'
    : dialogues.length === 0
      ? '当前场景没有对白，请先导入剧本草稿。'
      : orphan.length > 0
        ? `${orphan.length} 条对白引用了不存在的人物。`
        : `当前场景共 ${dialogues.length} 条对白。`;
  checks.push(check('dialogues', '对白', true, dialogueOk, dialogueDetail, dialogueDetail));

  // 4. 音频（提示级，不阻断）
  let audioFile: z.infer<typeof audioAssetFileSchema> | null = null;
  try {
    audioFile = audioAssetFileSchema.parse(readJson(dir, 'audio', 'assets.json'));
  } catch {
    audioFile = null;
  }
  const readyAssets = new Map(
    (audioFile?.assets ?? [])
      .filter((asset) => asset.status === 'ready')
      .map((asset) => [asset.id, asset]),
  );
  const missingAudio: string[] = [];
  for (const dialogue of dialogues) {
    if (!dialogue.audioAssetId) {
      missingAudio.push(dialogue.text.slice(0, 12));
      continue;
    }
    const asset = readyAssets.get(dialogue.audioAssetId);
    if (!asset || !existsSync(path.join(dir, asset.filePath))) {
      missingAudio.push(dialogue.text.slice(0, 12));
    }
  }
  const audioApplicable = dialogues.length > 0;
  // 没有对白时音频检查不适用：不标红、不写「0 条对白均已生成配音」这类不通的文案。
  const audioOk = !audioApplicable || missingAudio.length === 0;
  const audioDetail = !audioApplicable
    ? '当前场景没有对白，无需生成配音。'
    : audioOk
      ? `${dialogues.length} 条对白均已生成配音，导出将包含音轨。`
      : `${missingAudio.length} 条对白没有可用音频，导出视频将无声音。`;
  if (audioApplicable && !audioOk) warnings.push(audioDetail);
  checks.push(check('audio', '配音音频', false, audioOk, audioDetail, audioDetail));

  // 5. 时间轴
  const invalidTiming = dialogues.filter(
    (item) =>
      !Number.isFinite(item.startFrame) ||
      !Number.isFinite(item.durationFrames) ||
      item.startFrame < 0 ||
      item.durationFrames <= 0,
  );
  const projectDurationFrames = scene ? sceneDurationFrames(scene) : 0;
  const timelineOk =
    Boolean(scene) && invalidTiming.length === 0 && projectDurationFrames > 0;
  const timelineDetail = !scene
    ? '没有场景，无法计算时间轴。'
    : invalidTiming.length > 0
      ? `${invalidTiming.length} 条对白的起始帧或时长不合法。`
      : `场景时长 ${projectDurationFrames} 帧（${(projectDurationFrames / PROJECT_DEFAULTS.fps).toFixed(2)} 秒）。`;
  checks.push(check('timeline', '时间轴', true, timelineOk, timelineDetail, timelineDetail));

  const totalFrames = timelineOk ? resampleFrames(projectDurationFrames, exportFps) : 0;
  const canRender = checks.filter((item) => item.blocking).every((item) => item.ok);

  return {
    projectId,
    sceneId: scene?.id ?? null,
    checks,
    canRender,
    totalFrames,
    projectDurationFrames,
    warnings,
  };
}
