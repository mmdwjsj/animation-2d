import {
  MAX_HISTORY_ENTRIES,
  stageDataSchema,
  type Asset,
  type CharacterAsset,
  type StageData,
} from '@animation/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectActiveScene, useStageStore } from './stageStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function makeStage(): StageData {
  return {
    projectId: PROJECT_ID,
    version: 7,
    activeSceneId: 'scene-1',
    scenes: [
      {
        id: 'scene-1',
        name: '客厅',
        backgroundAssetId: 'scene-living-room',
        objects: [],
        characters: [
          {
            id: 'char-1', assetId: 'char-old-wang', name: '老王',
            x: 180, y: 1650, width: 300,
            posture: 'standing', eyeState: 'open', mouthState: 'closed',
            visible: true, zIndex: 0,
          },
          {
            id: 'char-2', assetId: 'char-xiao-li', name: '小李',
            x: 440, y: 1650, width: 300,
            posture: 'sitting', eyeState: 'open', mouthState: 'closed',
            visible: true, zIndex: 1,
          },
        ],
        dialogueEvents: [
          { id: 'dlg-1', characterId: 'char-1', text: '你回来了？', posture: 'sitting', startFrame: 0, durationFrames: 60 },
          { id: 'dlg-2', characterId: 'char-2', text: '我的蛋糕呢？', posture: 'standing', startFrame: 75, durationFrames: 45 },
        ],
      },
    ],
  };
}

const posture = {
  size: { width: 360, height: 600 },
  anchor: { x: 180, y: 600 },
  anchorLabel: '脚底中心',
  layers: [],
};

const characterAssets: CharacterAsset[] = [
  {
    id: 'char-old-wang',
    name: '老王',
    descriptor: {
      id: 'char-old-wang', name: '老王', version: 1,
      postures: { standing: posture, sitting: { ...posture, anchor: { x: 180, y: 580 } } },
    },
  },
  {
    id: 'char-xiao-li',
    name: '小李',
    descriptor: {
      id: 'char-xiao-li', name: '小李', version: 1,
      postures: { standing: posture, sitting: { ...posture, anchor: { x: 180, y: 580 } } },
    },
  },
];

const propAssets: Asset[] = [
  {
    id: 'prop-sofa', kind: 'prop', name: '沙发', file: 'props/sofa.svg',
    width: 400, height: 200, category: '家具', anchorX: 0.5, anchorY: 1,
  },
];

