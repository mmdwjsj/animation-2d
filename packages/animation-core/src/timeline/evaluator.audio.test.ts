import { describe, expect, it } from 'vitest';
import {
  MOUTH_ENVELOPE_LARGE_THRESHOLD,
  MOUTH_ENVELOPE_SMALL_THRESHOLD,
  mouthStateFromEnvelope,
} from './mouthEnvelope';
import { getStateAtFrame, type AnimationProjectLike } from './evaluator';

const FPS = 30;

const envelope = [0, 0.2, 0.8, 0.3, 0, 0.9];

function project(audioAssetId?: string): AnimationProjectLike {
  return {
    scenes: [
      {
        id: 'scene-1',
        name: '客厅',
        characters: [
          {
            id: 'char-1',
            name: '老王',
            posture: 'standing',
            eyeState: 'open',
            mouthState: 'closed',
            visible: true,
          },
          {
            id: 'char-2',
            name: '小李',
            posture: 'standing',
            eyeState: 'open',
            mouthState: 'closed',
            visible: true,
          },
        ],
        dialogueEvents: [
          {
            id: 'dlg-1',
            characterId: 'char-1',
            text: '你回来了？',
            posture: 'sitting',
            startFrame: 10,
            durationFrames: 20,
            ...(audioAssetId ? { audioAssetId } : {}),
          },
        ],
      },
    ],
  };
}

describe('mouthStateFromEnvelope（缓存振幅包络，纯函数）', () => {
  it('低振幅闭嘴、中振幅小张嘴、高振幅大张嘴', () => {
    expect(mouthStateFromEnvelope([0], 0)).toBe('closed');
    expect(
      mouthStateFromEnvelope([MOUTH_ENVELOPE_SMALL_THRESHOLD + 0.01], 0),
    ).toBe('open_small');
    expect(mouthStateFromEnvelope([MOUTH_ENVELOPE_LARGE_THRESHOLD], 0)).toBe('open_large');
    expect(mouthStateFromEnvelope([1], 0)).toBe('open_large');
  });

  it('阈值边界不重叠且顺序正确', () => {
    expect(MOUTH_ENVELOPE_SMALL_THRESHOLD).toBeLessThan(MOUTH_ENVELOPE_LARGE_THRESHOLD);
    expect(mouthStateFromEnvelope([MOUTH_ENVELOPE_SMALL_THRESHOLD], 0)).toBe('closed');
  });

  it('空包络、越界帧、负帧与非法值一律闭嘴', () => {
    expect(mouthStateFromEnvelope([], 0)).toBe('closed');
    expect(mouthStateFromEnvelope([0.9], 5)).toBe('closed');
    expect(mouthStateFromEnvelope([0.9], -3)).toBe('open_large');
    expect(mouthStateFromEnvelope([Number.NaN], 0)).toBe('closed');
    expect(mouthStateFromEnvelope([0.9], Number.NaN)).toBe('open_large');
  });

  it('任意跳帧结果一致，不依赖上一帧', () => {
    const at2 = mouthStateFromEnvelope(envelope, 2);
    mouthStateFromEnvelope(envelope, 4);
    expect(mouthStateFromEnvelope(envelope, 2)).toBe(at2);
  });
});

describe('getStateAtFrame 音频驱动嘴型', () => {
  const options = {
    fps: FPS,
    audioEnvelopes: { 'audio-1': envelope } as Readonly<Record<string, readonly number[]>>,
  };

  it('有包络时说话角色使用音频嘴型，其余角色闭嘴', () => {
    const state = getStateAtFrame(project('audio-1'), 'scene-1', 11, options);
    expect(state).not.toBeNull();
    const speaker = state?.characters.find((item) => item.id === 'char-1');
    const other = state?.characters.find((item) => item.id === 'char-2');
    expect(speaker?.mouthSource).toBe('audio');
    expect(speaker?.mouthState).toBe('open_small'); // localFrame = 1 -> 0.2
    expect(other?.mouthSource).toBe('silent');
    expect(other?.mouthState).toBe('closed');
  });

  it('嘴型按对白内相对帧变化，而非全局帧', () => {
    expect(
      getStateAtFrame(project('audio-1'), 'scene-1', 12, options)?.characters[0].mouthState,
    ).toBe('open_large'); // localFrame = 2 -> 0.8
    expect(
      getStateAtFrame(project('audio-1'), 'scene-1', 14, options)?.characters[0].mouthState,
    ).toBe('closed'); // localFrame = 4 -> 0
  });

  it('对白外的帧不张嘴，字幕也不可见', () => {
    const state = getStateAtFrame(project('audio-1'), 'scene-1', 30, options);
    expect(state?.characters[0].mouthSource).toBe('silent');
    expect(state?.characters[0].mouthState).toBe('closed');
    expect(state?.subtitle).toBeNull();
  });

  it('包络缺失时回退确定性循环嘴型，不报错', () => {
    const state = getStateAtFrame(project('audio-1'), 'scene-1', 11, { fps: FPS });
    expect(state?.characters[0].mouthSource).toBe('cycle');
    expect(['closed', 'open_small', 'open_large']).toContain(state?.characters[0].mouthState);
  });

  it('对白未绑定音频时回退循环，且相同帧重复求值完全一致', () => {
    const first = getStateAtFrame(project(), 'scene-1', 12, options);
    const second = getStateAtFrame(project(), 'scene-1', 12, options);
    expect(first?.characters[0].mouthSource).toBe('cycle');
    expect(first).toEqual(second);
  });

  it('音频嘴型与循环嘴型均保持姿态由对白事件驱动', () => {
    const audio = getStateAtFrame(project('audio-1'), 'scene-1', 12, options);
    const cycle = getStateAtFrame(project(), 'scene-1', 12, { fps: FPS });
    expect(audio?.characters[0].posture).toBe('sitting');
    expect(cycle?.characters[0].posture).toBe('sitting');
    expect(audio?.subtitle?.text).toBe('你回来了？');
  });
});
