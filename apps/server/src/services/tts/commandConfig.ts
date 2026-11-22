import { z } from 'zod';
import {
  projectLanguageSchema,
  ttsVoiceByLanguageSchema,
  ttsVoiceSchema,
} from '@animation/shared';

/**
 * 外部 TTS 引擎配置（参考 chat-2d-video 的「命令模板 Provider」设计）。
 *
 * 厂商专有参数、密钥、命令与音色全部在配置文件/环境变量里，业务代码不写死任何厂商；
 * 配置文件默认不加载，只有显式设置 ANIMATION_TTS_PROVIDERS_FILE 时才注册，
 * 因此项目默认仍是纯离线（AGENTS 10：未经明确同意不引入外部 AI 服务）。
 */
export const commandTtsConfigSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    description: z.string().max(300).default(''),
    /** 该引擎支持的语言；服务端据此按对白语言路由。 */
    languages: z.array(projectLanguageSchema).min(1),
    /** command：子进程命令模板；http：OpenAI 兼容 /v1/audio/speech。 */
    kind: z.enum(['command', 'http']).default('command'),

    // —— command ——
    command: z.string().min(1).optional(),
    /** 模板变量：{text} {voice} {speed} {language} {output}。 */
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    /**
     * 追加子进程环境变量。值写成 {env:VAR_NAME} 时从进程环境读取，
     * 保证密钥不落盘（与参考项目一致）。
     */
    env: z.record(z.string()).optional(),

    // —— http ——
    baseUrl: z.string().url().optional(),
    apiKeyEnv: z.string().optional(),
    model: z.string().optional(),
    /** 请求体里的厂商专有字段，仅存在于配置。 */
    body: z.record(z.unknown()).optional(),

    timeoutMs: z.number().int().positive().max(600000).default(120000),
    /** 命令产物扩展名；非 wav 会先经 ffmpeg 统一转 PCM16 WAV。 */
    outputExtension: z
      .string()
      .regex(/^\.[a-zA-Z0-9]+$/)
      .default('.wav'),

    voices: z.array(ttsVoiceSchema).min(1),
    defaultVoiceByLanguage: ttsVoiceByLanguageSchema.optional(),
    minSpeed: z.number().positive().default(0.5),
    maxSpeed: z.number().positive().default(2),
    defaultSpeed: z.number().positive().default(1),
  })
  .superRefine((config, ctx) => {
    if (config.kind === 'command' && !config.command) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `引擎「${config.id}」缺少 command。` });
    }
    if (config.kind === 'http' && !config.baseUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `引擎「${config.id}」缺少 baseUrl。` });
    }
    const languages = new Set(config.languages);
    for (const voice of config.voices) {
      if (!languages.has(voice.language)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `引擎「${config.id}」的音色「${voice.id}」语言 ${voice.language} 不在 languages 中。`,
        });
      }
    }
    const mapped = config.defaultVoiceByLanguage;
    if (mapped) {
      for (const [language, voiceId] of Object.entries(mapped)) {
        if (!voiceId) continue;
        if (!config.voices.some((voice) => voice.id === voiceId && voice.language === language)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `引擎「${config.id}」的 ${language} 默认音色「${voiceId}」不存在或语言不匹配。`,
          });
        }
      }
    }
  });

export type CommandTtsConfig = z.infer<typeof commandTtsConfigSchema>;

export const ttsProvidersFileSchema = z.object({
  providers: z.array(commandTtsConfigSchema),
});
export type TtsProvidersFile = z.infer<typeof ttsProvidersFileSchema>;
