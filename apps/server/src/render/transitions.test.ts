import type { StageScene } from '@animation/shared';
import { describe, expect, it } from 'vitest';
import { buildSceneSpans } from './sceneSpans';
import { buildTransitionPlan, transitionOpacity } from './transitions';

function makeScene(id: string, name: string, duration: number, transition?: unknown): StageScene {
  return {
    id,
    name,
    backgroundAssetId: null,
    objects: [],
    characters: [],
    dialogueEvents: [
      {
        id: `${id}-dlg`,
        characterId: 'char-1',
        text: `台词 ${name}`,
        posture: 'standing',
        startFrame: 0,
        durationFrames: duration,
      },
    ],
    ...(transition === undefined ? {} : { transition }),
  } as unknown as StageScene;
}

describe('场景间转场 · 时间轴纯函数', () => {
  it('未配置 / 配置非法 / 第一个导出场景配置转场都不生效', () => {
    const scenes = [
      makeScene('s1', '客厅', 100, { type: 'fade', durationFrames: 9 }),
      makeScene('s2', '厨房', 100),
      makeScene('s3', '阳台', 100, { type: 'unknown', durationFrames: 9 }),
    ];
    expect(buildTransitionPlan(scenes, buildSceneSpans(scenes))).toEqual([]);
  });

  it('目标场景的进入转场按边界生成计划，帧数夹到不超过目标场景时长 - 1', () => {
    const scenes = [
      makeScene('s1', '客厅', 100),
      makeScene('s2', '厨房', 100, { type: 'fade', durationFrames: 9 }),
      makeScene('s3', '阳台', 1, { type: 'fade', durationFrames: 15 }),
    ];
    const spans = buildSceneSpans(scenes);
    const plans = buildTransitionPlan(scenes, spans);

    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      targetIndex: 1,
      fromSceneName: '客厅',
      toSceneName: '厨房',
      durationFrames: 9,
    });
    // 极短场景（sceneDurationFrames 有下限）也不能让转场吃掉整个场景。
    const limit = Math.min(spans[2].durationFrames - 1, spans[1].durationFrames);
    expect(plans[1].durationFrames).toBe(Math.min(15, limit));
    expect(plans[1].durationFrames).toBeGreaterThan(0);
  });

  it('转场帧数不会超过上一场景可定格的时长', () => {
    const scenes = [
      makeScene('s1', '客厅', 1),
      makeScene('s2', '厨房', 100, { type: 'fade', durationFrames: 60 }),
    ];
    const spans = buildSceneSpans(scenes);
    const plans = buildTransitionPlan(scenes, spans);

    expect(plans).toHaveLength(1);
    expect(plans[0].durationFrames).toBeLessThanOrEqual(spans[0].durationFrames);
    expect(plans[0].durationFrames).toBeLessThanOrEqual(spans[1].durationFrames - 1);
  });

  it('opacity 从 1/N 线性递增到 1，转场区间外返回 null', () => {
    const scenes = [
      makeScene('s1', '客厅', 100),
      makeScene('s2', '厨房', 100, { type: 'fade', durationFrames: 4 }),
    ];
    const plans = buildTransitionPlan(scenes, buildSceneSpans(scenes));

    expect(transitionOpacity(plans, 1, -1)).toBeNull();
    expect(transitionOpacity(plans, 0, 0)).toBeNull();
    expect(transitionOpacity(plans, 1, 0)).toBeCloseTo(0.25, 6);
    expect(transitionOpacity(plans, 1, 1)).toBeCloseTo(0.5, 6);
    expect(transitionOpacity(plans, 1, 3)).toBe(1);
    expect(transitionOpacity(plans, 1, 4)).toBeNull();
  });

  it('scope=active 只导出单场景时没有任何转场', () => {
    const scenes = [
      makeScene('s1', '客厅', 100),
      makeScene('s2', '厨房', 100, { type: 'fade', durationFrames: 9 }),
    ];
    expect(buildTransitionPlan(scenes.slice(1, 2), buildSceneSpans(scenes.slice(1, 2)))).toEqual([]);
  });
});
