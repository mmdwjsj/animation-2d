import { DEFAULT_SCENE_TAIL_FRAMES, MIN_SCENE_DURATION_FRAMES } from '@animation/animation-core';
import type { Asset, StageScene } from '@animation/shared';
import { describe, expect, it } from 'vitest';
import { buildSceneTabItems, totalTabFrames } from './sceneTabItems';

function makeScene(
  id: string,
  name: string,
  dialogueEndFrame: number | null,
  backgroundAssetId: string | null = null,
): StageScene {
  return {
    id,
    name,
    backgroundAssetId,
    objects: [],
    characters: [],
    dialogueEvents:
      dialogueEndFrame === null
        ? []
        : [
            {
              id: `dlg-${id}`,
              characterId: 'char-1',
              text: '一句台词',
              posture: 'standing',
              startFrame: 0,
              durationFrames: dialogueEndFrame,
            },
          ],
  } as StageScene;
}

const livingRoom: Asset = {
  id: 'bg-living-room',
  kind: 'scene',
  name: '客厅',
  file: 'scenes/living-room.svg',
  width: 1080,
  height: 1920,
  category: '室内',
  anchorX: 0,
  anchorY: 0,
};

describe('工作台场景 Tab 摘要', () => {
  it('按 scenes 顺序无缝拼接，帧跨度与服务端 buildSceneSpans 一致', () => {
    const scenes = [
      makeScene('scene-1', '客厅', 107, 'bg-living-room'),
      makeScene('scene-2', '厨房', 99, null),
    ];
    const items = buildSceneTabItems(scenes, [livingRoom]);

    expect(items[0]).toMatchObject({
      sceneId: 'scene-1',
      name: '客厅',
      index: 0,
      startFrame: 0,
      durationFrames: 107 + DEFAULT_SCENE_TAIL_FRAMES,
      endFrame: 107 + DEFAULT_SCENE_TAIL_FRAMES,
      dialogueCount: 1,
      backgroundMissing: false,
    });
    expect(items[1]).toMatchObject({
      sceneId: 'scene-2',
      index: 1,
      startFrame: 107 + DEFAULT_SCENE_TAIL_FRAMES,
      durationFrames: 99 + DEFAULT_SCENE_TAIL_FRAMES,
      endFrame: 107 + 99 + DEFAULT_SCENE_TAIL_FRAMES * 2,
    });
    expect(items[1].startFrame).toBe(items[0].endFrame);
    expect(totalTabFrames(items)).toBe(items[1].endFrame);
    expect(totalTabFrames(items)).toBe(266);
  });

  it('无对白的场景按最小时长计算，不产生 0 帧场景', () => {
    const items = buildSceneTabItems([makeScene('scene-empty', '空场景', null)], []);
    expect(items[0].durationFrames).toBe(MIN_SCENE_DURATION_FRAMES);
    expect(items[0].dialogueCount).toBe(0);
    expect(totalTabFrames(items)).toBe(MIN_SCENE_DURATION_FRAMES);
  });

  it('背景素材引用不存在或类型不符时标记为缺失，无背景不标记为缺失', () => {
    const items = buildSceneTabItems(
      [
        makeScene('scene-1', '有背景', 60, 'bg-living-room'),
        makeScene('scene-2', '背景丢失', 60, 'bg-not-exist'),
        makeScene('scene-3', '无背景', 60, null),
        makeScene('scene-4', '引用了道具', 60, 'prop-sofa'),
      ],
      [
        livingRoom,
        {
          id: 'prop-sofa',
          kind: 'prop',
          name: '沙发',
          file: 'props/sofa.svg',
          width: 400,
          height: 200,
          category: '家具',
          anchorX: 0.5,
          anchorY: 1,
        },
      ],
    );

    expect(items.map((item) => item.backgroundMissing)).toEqual([false, true, false, true]);
    expect(items.map((item) => item.backgroundAssetId)).toEqual([
      'bg-living-room',
      'bg-not-exist',
      null,
      'prop-sofa',
    ]);
  });

  it('空项目返回空列表，总帧数为 0', () => {
    expect(buildSceneTabItems([], [])).toEqual([]);
    expect(totalTabFrames([])).toBe(0);
  });

  it('不修改传入的场景与素材数组', () => {
    const scenes = [makeScene('scene-1', '客厅', 60)];
    const snapshot = JSON.stringify(scenes);
    buildSceneTabItems(scenes, []);
    expect(JSON.stringify(scenes)).toBe(snapshot);
    expect(scenes[0].id).toBe('scene-1');
  });

  it('读取进入转场帧数供 Tab 徽标显示，非法配置视为无转场', () => {
    const scenes = [
      { ...makeScene('scene-1', '客厅', 60), transition: { type: 'fade', durationFrames: 15 } },
      { ...makeScene('scene-2', '厨房', 60), transition: { type: 'fade', durationFrames: 999 } },
      makeScene('scene-3', '阳台', 60),
    ] as StageScene[];
    expect(buildSceneTabItems(scenes, []).map((item) => item.transitionDurationFrames)).toEqual([
      15, 0, 0,
    ]);
  });
});
