import { describe, expect, it } from 'vitest';
import { characterFrame } from '../character/transform';
import {
  DEFAULT_SCENE_TAIL_FRAMES,
  MIN_SCENE_DURATION_FRAMES,
  activeDialogueAtFrame,
  formatTimecode,
  frameToSeconds,
  getStateAtFrame,
  normalizeFrame,
  sceneDurationFrames,
  secondsToFrame,
  type AnimationProjectLike,
  type CharacterLike,
  type DialogueLike,
  type SceneLike,
} from './evaluator';

const FPS = 30;

const characters: CharacterLike[] = [
  { id: 'char-1', name: '老王', posture: 'standing', eyeState: 'open', mouthState: 'closed', visible: true },
  { id: 'char-2', name: '小李', posture: 'sitting', eyeState: 'open', mouthState: 'closed', visible: true },
];

const dialogues: DialogueLike[] = [
  { id: 'dlg-1', characterId: 'char-1', text: '你回来了？', posture: 'sitting', startFrame: 0, durationFrames: 60 },
  { id: 'dlg-2', characterId: 'char-2', text: '我的蛋糕呢？', posture: 'standing', startFrame: 75, durationFrames: 45 },
  { id: 'dlg-3', characterId: 'char-1', text: '我不知道啊。', posture: 'standing', startFrame: 135, durationFrames: 60 },
];

const scene: SceneLike = { id: 'scene-1', name: '客厅', characters, dialogueEvents: dialogues };
const project: AnimationProjectLike = { scenes: [scene] };
const evaluate = (frame: number) => getStateAtFrame(project, 'scene-1', frame, { fps: FPS });

describe('帧与时间单位（AGENTS 9：帧到秒转换）', () => {
  it('帧秒互转并保留整数帧语义', () => {
    expect(frameToSeconds(45, FPS)).toBe(1.5);
    expect(secondsToFrame(1.5, FPS)).toBe(45);
    expect(secondsToFrame(1.501, FPS)).toBe(45);
    expect(frameToSeconds(0, FPS)).toBe(0);
  });

  it('负帧、小数帧与非法值统一归一化', () => {
    expect(normalizeFrame(-3)).toBe(0);
    expect(normalizeFrame(12.9)).toBe(12);
    expect(normalizeFrame(Number.NaN)).toBe(0);
    expect(normalizeFrame(Number.POSITIVE_INFINITY)).toBe(0);
    expect(secondsToFrame(-1, FPS)).toBe(0);
  });

  it('时间码用于界面显示，不改变内部整数帧', () => {
    expect(formatTimecode(0, FPS)).toBe('00:00:00');
    expect(formatTimecode(45, FPS)).toBe('00:01:15');
    expect(formatTimecode(1800, FPS)).toBe('01:00:00');
    expect(formatTimecode(-10, FPS)).toBe('00:00:00');
  });
});

describe('任意帧状态计算（AGENTS 9：确定性）', () => {
  it('同一份数据与帧号得到完全一致的状态', () => {
    expect(evaluate(80)).toEqual(evaluate(80));
    expect(evaluate(0)).toEqual(evaluate(0));
  });

  it('可以任意跳帧，不依赖上一帧运行结果', () => {
    const direct = evaluate(0);
    evaluate(500);
    evaluate(137);
    expect(evaluate(0)).toEqual(direct);
  });

  it('小数/负帧先归一化再求值', () => {
    expect(evaluate(0.9)).toEqual(evaluate(0));
    expect(evaluate(-20)).toEqual(evaluate(0));
  });

  it('超出场景总时长的帧仍然可算，只是没有生效对白', () => {
    const state = evaluate(9999);
    expect(state?.frame).toBe(9999);
    expect(state?.activeDialogue).toBeNull();
    expect(state?.subtitle).toBeNull();
    expect(state?.characters.every((item) => item.mouthState === 'closed')).toBe(true);
  });

  it('场景不存在时返回 null，不猜测场景内容', () => {
    expect(getStateAtFrame(project, 'missing', 0, { fps: FPS })).toBeNull();
  });

  it('输出携带场景总时长，与纯函数推导一致', () => {
    expect(evaluate(0)?.durationFrames).toBe(sceneDurationFrames(scene));
    expect(evaluate(0)?.fps).toBe(FPS);
  });
});

describe('姿态切换与锚点（AGENTS 9：姿态切换锚点）', () => {
  it('说话时由对白事件驱动姿态，其余时间回到实例静态姿态', () => {
    expect(evaluate(0)?.characters[0].posture).toBe('sitting');
    expect(evaluate(70)?.characters[0].posture).toBe('standing');
    expect(evaluate(75)?.characters[1].posture).toBe('standing');
    expect(evaluate(130)?.characters[1].posture).toBe('sitting');
    expect(evaluate(140)?.characters[0].posture).toBe('standing');
  });

  it('同一逻辑锚点切换姿态时不跳动，只有局部原点按素材锚点校准', () => {
    const placement = { x: 540, y: 1650, width: 300 };
    const standing = { size: { width: 360, height: 600 }, anchor: { x: 180, y: 600 }, layers: [] };
    const sitting = { size: { width: 360, height: 600 }, anchor: { x: 180, y: 580 }, layers: [] };
    const a = characterFrame(placement, standing);
    const b = characterFrame(placement, sitting);
    expect(a.anchorX).toBe(b.anchorX);
    expect(a.scale).toBe(b.scale);
    expect(a.originX).toBe(b.originX);
    // 坐姿接触点比脚底高 20 局部像素，原点相应下移，锚点 (x, y) 始终不变。
    expect(b.originY).toBeGreaterThan(a.originY);
    expect(placement).toEqual({ x: 540, y: 1650, width: 300 });
  });
});

