import { sceneDurationFrames } from '@animation/animation-core';
import type {
  RenderSceneSpan,
  RenderScope,
  StageData,
  StageScene,
} from '@animation/shared';

/**
 * 多场景自动拼接的时间轴计算（纯函数，无 IO、无时钟、无随机数）。
 *
 * 场景按 stage.scenes 的原始顺序无缝衔接：下一个场景的 startFrame 等于
 * 上一个场景的 endFrame；不插入转场、不插入空白帧（PRD 未定义转场，不猜测）。
 * 时间单位统一为「项目逻辑帧」（30 FPS 基准），与 getStateAtFrame 一致。
 */

/** 按导出范围挑选本次参与的场景，顺序保持稳定。 */
export function pickExportScenes(stage: StageData, scope: RenderScope): StageScene[] {
  if (stage.scenes.length === 0) return [];
  if (scope === 'all') return [...stage.scenes];
  const active =
    stage.scenes.find((scene) => scene.id === stage.activeSceneId) ?? stage.scenes[0];
  return active ? [active] : [];
}

/** 把场景串成全局时间轴。 */
export function buildSceneSpans(scenes: readonly StageScene[]): RenderSceneSpan[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const durationFrames = sceneDurationFrames(scene);
    const span: RenderSceneSpan = {
      sceneId: scene.id,
      sceneName: scene.name,
      startFrame: cursor,
      durationFrames,
      endFrame: cursor + durationFrames,
    };
    cursor = span.endFrame;
    return span;
  });
}

/** 所有场景时长之和（项目逻辑帧）。 */
export function totalProjectFrames(spans: readonly RenderSceneSpan[]): number {
  return spans.reduce((total, span) => total + span.durationFrames, 0);
}

export interface FrameLocation {
  span: RenderSceneSpan;
  spanIndex: number;
  /** 该场景内的局部帧，直接传给 getStateAtFrame。 */
  localFrame: number;
}

/**
 * 定位全局帧所属场景。越界帧钳到最后一帧，保证任意导出帧都有确定状态，
 * 与 composition 的帧数组钳制规则一致。空时间轴返回 null。
 */
export function locateFrame(
  spans: readonly RenderSceneSpan[],
  frame: number,
): FrameLocation | null {
  if (spans.length === 0) return null;
  const total = totalProjectFrames(spans);
  const clamped = Math.max(0, Math.min(Math.floor(frame), total - 1));
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (clamped < span.endFrame) {
      return { span, spanIndex: index, localFrame: clamped - span.startFrame };
    }
  }
  const lastIndex = spans.length - 1;
  const last = spans[lastIndex];
  return { span: last, spanIndex: lastIndex, localFrame: last.durationFrames - 1 };
}

/** 场景内对白起始帧 → 全局音频延迟毫秒。 */
export function globalStartMs(span: RenderSceneSpan, dialogueStartFrame: number, fps: number): number {
  return ((span.startFrame + dialogueStartFrame) / fps) * 1000;
}
