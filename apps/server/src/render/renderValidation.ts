import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  audioAssetFileSchema,
  PROJECT_DEFAULTS,
  projectSchema,
  resampleFrames,
  stageDataSchema,
  type RenderCheck,
  type RenderScope,
  type RenderValidation,
  type StageData,
  type StageScene,
} from '@animation/shared';
import { z } from 'zod';
import { errors } from '../errors';
import type { AssetService } from '../services/assetService';
import { assertProjectId, resolveProjectDir } from '../utils/projectPaths';
import { buildSceneSpans, pickExportScenes, totalProjectFrames } from './sceneSpans';
import { buildTransitionPlan } from './transitions';

/**
 * PRD 14 导出步骤 1-5：检查项目数据、场景与人物素材、对白与音频、时间轴，
 * 并计算总帧数。只读，不写盘、不修改动画数据。
 *
 * 多场景拼接：按 scope 选出导出场景并串成全局时间轴，5 项检查覆盖**全部**
 * 导出场景，总帧数为各场景时长之和的重采样（不是只看当前场景）。
 *
 * 检查结果区分「阻断」与「提示」：素材缺失、动画数据损坏、时间轴非法会阻断；
 * 缺少配音只提示（允许导出无声视频，符合 PRD 12.3）。
 */
export interface RenderValidationDeps {
  projectsDir: string;
  assets: AssetService;
  exportFps?: number;
  scope?: RenderScope;
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
  const scope: RenderScope = deps.scope ?? 'all';

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
    }
  } catch (cause) {
    projectDetail = `项目或动画数据无法读取：${cause instanceof Error ? cause.message : '文件损坏'}`;
  }

  const scenes: StageScene[] = stage ? pickExportScenes(stage, scope) : [];
  const spans = buildSceneSpans(scenes);
  const transitionPlans = buildTransitionPlan(scenes, spans);
  const projectDurationFrames = totalProjectFrames(spans);
  if (projectOk) {
    projectDetail = `项目数据与动画数据可读取，共 ${stage?.scenes.length ?? 0} 个场景，本次导出 ${scenes.length} 个。`;
  }
  checks.push(check('project', '项目数据', true, projectOk, projectDetail, projectDetail));

  if (scope === 'active' && (stage?.scenes.length ?? 0) > 1) {
    warnings.push(
      `已选择仅导出当前场景，其余 ${(stage?.scenes.length ?? 0) - scenes.length} 个场景不会出现在视频中。`,
    );
  }

  // 2. 场景和人物素材：覆盖所有导出场景
  let assetOk = false;
  let assetDetail = '没有可导出的场景。';
  if (scenes.length > 0) {
    const missing: string[] = [];
    let objectCount = 0;
    let characterCount = 0;
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
    for (const scene of scenes) {
      if (scene.backgroundAssetId) verifyAsset(scene.backgroundAssetId);
      for (const object of scene.objects) {
        objectCount += 1;
        verifyAsset(object.assetId);
      }
      for (const character of scene.characters) {
        characterCount += 1;
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
    }
    assetOk = missing.length === 0;
    assetDetail = assetOk
      ? `${scenes.length} 个场景的背景、${objectCount} 个道具、${characterCount} 个人物素材齐全。`
      : `以下素材缺失或无法读取：${[...new Set(missing)].join('、')}`;
  }
  checks.push(check('assets', '场景与人物素材', true, assetOk, assetDetail, assetDetail));

  // 3. 对白：全部导出场景合计，且逐场景核对人物引用
  const dialogues = scenes.flatMap((scene) => scene.dialogueEvents);
  const orphanCount = scenes.reduce((total, scene) => {
    const ids = new Set(scene.characters.map((item) => item.id));
    return total + scene.dialogueEvents.filter((item) => !ids.has(item.characterId)).length;
  }, 0);
  const dialogueOk = dialogues.length > 0 && orphanCount === 0;
  const dialogueDetail =
    scenes.length === 0
      ? '没有场景，无法检查对白。'
      : dialogues.length === 0
        ? '导出范围内没有任何对白，请先导入剧本草稿。'
        : orphanCount > 0
          ? `${orphanCount} 条对白引用了不存在的人物。`
          : `${scenes.length} 个场景共 ${dialogues.length} 条对白。`;
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
  const missingByScene = new Map<string, number>();
  const addMissing = (sceneName: string): void => {
    missingByScene.set(sceneName, (missingByScene.get(sceneName) ?? 0) + 1);
  };
  for (const scene of scenes) {
    for (const dialogue of scene.dialogueEvents) {
      if (!dialogue.audioAssetId) {
        addMissing(scene.name);
        continue;
      }
      const asset = readyAssets.get(dialogue.audioAssetId);
      if (!asset || !existsSync(path.join(dir, asset.filePath))) {
        addMissing(scene.name);
      }
    }
  }
  const missingCount = [...missingByScene.values()].reduce((total, count) => total + count, 0);
  const audioApplicable = dialogues.length > 0;
  const audioOk = !audioApplicable || missingCount === 0;
  const missingDetail = [...missingByScene.entries()]
    .map(([name, count]) => `${name} ${count} 句`)
    .join('、');
  const audioDetail = !audioApplicable
    ? '导出范围内没有对白，无需生成配音。'
    : audioOk
      ? `${dialogues.length} 条对白均已生成配音，导出将包含音轨。`
      : `${missingCount} 条对白没有可用音频（${missingDetail}），导出视频对应片段将无声音。`;
  if (audioApplicable && !audioOk) warnings.push(audioDetail);
  checks.push(check('audio', '配音音频', false, audioOk, audioDetail, audioDetail));

  if (transitionPlans.length > 0) {
    warnings.push(
      `已启用 ${transitionPlans.length} 处场景转场（交叉淡化）；转场不增加视频时长，音频按原全局时间轴播放，不做淡化。`,
    );
  }

  // 5. 时间轴：所有导出场景的对白与总时长
  const invalidTiming = dialogues.filter(
    (item) =>
      !Number.isFinite(item.startFrame) ||
      !Number.isFinite(item.durationFrames) ||
      item.startFrame < 0 ||
      item.durationFrames <= 0,
  );
  const timelineOk = scenes.length > 0 && invalidTiming.length === 0 && projectDurationFrames > 0;
  const timelineDetail =
    scenes.length === 0
      ? '没有场景，无法计算时间轴。'
      : invalidTiming.length > 0
        ? `${invalidTiming.length} 条对白的起始帧或时长不合法。`
        : `${scenes.length} 个场景顺序拼接共 ${projectDurationFrames} 帧（${(projectDurationFrames / PROJECT_DEFAULTS.fps).toFixed(2)} 秒）。`;
  checks.push(check('timeline', '时间轴', true, timelineOk, timelineDetail, timelineDetail));

  const totalFrames = timelineOk ? resampleFrames(projectDurationFrames, exportFps) : 0;
  const canRender = checks.filter((item) => item.blocking).every((item) => item.ok);

  return {
    projectId,
    sceneId: spans[0]?.sceneId ?? null,
    scope,
    sceneCount: scenes.length,
    sceneSpans: spans,
    sceneTransitions: transitionPlans.map((plan) => ({
      fromSceneName: plan.fromSceneName,
      toSceneName: plan.toSceneName,
      durationFrames: plan.durationFrames,
      exportFrames: Math.max(1, resampleFrames(plan.durationFrames, exportFps)),
    })),
    checks,
    canRender,
    totalFrames,
    projectDurationFrames,
    warnings,
  };
}
