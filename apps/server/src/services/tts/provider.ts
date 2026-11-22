import { TTS_AUDIO, type TtsProvider as TtsProviderDescriptor } from '@animation/shared';
import { errors } from '../../errors';

/**
 * 统一 TTS Provider 接口（架构 5.7 / PRD 13）。
 *
 * 业务层只依赖这个接口：不同 TTS 服务的厂商参数、鉴权、音频格式差异
 * 全部封装在 Provider 内部；UI 与 animation-core 只看到通用字段
 * （引擎 / 声音 / 语速）与统一输出（音频字节 + 真实时长 + 缓存包络）。
 */
export interface TtsSynthesisRequest {
  text: string;
  voiceId: string;
  speed: number;
  /** 包络帧率，等于项目 FPS；由调用方从 PROJECT_DEFAULTS 传入。 */
  fps: number;
}

export interface TtsSynthesisResult {
  /** 完整音频文件字节（含文件头）。 */
  audio: Buffer;
  /** 真实时长，由 PCM 样本数推导，不是估算值。 */
  durationMs: number;
  sampleRate: number;
  channels: number;
  format: 'wav';
  /** 每帧归一化振幅（0..1），生成时一次性缓存。 */
  envelope: number[];
  envelopeFps: number;
  /** 文本 + 参数的确定性摘要，用于避免无意义的重复生成。 */
  textHash: string;
}

export interface TtsSynthesisProvider {
  readonly descriptor: TtsProviderDescriptor;
  synthesize(request: TtsSynthesisRequest): TtsSynthesisResult;
}

/** Provider 注册表：新增一家 TTS 只需 register，不改任何上层逻辑。 */
export class TtsProviderRegistry {
  private readonly providers = new Map<string, TtsSynthesisProvider>();

  constructor(providers: readonly TtsSynthesisProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: TtsSynthesisProvider): void {
    if (this.providers.has(provider.descriptor.id)) {
      throw errors.tts(`TTS Provider 重复注册：${provider.descriptor.id}`);
    }
    this.providers.set(provider.descriptor.id, provider);
  }

  list(): TtsProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => provider.descriptor);
  }

  /** 不传 id 时取注册表第一个（第一版只有一个本地 Provider）。 */
  resolve(id?: string): TtsSynthesisProvider {
    if (id) {
      const found = this.providers.get(id);
      if (!found) throw errors.tts(`TTS 引擎「${id}」不可用，请重新选择。`);
      return found;
    }
    const first = this.providers.values().next().value;
    if (!first) throw errors.tts('尚未配置任何 TTS 引擎。');
    return first;
  }

  /** 校验并夹取通用参数，厂商专有参数不在此出现。 */
  normalize(provider: TtsSynthesisProvider, voiceId?: string, speed?: number) {
    const descriptor = provider.descriptor;
    const resolvedVoice = voiceId ?? descriptor.defaultVoiceId;
    if (!descriptor.voices.some((voice) => voice.id === resolvedVoice)) {
      throw errors.tts(`声音「${resolvedVoice}」不属于当前 TTS 引擎。`);
    }
    const requested = speed ?? descriptor.defaultSpeed;
    if (!Number.isFinite(requested) || requested <= 0) {
      throw errors.tts('语速必须为正数。');
    }
    const clamped = Math.min(
      Math.max(requested, Math.max(TTS_AUDIO.minSpeed, descriptor.minSpeed)),
      Math.min(TTS_AUDIO.maxSpeed, descriptor.maxSpeed),
    );
    return { voiceId: resolvedVoice, speed: clamped };
  }
}