beforeEach(() => {
  useStageStore.setState({
    stage: makeStage(),
    assets: propAssets,
    characters: characterAssets,
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
const events = () => selectActiveScene(state())!.dialogueEvents;
const characters = () => selectActiveScene(state())!.characters;
const objects = () => selectActiveScene(state())!.objects;

describe('撤销 / 重做历史栈', () => {
  it('初始状态没有可撤销 / 可重做记录', () => {
    expect(state().historyPast).toHaveLength(0);
    expect(state().historyFuture).toHaveLength(0);
  });

  it('一次编辑压入一条历史并标记未保存；undo 恢复、redo 重放', () => {
    state().updateDialogue('dlg-1', { text: '改过的台词' });
    expect(events()[0].text).toBe('改过的台词');
    expect(state().historyPast).toHaveLength(1);
    expect(state().saveStatus).toBe('dirty');

    state().undo();
    expect(events()[0].text).toBe('你回来了？');
    expect(state().historyPast).toHaveLength(0);
    expect(state().historyFuture).toHaveLength(1);

    state().redo();
    expect(events()[0].text).toBe('改过的台词');
    expect(state().historyPast).toHaveLength(1);
    expect(state().historyFuture).toHaveLength(0);
    expect(state().saveStatus).toBe('dirty');
  });

  it('undo 后执行新编辑会清空重做栈', () => {
    state().updateDialogue('dlg-1', { text: 'A' });
    state().undo();
    expect(state().historyFuture).toHaveLength(1);
    state().updateDialogue('dlg-1', { text: 'B' });
    expect(state().historyFuture).toHaveLength(0);
    expect(events()[0].text).toBe('B');
    state().undo();
    expect(events()[0].text).toBe('你回来了？');
  });

  it('撤销 / 重做不回退服务端递增的 version', () => {
    state().updateDialogue('dlg-1', { text: 'A' });
    state().undo();
    state().redo();
    expect(state().stage?.version).toBe(7);
  });

  it('历史长度受 MAX_HISTORY_ENTRIES 限制', () => {
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 8; i += 1) {
      state().updateDialogue('dlg-1', { startFrame: 1000 + i });
    }
    expect(state().historyPast).toHaveLength(MAX_HISTORY_ENTRIES);
  });

  it('人物姿态切换立即生效且可撤销，逻辑锚点不跳动', () => {
    const before = characters()[0];
    state().updateCharacter('char-1', { posture: 'sitting' });
    expect(characters()[0].posture).toBe('sitting');
    expect(characters()[0].x).toBe(before.x);
    expect(characters()[0].y).toBe(before.y);
    state().undo();
    expect(characters()[0].posture).toBe('standing');
    state().redo();
    expect(characters()[0].posture).toBe('sitting');
  });

  it('添加 / 删除道具都纳入历史', () => {
    state().addObject('prop-sofa');
    expect(objects()).toHaveLength(1);
    state().undo();
    expect(objects()).toHaveLength(0);
    state().redo();
    expect(objects()).toHaveLength(1);
  });
});

describe('连续拖动批次合并', () => {
  it('beginBatch 期间多次修改只记一步历史', () => {
    state().beginBatch('拖动人物');
    state().moveCharacter('char-1', 200, 1600);
    state().moveCharacter('char-1', 240, 1580);
    state().moveCharacter('char-1', 280, 1560);
    state().endBatch();
    expect(state().historyPast).toHaveLength(1);
    expect(characters()[0].x).toBe(280);
    state().undo();
    expect(characters()[0].x).toBe(180);
    expect(characters()[0].y).toBe(1650);
  });

  it('批次内没有任何实际变化时不产生空历史', () => {
    state().beginBatch('空拖动');
    state().endBatch();
    expect(state().historyPast).toHaveLength(0);
  });

  it('endBatch 后可继续正常逐步记录', () => {
    state().beginBatch('拖动');
    state().moveCharacter('char-1', 250, 1600);
    state().endBatch();
    state().updateDialogue('dlg-1', { text: '后续编辑' });
    expect(state().historyPast).toHaveLength(2);
    state().undo();
    expect(events()[0].text).toBe('你回来了？');
    expect(characters()[0].x).toBe(250);
    state().undo();
    expect(characters()[0].x).toBe(180);
  });
});

describe('对白事件编辑', () => {
  it('非法输入被拒绝或夹到合法范围，绝不写入 Schema 不通过的数据', () => {
    state().updateDialogue('dlg-1', { text: '' });
    expect(events()[0].text).toBe('你回来了？');
    state().updateDialogue('dlg-1', { startFrame: -5 });
    expect(events()[0].startFrame).toBe(0);
    expect(state().historyPast).toHaveLength(0); // 夹到 0 后与当前值相同，不产生空历史
    state().updateDialogue('dlg-1', { durationFrames: 0 });
    expect(events()[0].durationFrames).toBe(15); // 夹到最短时长，而非写入 0
    expect(state().historyPast).toHaveLength(1);
    expect(stageDataSchema.safeParse(state().stage).success).toBe(true);
  });

  it('时长下限与整数帧归一化生效', () => {
    state().updateDialogue('dlg-1', { durationFrames: 3.9, startFrame: 12.8 });
    expect(events()[0].durationFrames).toBe(15);
    expect(events()[0].startFrame).toBe(12);
  });

  it('插入对白：时间接在锚点之后，可撤销', () => {
    state().insertDialogue('dlg-1');
    expect(events()).toHaveLength(3);
    expect(events()[1].startFrame).toBe(75);
    expect(events()[1].characterId).toBe('char-1');
    state().undo();
    expect(events()).toHaveLength(2);
  });

  it('没有人物时插入对白给出明确提示而非静默失败', () => {
    useStageStore.setState({
      stage: {
        ...makeStage(),
        scenes: [{ ...makeStage().scenes[0], characters: [], dialogueEvents: [] }],
      },
    });
    state().insertDialogue();
    expect(state().limitNotice).toContain('请先添加人物');
    expect(events()).toHaveLength(0);
  });

  it('删除对白可撤销恢复', () => {
    state().removeDialogue('dlg-1');
    expect(events()).toHaveLength(1);
    state().undo();
    expect(events()).toHaveLength(2);
    expect(events()[0].id).toBe('dlg-1');
  });

  it('调整对白顺序时同步串排时间，避免显示顺序与播放顺序矛盾', () => {
    state().moveDialogue('dlg-2', 'up');
    expect(events().map((item) => item.id)).toEqual(['dlg-2', 'dlg-1']);
    expect(events()[0].startFrame).toBe(0);
    expect(events()[1].startFrame).toBe(45 + 15);
    state().undo();
    expect(events().map((item) => item.id)).toEqual(['dlg-1', 'dlg-2']);
  });

  it('自动排布按起始帧顺序串排，重复执行不新增历史', () => {
    state().updateDialogue('dlg-2', { startFrame: 500 });
    const before = state().historyPast.length;
    state().autoLayoutDialogues();
    expect(events()[0].startFrame).toBe(0);
    expect(events()[1].startFrame).toBe(60 + 15);
    expect(state().historyPast).toHaveLength(before + 1);
    state().autoLayoutDialogues();
    expect(state().historyPast).toHaveLength(before + 1);
  });
});

describe('阶段 7：手动时间保护与服务端舞台应用', () => {
  it('用户手改起始帧或时长会标记 manuallyTimed，改文本不会', () => {
    state().updateDialogue('dlg-1', { text: '改了台词' });
    expect(events()[0].manuallyTimed).toBeUndefined();

    state().updateDialogue('dlg-1', { startFrame: 120 });
    expect(events()[0].manuallyTimed).toBe(true);
    state().updateDialogue('dlg-2', { durationFrames: 90 });
    expect(events()[1].manuallyTimed).toBe(true);
  });

  it('应用服务端已保存舞台后状态为 saved，且可撤销回退时间轴更新', () => {
    const before = state().stage!;
    const serverStage = stageDataSchema.parse({
      ...before,
      version: before.version + 1,
      scenes: before.scenes.map((scene) => ({
        ...scene,
        dialogueEvents: scene.dialogueEvents.map((event) => ({
          ...event,
          durationFrames: event.durationFrames + 30,
          audioAssetId: `audio-${event.id}`,
        })),
      })),
    });

    state().applyServerStage(serverStage, '生成配音并更新时间轴');
    expect(state().stage).toBe(serverStage);
    expect(state().saveStatus).toBe('saved');
    expect(state().historyPast).toHaveLength(1);
    expect(events()[0].audioAssetId).toBe('audio-dlg-1');

    state().undo();
    expect(events()[0].audioAssetId).toBeUndefined();
    expect(events()[0].durationFrames).toBe(60);
    expect(state().saveStatus).toBe('dirty');
    // 撤销不回退服务端递增的版本号，避免保存基线错乱。
    expect(state().stage?.version).toBe(serverStage.version);
  });
});

describe('工作台场景切换', () => {
  function multiScene(activeSceneId: string | null = 'scene-1') {
    const base = makeStage();
    const second = {
      id: 'scene-2',
      name: '厨房',
      backgroundAssetId: null,
      objects: [],
      characters: [],
      dialogueEvents: [
        {
          id: 'dlg-kitchen',
          characterId: 'char-kitchen',
          text: '我在这儿。',
          posture: 'standing',
          startFrame: 0,
          durationFrames: 60,
        },
      ],
    };
    return stageDataSchema.parse({
      ...base,
      activeSceneId,
      scenes: [base.scenes[0], second],
    });
  }

  it('切换到第二个场景会更新 activeSceneId、清空选中并纳入撤销历史', () => {
    useStageStore.setState({ stage: multiScene(), selectedId: 'char-1' });
    state().setActiveScene('scene-2');

    expect(state().stage?.activeSceneId).toBe('scene-2');
    expect(selectActiveScene(state())?.id).toBe('scene-2');
    expect(state().selectedId).toBeNull();
    expect(state().saveStatus).toBe('dirty');
    expect(state().historyPast).toHaveLength(1);
    expect(state().historyPast[0].label).toContain('厨房');
  });

  it('切换后编辑只作用于新场景，原场景数据保持不变', () => {
    useStageStore.setState({ stage: multiScene() });
    const firstBefore = state().stage!.scenes[0];
    state().setActiveScene('scene-2');
    state().updateDialogue('dlg-kitchen', { text: '改了厨房台词' });

    expect(events()[0].text).toBe('改了厨房台词');
    expect(state().stage!.scenes[0]).toBe(firstBefore);
  });

  it('undo / redo 会回到 / 重放切换前的场景', () => {
    useStageStore.setState({ stage: multiScene() });
    state().setActiveScene('scene-2');
    state().undo();
    expect(state().stage?.activeSceneId).toBe('scene-1');
    expect(selectActiveScene(state())?.name).toBe('客厅');
    state().redo();
    expect(state().stage?.activeSceneId).toBe('scene-2');
  });

  it('无效场景 id 不改变任何状态', () => {
    useStageStore.setState({ stage: multiScene() });
    const before = state().stage;
    state().setActiveScene('scene-not-exist');
    expect(state().stage).toBe(before);
    expect(state().historyPast).toHaveLength(0);
  });

  it('点击已激活场景不产生历史，也不改写保存状态', () => {
    useStageStore.setState({ stage: multiScene() });
    state().setActiveScene('scene-1');
    expect(state().historyPast).toHaveLength(0);
    expect(state().saveStatus).toBe('saved');
  });

  it('旧数据 activeSceneId 为空时只修正指针，不压入切换历史', () => {
    useStageStore.setState({ stage: multiScene(null) });
    expect(selectActiveScene(state())?.id).toBe('scene-1');
    state().setActiveScene('scene-1');
    expect(state().stage?.activeSceneId).toBe('scene-1');
    expect(state().saveStatus).toBe('dirty');
    expect(state().historyPast).toHaveLength(0);
  });
});
