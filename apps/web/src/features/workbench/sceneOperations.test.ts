import type { StageScene } from '@animation/shared';
import { describe, expect, it } from 'vitest';
import {
  SCENE_NAME_MAX_LENGTH,
  createScene,
  duplicateScene,
  nextSceneName,
  normalizeSceneName,
  removeScene,
  renameScene,
  reorderSceneTo,
  shiftScene,
} from './sceneOperations';

function makeScene(id: string, name: string): StageScene {
  return {
    id,
    name,
    backgroundAssetId: null,
    objects: [],
    characters: [],
    dialogueEvents: [],
  };
}

const threeScenes = (): StageScene[] => [
  makeScene('scene-1', '客厅'),
  makeScene('scene-2', '厨房'),
  makeScene('scene-3', '阳台'),
];

describe('场景名称', () => {
  it('生成未占用的最小「场景 N」，删除中间场景后新建不重名', () => {
    expect(nextSceneName([])).toBe('场景 1');
    expect(nextSceneName([makeScene('a', '场景 1'), makeScene('b', '场景 3')])).toBe('场景 2');
    expect(nextSceneName(threeScenes())).toBe('场景 1');
  });

  it('名称 trim 后校验，空串与超长都拒绝', () => {
    expect(normalizeSceneName('  卧室  ')).toBe('卧室');
    expect(normalizeSceneName('   ')).toBeNull();
    expect(normalizeSceneName('')).toBeNull();
    expect(normalizeSceneName('长'.repeat(SCENE_NAME_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeSceneName('长'.repeat(SCENE_NAME_MAX_LENGTH))).toHaveLength(
      SCENE_NAME_MAX_LENGTH,
    );
  });
});

describe('新建与重命名场景', () => {
  it('新建场景为空结构且名称不重复，不修改原数组', () => {
    const scenes = [makeScene('a', '场景 1')];
    const snapshot = JSON.stringify(scenes);
    const scene = createScene('scene-new', scenes);

    expect(scene).toEqual({
      id: 'scene-new',
      name: '场景 2',
      backgroundAssetId: null,
      objects: [],
      characters: [],
      dialogueEvents: [],
    });
    expect(JSON.stringify(scenes)).toBe(snapshot);
  });

  it('重命名只改目标场景，trim 后写入', () => {
    const scenes = threeScenes();
    const next = renameScene(scenes, 'scene-2', '  餐厅  ');

    expect(next?.map((scene) => scene.name)).toEqual(['客厅', '餐厅', '阳台']);
    expect(next?.[0]).toBe(scenes[0]);
    expect(scenes[1].name).toBe('厨房');
  });

  it('名称无变化 / 非法 / 场景不存在时不产生变更', () => {
    const scenes = threeScenes();
    expect(renameScene(scenes, 'scene-2', '厨房')).toBeNull();
    expect(renameScene(scenes, 'scene-2', '   ')).toBeNull();
    expect(renameScene(scenes, 'scene-2', '长'.repeat(81))).toBeNull();
    expect(renameScene(scenes, 'scene-not-exist', '餐厅')).toBeNull();
  });
});

describe('删除场景', () => {
  it('删除非激活场景时 activeSceneId 保持不变', () => {
    const result = removeScene(threeScenes(), 'scene-1', 'scene-3');
    expect(result?.scenes.map((scene) => scene.id)).toEqual(['scene-1', 'scene-2']);
    expect(result?.activeSceneId).toBe('scene-1');
  });

  it('删除当前激活场景时指向前一个场景', () => {
    const result = removeScene(threeScenes(), 'scene-3', 'scene-3');
    expect(result?.activeSceneId).toBe('scene-2');
  });

  it('删除第一个且它是当前场景时指向新的第一个场景', () => {
    const result = removeScene(threeScenes(), 'scene-1', 'scene-1');
    expect(result?.activeSceneId).toBe('scene-2');
    expect(result?.scenes.map((scene) => scene.id)).toEqual(['scene-2', 'scene-3']);
  });

  it('旧数据 activeSceneId 失效时删除其他场景会顺带修正指针', () => {
    const result = removeScene(threeScenes(), null, 'scene-3');
    expect(result?.activeSceneId).toBe('scene-1');
  });

  it('至少保留一个场景；不存在的 id 不产生变更', () => {
    expect(removeScene([makeScene('only', '独苗')], 'only', 'only')).toBeNull();
    expect(removeScene(threeScenes(), 'scene-1', 'not-exist')).toBeNull();
  });

  it('不修改传入数组', () => {
    const scenes = threeScenes();
    const snapshot = JSON.stringify(scenes);
    removeScene(scenes, 'scene-1', 'scene-2');
    expect(JSON.stringify(scenes)).toBe(snapshot);
  });
});

describe('调整场景顺序', () => {
  it('拖拽到指定索引按目标位置插入，其余顺序保持', () => {
    const scenes = threeScenes();
    const next = reorderSceneTo(scenes, 'scene-1', 2);
    expect(next?.map((scene) => scene.id)).toEqual(['scene-2', 'scene-3', 'scene-1']);
    expect(scenes.map((scene) => scene.id)).toEqual(['scene-1', 'scene-2', 'scene-3']);
  });

  it('目标索引越界夹到合法范围，无变化 / 非法值 / 不存在的场景返回 null', () => {
    const scenes = threeScenes();
    expect(reorderSceneTo(scenes, 'scene-1', 99)?.[2].id).toBe('scene-1');
    expect(reorderSceneTo(scenes, 'scene-3', -5)?.[0].id).toBe('scene-3');
    expect(reorderSceneTo(scenes, 'scene-2', 1)).toBeNull();
    expect(reorderSceneTo(scenes, 'scene-2', Number.NaN)).toBeNull();
    expect(reorderSceneTo(scenes, 'not-exist', 0)).toBeNull();
  });

  it('前移 / 后移按钮在边界处不产生变更', () => {
    const scenes = threeScenes();
    expect(shiftScene(scenes, 'scene-2', 'left')?.map((s) => s.id)).toEqual([
      'scene-2',
      'scene-1',
      'scene-3',
    ]);
    expect(shiftScene(scenes, 'scene-2', 'right')?.map((s) => s.id)).toEqual([
      'scene-1',
      'scene-3',
      'scene-2',
    ]);
    expect(shiftScene(scenes, 'scene-1', 'left')).toBeNull();
    expect(shiftScene(scenes, 'scene-3', 'right')).toBeNull();
  });
});

describe('复制场景', () => {
  const richScene = (): StageScene =>
    ({
      id: 'scene-1',
      name: '客厅',
      backgroundAssetId: 'bg-living',
      transition: { type: 'fade', durationFrames: 9 },
      objects: [
        {
          id: 'obj-1', assetId: 'prop-sofa', name: '沙发', x: 100, y: 200,
          width: 400, height: 200, rotation: 0, zIndex: 0, visible: true,
        },
      ],
      characters: [
        {
          id: 'char-1', assetId: 'char-wang', name: '老王', x: 300, y: 1600,
          width: 300, posture: 'sitting', eyeState: 'open', mouthState: 'closed',
          visible: true, zIndex: 1,
        },
      ],
      dialogueEvents: [
        {
          id: 'dlg-1', characterId: 'char-1', text: '你回来了？', posture: 'sitting',
          startFrame: 0, durationFrames: 60, audioAssetId: 'audio-1', manuallyTimed: true,
        },
      ],
    }) as unknown as StageScene;

  it('深拷贝全部内容并重生成 id，插到源场景之后且切换到副本', () => {
    const scenes = [richScene(), makeScene('scene-2', '厨房')];
    const result = duplicateScene(scenes, 'scene-1', 'scene-copy');

    expect(result?.activeSceneId).toBe('scene-copy');
    expect(result?.scenes.map((scene) => scene.id)).toEqual(['scene-1', 'scene-copy', 'scene-2']);
    const copy = result?.scenes[1];
    expect(copy?.name).toBe('客厅 副本');
    expect(copy?.backgroundAssetId).toBe('bg-living');
    expect(copy?.transition).toEqual({ type: 'fade', durationFrames: 9 });
    expect(copy?.objects).toHaveLength(1);
    expect(copy?.objects[0].id).toBe('scene-copy-obj-0');
    expect(copy?.objects[0].assetId).toBe('prop-sofa');
    expect(copy?.characters[0].id).toBe('scene-copy-char-0');
    expect(copy?.dialogueEvents[0].id).toBe('scene-copy-dlg-0');
    expect(copy?.dialogueEvents[0].characterId).toBe('scene-copy-char-0');
    expect(copy?.dialogueEvents[0].audioAssetId).toBe('audio-1');
    expect(copy?.dialogueEvents[0].manuallyTimed).toBe(true);
    // 副本与原场景不共享实例 id，也不共享数组引用。
    expect(copy?.characters).not.toBe(scenes[0].characters);
    expect(new Set([scenes[0].objects[0].id, copy?.objects[0].id]).size).toBe(2);
  });

  it('副本名称冲突时追加序号，超长时回退到未占用的「场景 N」', () => {
    const scenes = [richScene(), makeScene('scene-2', '客厅 副本')];
    expect(duplicateScene(scenes, 'scene-1', 'copy')?.scenes[1].name).toBe('客厅 副本 2');

    const long = { ...richScene(), name: '长'.repeat(SCENE_NAME_MAX_LENGTH) } as StageScene;
    const longResult = duplicateScene([long], 'scene-1', 'copy');
    expect(longResult?.scenes[1].name).toBe('场景 1');
    expect(longResult?.scenes[1].name.length).toBeLessThanOrEqual(SCENE_NAME_MAX_LENGTH);
  });

  it('不修改传入数组；源场景 / 新 id 非法时不产生变更', () => {
    const scenes = [richScene()];
    const snapshot = JSON.stringify(scenes);
    const result = duplicateScene(scenes, 'scene-1', 'copy');
    expect(JSON.stringify(scenes)).toBe(snapshot);
    expect(result?.scenes[0]).toBe(scenes[0]);
    expect(duplicateScene(scenes, 'not-exist', 'copy')).toBeNull();
    expect(duplicateScene(scenes, 'scene-1', '   ')).toBeNull();
  });
});
