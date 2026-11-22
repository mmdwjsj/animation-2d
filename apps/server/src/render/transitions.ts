import { normalizeSceneTransition, type RenderSceneSpan, type StageScene } from '@animation/shared';

/**
 * 场景间转场的时间轴计算（纯函数，无 IO、无时钟、无随机数）。
 *
 * 语义：转场由**目标场景**的「进入转场」配置决定，只作用于导出范围内相邻
 * 两个场景的边界；在目标场景开头的前 N 个**项目逻辑帧**内做交叉淡化，
 * 不插入额外帧、不改写 sceneSpans，因此音频全局偏移与导出总帧数保持不变。
 */

export interface SceneTransitionPlan {
  /** 目标场景在本次导出 scenes 中的索引（恒 >= 1）。 */
  targetIndex: number;
  fromSceneName: string;
  toSceneName: string;
  /** 夹到合法范围后的项目逻辑帧数（>= 1）。 */
  durationFrames: number;
}

/**
 * 按导出场景列表生成生效的转场计划：
 * - 第 1 个导出场景没有「上一个场景」，不应用转场（scope=active 同理）；
 * - 转场帧数不能超过目标场景时长 - 1，也不能超过上一场景时长，
 *   避免短场景被整个转场吃掉或上一场景无画面可定格。
 */
export function buildTransitionPlan(
  scenes: readonly StageScene[],
  spans: readonly RenderSceneSpan[],
): SceneTransitionPlan[] {
  const plans: SceneTransitionPlan[] = [];
  for (let index = 1; index < scenes.length; index += 1) {
    const transition = normalizeSceneTransition(scenes[index].transition);
    const span = spans[index];
    const previous = spans[index - 1];
    if (!transition || !span || !previous || span.durationFrames <= 1) continue;
    const durationFrames = Math.min(
      transition.durationFrames,
      span.durationFrames - 1,
      previous.durationFrames,
    );
    if (durationFrames < 1) continue;
    plans.push({
      targetIndex: index,
      fromSceneName: previous.sceneName,
      toSceneName: span.sceneName,
      durationFrames,
    });
  }
  return plans;
}

/**
 * 求当前帧「本场景画面」的不透明度；返回 null 表示该帧不需要转场叠加。
 * 线性从 1/N 递增到 1：最后一帧完全切到新场景，下一帧起不再叠加。
 */
export function transitionOpacity(
  plans: readonly SceneTransitionPlan[],
  spanIndex: number,
  localFrame: number,
): number | null {
  const plan = plans.find((item) => item.targetIndex === spanIndex);
  if (!plan || localFrame < 0 || localFrame >= plan.durationFrames) return null;
  return Math.min(1, (localFrame + 1) / plan.durationFrames);
}
