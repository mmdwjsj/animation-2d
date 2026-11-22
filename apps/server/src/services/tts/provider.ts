import {
  PROJECT_LANGUAGE_LABELS,
  TTS_AUDIO,
  type ProjectLanguage,
  type TtsProvider as TtsProviderDescriptor,
} from '@animation/shared';
import { errors } from '../../errors';

/**
 * 统一 TTS Provider 接口（架构 5.7 / PRD 13）。
 *
 * 业务层只依赖这个接口：不同 TTS 服务的厂商参数、鉴权、音频格式差异
 * 全部封装在 Provider 内部；UI 与 animation-core 只看到通用字段
 * （引擎 / 声音 / 语速 / 语言）与统一输出（音频字节 + 真实时长 + 缓存包络）。
 *
 * 双语：synthesize 是异步的，因为真实引擎多为子进程或 HTTP 调用；
 * 请求带 language，Provider 必须自行校验是否支持该语言，绝不静默用错音色。
 */
export interface TtsSynthesisRequest {
  text: string;
  voiceId: string;
  speed: number;
  /** 包络帧率，等于项目 FPS；由调用方从 PROJECT_DEFAULTS 传入。 */
  fps: number;
  /** 目标语言：中文 / 泰语。 */
  language: ProjectLanguage;
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
  /** 文本 + 语言 + 参数的确定性摘要，用于避免无意义的重复生成。 */
  textHash: string;
}

export interface TtsSynthesisProvider {
  readonly descriptor: TtsProviderDescriptor;
  synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult>;
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

  /** 不传 id 时取注册表第一个（保持既有单引擎语义）。 */
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

  /**
   * 按语言路由：preferredId 指定时校验该引擎确实支持此语言；
   * 未指定时取注册表中第一个声明支持该语言的引擎（注册顺序即优先级）。
   * 找不到就明确报错，绝不静默用其它语言的引擎顶替。
   */
  resolveFor(language: ProjectLanguage, preferredId?: string): TtsSynthesisProvider {
    const label = PROJECT_LANGUAGE_LABELS[language];
    if (preferredId) {
      const found = this.providers.get(preferredId);
      if (!found) throw errors.tts(`TTS 引擎「${preferredId}」不可用，请重新选择。`);
      if (!found.descriptor.languages.includes(language)) {
        throw errors.tts(
          `TTS 引擎「${found.descriptor.name}」不支持${label}，请改用支持${label}的引擎或切换为自动路由。`,
        );
      }
      return found;
    }
    for (const provider of this.providers.values()) {
      if (provider.descriptor.languages.includes(language)) return provider;
    }
    throw errors.tts(`没有支持${label}的 TTS 引擎，请检查引擎配置后重试。`);
  }

  /** 某引擎某语言的默认音色：优先按语言映射，其次取该语言第一个音色。 */
  defaultVoiceFor(provider: TtsSynthesisProvider, language: ProjectLanguage): string {
    const descriptor = provider.descriptor;
    const mapped = descriptor.defaultVoiceByLanguage?.[language];
    if (mapped && descriptor.voices.some((voice) => voice.id === mapped && voice.language === language)) {
      return mapped;
    }
    const first = descriptor.voices.find((voice) => voice.language === language);
    if (first) return first.id;
    throw errors.tts(
      `TTS 引擎「${descriptor.name}」没有${PROJECT_LANGUAGE_LABELS[language]}音色，请检查引擎配置。`,
    );
  }

  /** 校验并夹取通用参数，厂商专有参数不在此出现。 */
  normalize(
    provider: TtsSynthesisProvider,
    voiceId?: string,
    speed?: number,
    language?: ProjectLanguage,
  ) {
    const descriptor = provider.descriptor;
    const resolvedVoice = voiceId ?? descriptor.defaultVoiceId;
    const voice = descriptor.voices.find((item) => item.id === resolvedVoice);
    if (!voice) throw errors.tts(`声音「${resolvedVoice}」不属于当前 TTS 引擎。`);
    if (language && voice.language !== language) {
      throw errors.tts(
        `声音「${voice.name}」是${PROJECT_LANGUAGE_LABELS[voice.language]}音色，与当前${PROJECT_LANGUAGE_LABELS[language]}对白不匹配，请重新选择。`,
      );
    }
    const requested = speed ?? descriptor.defaultSpeed;
    if (!Number.isFinite(requested) || requested <= 0) {
      throw errors.tts('语速必须为正数。');
    }
    const clamped = Math.min(
      Math.max(requested, Math.max(TTS_AUDIO.minSpeed, descriptor.minSpeed)),
      Math.min(TTS_AUDIO.maxSpeed, descriptor.maxSpeed),
    );
    return { voiceId: resolvedVoice, speed: clamped, language: voice.language };
  }
}
