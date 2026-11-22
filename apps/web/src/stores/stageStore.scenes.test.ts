import { stageDataSchema, type Asset, type StageData } from '@animation/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectActiveScene, useStageStore } from './stageStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function makeStage(): StageData {
  return stageDataSchema.parse({
    projectId: PROJECT_ID,
    version: 3,
    activeSceneId: 'scene-1',
    scenes: [
      {
        id: 'scene-1',
        name: '客厅',
        backgroundAssetId: 'bg-living',
        objects: [
          {
            id: 'obj-1', assetId: 'prop-sofa', name: '沙发', x: 100, y: 200,
            width: 400, height: 200, zIndex: 0,
          },
        ],
        characters: [
          {
            id: 'char-1', assetId: 'char-wang', name: '老王', x: 300, y: 1600,
            width: 300, posture: 'standing', zIndex: 1,
          },
        ],
        dialogueEvents: [
          {
            id: 'dlg-1',
            characterId: 'char-1',
            text: '你回来了？',
            posture: 'standing',
            startFrame: 0,
            durationFrames: 60,
          },
        ],
      },
      {
        id: 'scene-2',
        name: '厨房',
        backgroundAssetId: null,
        objects: [],
        characters: [],
        dialogueEvents: [],
      },
    ],
  });
}

const assets: Asset[] = [
  {
    id: 'bg-living', kind: 'scene', name: '客厅', file: 'scenes/living.svg',
    width: 1080, height: 1920, category: '室内', anchorX: 0, anchorY: 0,
  },
  {
    id: 'bg-kitchen', kind: 'scene', name: '厨房', file: 'scenes/kitchen.svg',
    width: 1080, height: 1920, category: '室内', anchorX: 0, anchorY: 0,
  },
  {
    id: 'prop-sofa', kind: 'prop', name: '沙发', file: 'props/sofa.svg',
    width: 400, height: 200, category: '家具', anchorX: 0.5, anchorY: 1,
  },
];

beforeEach(() => {
  useStageStore.setState({
    stage: makeStage(),
    assets,
    characters: [],
    historyPast: [],
    historyFuture: [],
    historyBatch: null,
    selectedId: null,
    saveStatus: 'saved',
    saveError: null,
    limitNotice: null,
  });
});

const state = () => useStageStore.getState();
const sceneIds = () => state().stage!.scenes.map((scene) => scene.id);

describe('新建场景', () => {
  it('追加空场景、切换 activeSceneId 并纳入撤销历史', () => {
    const id = state().addScene();
    expect(id).toBeTruthy();
    expect(state().stage!.scenes).toHaveLength(3);
    expect(sceneIds()[2]).toBe(id);
    expect(state().stage!.activeSceneId).toBe(id);
    expect(selectActiveScene(state())?.id).toBe(id);
    expect(state().stage!.scenes[2]).toMatchObject({
      name: '场景 1',
      backgroundAssetId: null,
      objects: [],
      characters: [],
      dialogueEvents: [],
    });
    expect(state().saveStatus).toBe('dirty');
    expect(state().historyPast[0].label).toContain('新建场景');
  });

  it('名称跳过已有「场景 N」，且可撤销 / 重做', () => {
    state().updateScene('scene-1', { name: '场景 1' });
    state().addScene();
    expect(state().stage!.scenes[2].name).toBe('场景 2');

    state().undo();
    expect(state().stage!.scenes).toHaveLength(2);
    expect(state().stage!.activeSceneId).toBe('scene-1');
    state().redo();
    expect(state().stage!.scenes).toHaveLength(3);
  });

  it('舞台未加载时返回 null，不产生任何状态变化', () => {
    useStageStore.setState({ stage: null });
    const before = state().stage;
    expect(state().addScene()).toBeNull();
    expect(state().stage).toBe(before);
  });
});

