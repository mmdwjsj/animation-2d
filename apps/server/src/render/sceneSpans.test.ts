import { sceneDurationFrames } from '@animation/animation-core';
import type { StageData, StageScene } from '@animation/shared';
import { describe, expect, it } from 'vitest';
import {
  buildSceneSpans,
  globalStartMs,
  locateFrame,
  pickExportScenes,
  totalProjectFrames,
} from './sceneSpans';

function makeScene(id: string, name: string, timings: Array<[number, number]>): StageScene {
  return {
    id,
    name,
    backgroundAssetId: null,
    objects: [],
    characters: [],
    dialogueEvents: timings.map(([startFrame, durationFrames], index) => ({
      id: `${id}-dlg-${index}`,
      characterId: 'char-1',
      text: `台词 ${index}`,
      posture: 'standing',
      startFrame,
      durationFrames,
    })),
  } as unknown as StageScene;
}

function makeStage(scenes: StageScene[], activeSceneId: string | null = null): StageData {
  return { projectId: '00000000-0000-4000-8000-000000000000', scenes, activeSceneId } as StageData;
}

describe('多场景拼接 · 场景时间轴纯函数', () => {
  it('空场景列表得到空时间轴', () => {
    expect(buildSceneSpans([])).toEqual([]);
    expect(totalProjectFrames([])).toBe(0);
    expect(locateFrame([], 0)).toBeNull();
  });

  it('场景按数组顺序无缝拼接，startFrame 等于上一场景 endFrame', () => {
    const first = makeScene('s1', '客厅', [[0, 30], [40, 30]]);
    const second = makeScene('s2', '厨房', [[0, 20]]);
    const spans = buildSceneSpans([first, second]);
    const d1 = sceneDurationFrames(first);
    const d2 = sceneDurationFrames(second);

    expect(spans.map((span) => span.sceneName)).toEqual(['客厅', '厨房']);
    expect(spans[0].startFrame).toBe(0);
    expect(spans[0].durationFrames).toBe(d1);
    expect(spans[0].endFrame).toBe(d1);
    expect(spans[1].startFrame).toBe(d1);
    expect(spans[1].endFrame).toBe(d1 + d2);
    expect(totalProjectFrames(spans)).toBe(d1 + d2);
  });

  it('locateFrame 精确定位场景切换点，越界钳到最后一帧', () => {
    const first = makeScene('s1', '客厅', [[0, 30]]);
    const second = makeScene('s2', '厨房', [[0, 20]]);
    const spans = buildSceneSpans([first, second]);
    const d1 = spans[0].durationFrames;
    const total = totalProjectFrames(spans);

    expect(locateFrame(spans, 0)).toMatchObject({ spanIndex: 0, localFrame: 0 });
    expect(locateFrame(spans, d1 - 1)).toMatchObject({ spanIndex: 0, localFrame: d1 - 1 });
    expect(locateFrame(spans, d1)).toMatchObject({ spanIndex: 1, localFrame: 0 });
    expect(locateFrame(spans, total - 1)).toMatchObject({
      spanIndex: 1,
      localFrame: spans[1].durationFrames - 1,
    });
    expect(locateFrame(spans, total + 999)).toMatchObject({
      spanIndex: 1,
      localFrame: spans[1].durationFrames - 1,
    });
    expect(locateFrame(spans, -5)).toMatchObject({ spanIndex: 0, localFrame: 0 });
  });

  it('pickExportScenes：all 取全部，active 取当前场景，无效 id 回退首个', () => {
    const first = makeScene('s1', '客厅', [[0, 30]]);
    const second = makeScene('s2', '厨房', [[0, 20]]);

    expect(pickExportScenes(makeStage([first, second]), 'all').map((s) => s.id)).toEqual([
      's1',
      's2',
    ]);
    expect(
      pickExportScenes(makeStage([first, second], 's2'), 'active').map((s) => s.id),
    ).toEqual(['s2']);
    expect(
      pickExportScenes(makeStage([first, second], 'missing'), 'active').map((s) => s.id),
    ).toEqual(['s1']);
    expect(pickExportScenes(makeStage([]), 'all')).toEqual([]);
  });

  it('globalStartMs 把场景内起始帧换算成全局音频延迟', () => {
    const span = buildSceneSpans([
      makeScene('s1', '客厅', [[0, 300]]),
      makeScene('s2', '厨房', [[0, 20]]),
    ])[1];
    expect(globalStartMs(span, 0, 30)).toBeCloseTo((span.startFrame / 30) * 1000, 6);
    expect(globalStartMs(span, 30, 30)).toBeCloseTo(((span.startFrame + 30) / 30) * 1000, 6);
  });
});
