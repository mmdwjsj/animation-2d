import { describe, expect, it } from 'vitest';
import { PROJECT_DEFAULTS } from '@animation/shared';
import { AppError } from '../../errors';
import { LocalToneProvider } from './localToneProvider';
import { TtsProviderRegistry } from './provider';
import { readWavDurationMs } from './wav';

const provider = new LocalToneProvider();
const base = { text: '你回来了？', voiceId: 'voice-warm', speed: 1, fps: PROJECT_DEFAULTS.fps };

describe('LocalToneProvider：确定性真实音频', () => {
  it('输出有效 WAV，元数据时长与 WAV 头 data 长度一致', () => {
    const result = provider.synthesize(base);
    expect(result.audio.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result.audio.toString('ascii', 8, 12)).toBe('WAVE');
    expect(readWavDurationMs(result.audio)).toBeCloseTo(result.durationMs, 3);
    expect(result.sampleRate).toBe(16000);
    expect(result.channels).toBe(1);
    expect(result.format).toBe('wav');
  });

  it('同一文本 + 声音 + 语速生成完全一致的字节与包络', () => {
    const first = provider.synthesize(base);
    const second = provider.synthesize(base);
    expect(first.audio.equals(second.audio)).toBe(true);
    expect(first.envelope).toEqual(second.envelope);
    expect(first.textHash).toBe(second.textHash);
    expect(first.durationMs).toBe(second.durationMs);
  });

  it('文本、声音、语速任一变化都会改变音频与摘要', () => {
    const original = provider.synthesize(base);
    expect(provider.synthesize({ ...base, text: '我的蛋糕呢？' }).audio.equals(original.audio)).toBe(false);
    expect(provider.synthesize({ ...base, voiceId: 'voice-bright' }).audio.equals(original.audio)).toBe(false);
    expect(provider.synthesize({ ...base, speed: 1.5 }).textHash).not.toBe(original.textHash);
  });

  it('语速越快，真实时长越短', () => {
    const slow = provider.synthesize({ ...base, speed: 0.75 });
    const fast = provider.synthesize({ ...base, speed: 1.5 });
    expect(fast.durationMs).toBeLessThan(slow.durationMs);
  });

  it('中英文与标点混合仍可生成，且不超过最小时长', () => {
    const result = provider.synthesize({ ...base, text: 'Hi 老王, 你回来了！OK' });
    expect(result.durationMs).toBeGreaterThanOrEqual(300);
    expect(result.envelope.length).toBeGreaterThan(0);
  });

  it('空文本明确报错，不静默生成空音频', () => {
    expect(() => provider.synthesize({ ...base, text: '   ' })).toThrow(AppError);
  });

  it('过长文本明确报错而不是静默截断', () => {
    expect(() => provider.synthesize({ ...base, text: '啊'.repeat(2001) })).toThrow(/超过/);
  });

  it('包络为缓存数据：长度等于音频帧数、值在 0..1、有开合变化', () => {
    const result = provider.synthesize({ ...base, text: '你回来了？我不知道啊。' });
    const expectedFrames = Math.ceil((result.durationMs / 1000) * result.envelopeFps);
    expect(result.envelope.length).toBe(expectedFrames);
    expect(result.envelope.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(Math.max(...result.envelope)).toBeGreaterThan(0.5);
    expect(Math.min(...result.envelope)).toBeLessThan(0.1);
  });
});

describe('TtsProviderRegistry：统一 Provider 抽象', () => {
  const registry = new TtsProviderRegistry([provider]);

  it('列出 Provider 的通用描述，不含厂商专有字段', () => {
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('local-tone');
    expect(list[0].voices.length).toBeGreaterThan(0);
    expect(Object.keys(list[0]).sort()).toEqual(
      [
        'defaultSpeed',
        'defaultVoiceId',
        'description',
        'id',
        'maxSpeed',
        'minSpeed',
        'name',
        'voices',
      ].sort(),
    );
  });

  it('未传 id 取默认 Provider；未知 id 报 TTS_FAILED', () => {
    expect(registry.resolve().descriptor.id).toBe('local-tone');
    expect(() => registry.resolve('not-exist')).toThrow(/TTS 引擎/);
  });

  it('参数校验与夹取由 registry 完成，非法声音明确报错', () => {
    const resolved = registry.resolve();
    expect(registry.normalize(resolved, undefined, undefined)).toEqual({
      voiceId: 'voice-warm',
      speed: 1,
    });
    expect(registry.normalize(resolved, 'voice-bright', 9).speed).toBe(2);
    expect(registry.normalize(resolved, 'voice-bright', 0.01).speed).toBe(0.5);
    expect(() => registry.normalize(resolved, 'bad-voice')).toThrow(/声音/);
  });
});