describe('编辑场景（名称 / 背景 / 顺序）', () => {
  it('重命名写入 trim 后的名称，整份舞台仍通过落盘 Schema', () => {
    state().updateScene('scene-2', { name: '  餐厅  ' });
    expect(state().stage!.scenes[1].name).toBe('餐厅');
    expect(stageDataSchema.safeParse(state().stage).success).toBe(true);
    expect(state().historyPast).toHaveLength(1);
    expect(state().historyPast[0].label).toContain('餐厅');
  });

  it('非法名称、不存在的背景、引用非场景素材都会拒绝整次编辑', () => {
    const before = state().stage;
    state().updateScene('scene-2', { name: '   ', backgroundAssetId: 'bg-kitchen' });
    expect(state().stage).toBe(before);
    state().updateScene('scene-2', { name: '长'.repeat(81) });
    expect(state().stage).toBe(before);
    state().updateScene('scene-2', { backgroundAssetId: 'bg-not-exist' });
    expect(state().stage).toBe(before);
    state().updateScene('scene-2', { backgroundAssetId: 'prop-sofa' });
    expect(state().stage).toBe(before);
    expect(state().historyPast).toHaveLength(0);
  });

  it('名称 + 背景 + 顺序一次提交只产生一步历史，且顺序即时生效', () => {
    state().updateScene('scene-2', {
      name: '餐厅',
      backgroundAssetId: 'bg-kitchen',
      index: 0,
    });
    expect(sceneIds()).toEqual(['scene-2', 'scene-1']);
    expect(state().stage!.scenes[0]).toMatchObject({ name: '餐厅', backgroundAssetId: 'bg-kitchen' });
    expect(state().historyPast).toHaveLength(1);
    state().undo();
    expect(sceneIds()).toEqual(['scene-1', 'scene-2']);
    expect(state().stage!.scenes[1].name).toBe('厨房');
  });

  it('没有实际变化或场景不存在时不产生空历史', () => {
    state().updateScene('scene-2', { name: '厨房', backgroundAssetId: null, index: 1 });
    state().updateScene('scene-not-exist', { name: '不存在' });
    expect(state().historyPast).toHaveLength(0);
    expect(state().saveStatus).toBe('saved');
  });
});

describe('删除场景', () => {
  it('删除当前场景后 activeSceneId 指向有效场景，可撤销恢复', () => {
    state().setActiveScene('scene-2');
    const before = state().historyPast.length;
    state().deleteScene('scene-2');

    expect(sceneIds()).toEqual(['scene-1']);
    expect(state().stage!.activeSceneId).toBe('scene-1');
    expect(selectActiveScene(state())?.id).toBe('scene-1');
    expect(state().historyPast).toHaveLength(before + 1);
    expect(state().historyPast[before].label).toContain('删除场景');

    state().undo();
    expect(sceneIds()).toEqual(['scene-1', 'scene-2']);
    expect(state().stage!.activeSceneId).toBe('scene-2');
  });

  it('删除非当前场景时 activeSceneId 不变，选中对象被清空', () => {
    useStageStore.setState({ selectedId: 'dlg-1' });
    state().deleteScene('scene-2');
    expect(state().stage!.activeSceneId).toBe('scene-1');
    expect(state().selectedId).toBeNull();
  });

  it('至少保留一个场景，删到最后一个不产生变更', () => {
    state().deleteScene('scene-2');
    const before = state().stage;
    const historyBefore = state().historyPast.length;
    state().deleteScene('scene-1');
    expect(state().stage).toBe(before);
    expect(state().historyPast).toHaveLength(historyBefore);
    expect(sceneIds()).toEqual(['scene-1']);
  });
});

