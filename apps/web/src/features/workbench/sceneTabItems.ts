import { sceneDurationFrames } from '@animation/animation-core';
import { normalizeSceneTransition, type Asset, type StageScene } from '@animation/shared';

/**
 * 工作台场景切换栏的只读摘要（纯函数，无 IO、无时钟、无随机数）。
 *
 * 场景跨度规则与服务端 render/sceneSpans.ts 的 buildSceneSpans 完全一致：
 * 按 stage.scenes 原始顺序无缝拼接，时长由 animation-core 的 sceneDurationFrames
 * 计算，不插入转场或空白帧。Tab 上显示的全局起止帧因此与最终 MP4 一致。
 */
export interface SceneTabItem {
  sceneId: string;
  name: string;
  /** 0 基序号，展示时 +1。 */
  index: number;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  dialogueCount: number;
  backgroundAssetId: string | null;
  /** 背景素材已引用，但索引中不存在或素材类型不是场景。 */
  backgroundMissing: boolean;
  /** 进入本场景的转场帧数；0 表示无转场。第 1 个场景的转场不会生效。 */
  transitionDurationFrames: number;
}

export function buildSceneTabItems(
  scenes: readonly StageScene[],
  assets: readonly Asset[],
): SceneTabItem[] {
  let cursor = 0;
  return scenes.map((scene, index) => {
    const durationFrames = sceneDurationFrames(scene);
    const backgroundAssetId = scene.backgroundAssetId ?? null;
    const backgroundMissing =
      backgroundAssetId !== null &&
      !assets.some((asset) => asset.id === backgroundAssetId && asset.kind === 'scene');
    const item: SceneTabItem = {
      sceneId: scene.id,
      name: scene.name,
      index,
      startFrame: cursor,
      durationFrames,
      endFrame: cursor + durationFrames,
      dialogueCount: scene.dialogueEvents.length,
      backgroundAssetId,
      backgroundMissing,
      transitionDurationFrames: normalizeSceneTransition(scene.transition)?.durationFrames ?? 0,
    };
    cursor = item.endFrame;
    return item;
  });
}

/** 全部场景拼接后的总帧数，与导出时长一致。 */
export function totalTabFrames(items: readonly SceneTabItem[]): number {
  return items.reduce((total, item) => total + item.durationFrames, 0);
}