describe('对白时间边界（AGENTS 9：对白时间边界）', () => {
  it('半开区间：start 生效、end-1 生效、end 失效', () => {
    expect(activeDialogueAtFrame(dialogues, 0)?.id).toBe('dlg-1');
    expect(activeDialogueAtFrame(dialogues, 59)?.id).toBe('dlg-1');
    expect(activeDialogueAtFrame(dialogues, 60)).toBeNull();
    expect(activeDialogueAtFrame(dialogues, 75)?.id).toBe('dlg-2');
    expect(activeDialogueAtFrame(dialogues, 119)?.id).toBe('dlg-2');
    expect(activeDialogueAtFrame(dialogues, 120)).toBeNull();
    expect(activeDialogueAtFrame(dialogues, 194)?.id).toBe('dlg-3');
    expect(activeDialogueAtFrame(dialogues, 195)).toBeNull();
  });

  it('对白之间的留白区间不产生说话状态与字幕', () => {
    const state = evaluate(65);
    expect(state?.activeDialogue).toBeNull();
    expect(state?.subtitle).toBeNull();
    expect(state?.characters.every((item) => !item.isSpeaking)).toBe(true);
  });

  it('重叠对白取后开始者，结果可重复', () => {
    const overlapping: DialogueLike[] = [
      { id: 'a', characterId: 'char-1', text: 'A', posture: 'sitting', startFrame: 0, durationFrames: 100 },
      { id: 'b', characterId: 'char-2', text: 'B', posture: 'standing', startFrame: 20, durationFrames: 100 },
    ];
    expect(activeDialogueAtFrame(overlapping, 10)?.id).toBe('a');
    expect(activeDialogueAtFrame(overlapping, 30)?.id).toBe('b');
    expect(activeDialogueAtFrame(overlapping, 30)?.id).toBe(
      activeDialogueAtFrame([...overlapping].reverse(), 30)?.id,
    );
  });

  it('场景总时长按最后一句对白结束 + 尾部留白推导', () => {
    expect(sceneDurationFrames(scene)).toBe(195 + DEFAULT_SCENE_TAIL_FRAMES);
    expect(sceneDurationFrames({ dialogueEvents: [] })).toBe(MIN_SCENE_DURATION_FRAMES);
    expect(sceneDurationFrames(scene, 0)).toBe(195);
  });
});

describe('嘴型状态（AGENTS 9：嘴型状态）', () => {
  it('不说话时恒闭嘴，与帧号无关', () => {
    for (const frame of [0, 3, 6, 60, 75, 999]) {
      const state = evaluate(frame);
      const speakerId = state?.activeDialogue?.characterId;
      for (const item of state?.characters ?? []) {
        if (item.id !== speakerId) expect(item.mouthState).toBe('closed');
      }
    }
    expect(evaluate(65)?.characters.every((item) => item.mouthState === 'closed')).toBe(true);
  });

  it('说话时按整数帧确定性循环三种嘴型', () => {
    const states = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (frame) => evaluate(frame)?.characters[0].mouthState,
    );
    expect(states).toEqual([
      'closed', 'closed', 'closed',
      'open_small', 'open_small', 'open_small',
      'open_large', 'open_large', 'open_large',
      'closed',
    ]);
  });

  it('isSpeaking 与生效对白严格对应', () => {
    const at0 = evaluate(0);
    expect(at0?.characters[0].isSpeaking).toBe(true);
    expect(at0?.characters[0].activeDialogueId).toBe('dlg-1');
    expect(at0?.characters[1].isSpeaking).toBe(false);
    expect(at0?.characters[1].activeDialogueId).toBeNull();
    const at75 = evaluate(75);
    expect(at75?.characters[1].isSpeaking).toBe(true);
    expect(at75?.characters[0].isSpeaking).toBe(false);
  });
});

describe('字幕显示区间（AGENTS 9：字幕显示区间）', () => {
  it('字幕只在对白生效区间内显示，并携带说话角色名', () => {
    expect(evaluate(0)?.subtitle).toEqual({
      text: '你回来了？',
      characterName: '老王',
      dialogueId: 'dlg-1',
    });
    expect(evaluate(59)?.subtitle?.dialogueId).toBe('dlg-1');
    expect(evaluate(60)?.subtitle).toBeNull();
    expect(evaluate(75)?.subtitle).toEqual({
      text: '我的蛋糕呢？',
      characterName: '小李',
      dialogueId: 'dlg-2',
    });
    expect(evaluate(120)?.subtitle).toBeNull();
    expect(evaluate(194)?.subtitle?.dialogueId).toBe('dlg-3');
    expect(evaluate(195)?.subtitle).toBeNull();
  });

  it('对白引用了不存在的人物时字幕不伪造角色名', () => {
    const orphan: AnimationProjectLike = {
      scenes: [
        {
          ...scene,
          dialogueEvents: [
            { id: 'x', characterId: 'ghost', text: '画外音', posture: 'standing', startFrame: 0, durationFrames: 30 },
          ],
        },
      ],
    };
    const state = getStateAtFrame(orphan, 'scene-1', 0, { fps: FPS });
    expect(state?.subtitle?.characterName).toBe('');
    expect(state?.characters.every((item) => !item.isSpeaking)).toBe(true);
  });
});