describe('调整场景顺序', () => {
  it('前移 / 后移按钮改变顺序并可撤销', () => {
    state().moveScene('scene-2', 'left');
    expect(sceneIds()).toEqual(['scene-2', 'scene-1']);
    expect(state().historyPast[0].label).toBe('调整场景顺序');
    state().undo();
    expect(sceneIds()).toEqual(['scene-1', 'scene-2']);
  });

  it('拖拽到指定索引按目标位置插入，边界不产生空历史', () => {
    state().moveSceneTo('scene-1', 1);
    expect(sceneIds()).toEqual(['scene-2', 'scene-1']);
    const historyBefore = state().historyPast.length;
    state().moveSceneTo('scene-1', 1);
    state().moveScene('scene-1', 'right');
    expect(state().historyPast).toHaveLength(historyBefore);
  });

  it('顺序变化后其它场景数据保持原引用，不被重建', () => {
    const firstBefore = state().stage!.scenes[0];
    state().moveScene('scene-2', 'left');
    expect(state().stage!.scenes[1]).toBe(firstBefore);
  });
});

describe('复制场景', () => {
  it('深拷贝内容并重映射对白人物引用，切换到副本且可撤销', () => {
    const id = state().duplicateScene('scene-1');
    expect(id).toBeTruthy();
    expect(sceneIds()).toEqual(['scene-1', id, 'scene-2']);
    expect(state().stage!.activeSceneId).toBe(id);
    expect(state().saveStatus).toBe('dirty');

    const copy = state().stage!.scenes[1];
    expect(copy.name).toBe('客厅 副本');
    expect(copy.backgroundAssetId).toBe('bg-living');
    expect(copy.objects).toHaveLength(1);
    expect(copy.characters).toHaveLength(1);
    expect(copy.dialogueEvents).toHaveLength(1);
    expect(copy.objects[0].id).not.toBe('obj-1');
    expect(copy.characters[0].id).not.toBe('char-1');
    expect(copy.dialogueEvents[0].characterId).toBe(copy.characters[0].id);
    expect(copy.dialogueEvents[0].text).toBe('你回来了？');
    expect(stageDataSchema.safeParse(state().stage).success).toBe(true);
    expect(state().historyPast[0].label).toContain('复制场景');

    state().undo();
    expect(sceneIds()).toEqual(['scene-1', 'scene-2']);
    expect(state().stage!.activeSceneId).toBe('scene-1');
  });

  it('复制时保留转场配置；源场景不存在时返回 null', () => {
    state().updateScene('scene-1', { transition: { type: 'fade', durationFrames: 15 } });
    const id = state().duplicateScene('scene-1');
    expect(state().stage!.scenes[1].transition).toEqual({ type: 'fade', durationFrames: 15 });
    expect(id).toBeTruthy();
    const before = state().stage;
    expect(state().duplicateScene('not-exist')).toBeNull();
    expect(state().stage).toBe(before);
  });
});

describe('进入转场配置', () => {
  it('设置 / 关闭转场均通过落盘 Schema，非法帧数整次拒绝', () => {
    state().updateScene('scene-2', { transition: { type: 'fade', durationFrames: 9 } });
    expect(state().stage!.scenes[1].transition).toEqual({ type: 'fade', durationFrames: 9 });
    expect(stageDataSchema.safeParse(state().stage).success).toBe(true);

    const before = state().stage;
    state().updateScene('scene-2', { transition: { type: 'fade', durationFrames: 999 } });
    expect(state().stage).toBe(before);

    state().updateScene('scene-2', { transition: null });
    expect(state().stage!.scenes[1].transition).toBeNull();
  });

  it('顺序 + 名称 + 转场一次提交按 id 定位正确，只产生一步历史', () => {
    state().updateScene('scene-2', {
      name: '餐厅',
      index: 0,
      transition: { type: 'fade', durationFrames: 15 },
    });
    expect(sceneIds()).toEqual(['scene-2', 'scene-1']);
    expect(state().stage!.scenes[0]).toMatchObject({
      name: '餐厅',
      transition: { type: 'fade', durationFrames: 15 },
    });
    expect(state().stage!.scenes[1].transition).toBeUndefined();
    expect(state().historyPast).toHaveLength(1);
  });
});
