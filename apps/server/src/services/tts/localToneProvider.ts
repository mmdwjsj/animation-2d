import { createHash } from 'node:crypto';
import { TTS_AUDIO, type TtsProvider as TtsProviderDescriptor } from '@animation/shared';
import { errors } from '../../errors';
import type { TtsSynthesisProvider, TtsSynthesisRequest, TtsSynthesisResult } from './provider';
import { computeAmplitudeEnvelope, encodeWav } from './wav';

/**
 * 本地离线 TTS Provider（第一版）。
 *
 * 说明：这是**可播放的音节化提示音**，不是真人语音。它不联网、不调用任何
 * 外部 AI 服务（AGENTS 10），完全由「文本 + 声音 + 语速」确定性合成 PCM，
 * 因此真实时长来自样本数、振幅包络可缓存、同一输入字节完全一致。
 *
 * 未来接入真实 TTS 时只需实现同一个 TtsSynthesisProvider 接口并注册，
 * 剧本、时间轴、嘴型、字幕与渲染逻辑都不需要改动（架构 5.7）。
 */

const MAX_TEXT_LENGTH = 2000;
/** 单个音节的基准时长（毫秒），按语速缩放。 */
const SYLLABLE_MS = 210;
/** 音节间静音（毫秒）。 */
const GAP_MS = 55;
/** 标点停顿倍数。 */
const PAUSE_FACTOR = 2.2;
/** 首尾淡入淡出时长（毫秒），避免爆音。 */
const FADE_MS = 15;

interface VoiceConfig {
  id: string;
  baseFrequency: number;
}

const VOICES: readonly VoiceConfig[] = [
  { id: 'voice-warm', baseFrequency: 118 },
  { id: 'voice-bright', baseFrequency: 196 },
  { id: 'voice-calm', baseFrequency: 152 },
];

const DESCRIPTOR: TtsProviderDescriptor = {
  id: 'local-tone',
  name: '本地音色（离线）',
  description:
    '离线确定性音节合成，输出可播放 WAV 与真实时长，适合开发与验收；替换真实 TTS 不影响业务逻辑。',
  voices: [
    { id: 'voice-warm', name: '温和男声', description: '低基频，适合成熟角色' },
    { id: 'voice-bright', name: '明亮女声', description: '高基频，适合年轻角色' },
    { id: 'voice-calm', name: '平稳旁白', description: '中基频，适合旁白' },
  ],
  defaultVoiceId: 'voice-warm',
  minSpeed: TTS_AUDIO.minSpeed,
  maxSpeed: TTS_AUDIO.maxSpeed,
  defaultSpeed: TTS_AUDIO.defaultSpeed,
};

type Token = { kind: 'syllable' | 'pause'; text: string; long?: boolean };

/** 中文按字、连续拉丁字母数字按词切分；标点与空白转为停顿。 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let latin = '';
  const flushLatin = () => {
    if (latin) {
      tokens.push({ kind: 'syllable', text: latin });
      latin = '';
    }
  };
  for (const char of text) {
    if (/[a-zA-Z0-9]/.test(char)) {
      latin += char;
      continue;
    }
    flushLatin();
    if (/[\s]/.test(char)) {
      tokens.push({ kind: 'pause', text: char });
    } else if (/[，。！？、,.!?；;：:…—～~]/.test(char)) {
      tokens.push({ kind: 'pause', text: char, long: true });
    } else {
      tokens.push({ kind: 'syllable', text: char });
    }
  }
  flushLatin();
  return tokens;
}

function codeUnit(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return value;
}

/** 确定性伪随机，仅用于给波形加一点字符相关的质感；种子完全由输入决定。 */
function makeNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
}

function envelopeAt(progress: number): number {
  // ADSR：8% 起音、15% 衰减、持续 0.65、22% 释放，保证音节有自然开合。
  if (progress < 0.08) return progress / 0.08;
  if (progress < 0.23) return 1 - (progress - 0.08) / 0.15 * 0.35;
  if (progress < 0.78) return 0.65;
  return Math.max(0, 0.65 * (1 - (progress - 0.78) / 0.22));
}

export class LocalToneProvider implements TtsSynthesisProvider {
  readonly descriptor = DESCRIPTOR;

  synthesize(request: TtsSynthesisRequest): TtsSynthesisResult {
    const text = request.text.trim();
    if (!text) throw errors.tts('对白文本为空，无法生成配音。');
    if (text.length > MAX_TEXT_LENGTH) {
      throw errors.tts(`单句对白超过 ${MAX_TEXT_LENGTH} 字，无法生成配音，请拆分后再试。`);
    }
    const speed = Number.isFinite(request.speed) && request.speed > 0 ? request.speed : 1;
    const voice = VOICES.find((item) => item.id === request.voiceId);
    if (!voice) throw errors.tts(`声音「${request.voiceId}」不可用。`);
    const fps = Number.isFinite(request.fps) && request.fps > 0 ? Math.floor(request.fps) : 30;
    const sampleRate = TTS_AUDIO.sampleRate;
    const tokens = tokenize(text);
    const samples: number[] = [];

    for (const token of tokens) {
      if (token.kind === 'pause') {
        const pauseMs = (GAP_MS * (token.long ? PAUSE_FACTOR : 1)) / speed;
        const count = Math.max(1, Math.round((sampleRate * pauseMs) / 1000));
        for (let i = 0; i < count; i += 1) samples.push(0);
        continue;
      }

      const unit = codeUnit(token.text);
      const frequency = voice.baseFrequency + (unit % 19) * 3;
      const count = Math.max(1, Math.round((sampleRate * SYLLABLE_MS) / 1000 / speed));
      const noise = makeNoise(unit ^ (voice.baseFrequency * 7919));
      for (let i = 0; i < count; i += 1) {
        const t = i / sampleRate;
        const gain = envelopeAt(i / count);
        const wave =
          Math.sin(2 * Math.PI * frequency * t) * 0.62 +
          Math.sin(2 * Math.PI * frequency * 2.1 * t) * 0.24 +
          Math.sin(2 * Math.PI * frequency * 3.7 * t) * 0.1 +
          noise() * 0.05;
        samples.push(wave * gain * 0.42);
      }
      const gapCount = Math.max(1, Math.round((sampleRate * GAP_MS) / 1000 / speed));
      for (let i = 0; i < gapCount; i += 1) samples.push(0);
    }

    // 最短时长保证：极短文本也不会生成 0 字节音频，字幕与嘴型仍可见。
    const minSamples = Math.round((sampleRate * TTS_AUDIO.minDurationMs) / 1000);
    while (samples.length < minSamples) samples.push(0);

    const fadeCount = Math.min(samples.length, Math.round((sampleRate * FADE_MS) / 1000));
    for (let i = 0; i < fadeCount; i += 1) {
      const factor = i / fadeCount;
      samples[i] *= factor;
      samples[samples.length - 1 - i] *= factor;
    }

    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    }

    const encoded = encodeWav(pcm, sampleRate, TTS_AUDIO.channels);
    const textHash = createHash('sha256')
      .update(`${DESCRIPTOR.id}|${request.voiceId}|${speed.toFixed(3)}|${text}`)
      .digest('hex')
      .slice(0, 16);

    return {
      audio: encoded.buffer,
      durationMs: Math.round(encoded.durationMs * 1000) / 1000,
      sampleRate: encoded.sampleRate,
      channels: encoded.channels,
      format: 'wav',
      envelope: computeAmplitudeEnvelope(pcm, sampleRate, fps),
      envelopeFps: fps,
      textHash,
    };
  }
}
