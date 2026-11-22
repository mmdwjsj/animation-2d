import { z } from 'zod';
import { stageDataSchema } from './stage';
import { audioAssetFileSchema } from './audio';
import { projectLanguageSchema } from './language';

/**
 * 阶段 7 TTS API 契约（架构 5.7 / 9 / 12 节，PRD 12.3 / 13）。
 *
 * Provider 的参数差异全部封装在服务端 Provider 描述里，UI 只拿到通用字段
 * （引擎 / 声音 / 语速 / 语言），不包含任何厂商专有参数（架构 5.7）。
 * 双语：引擎声明支持的语言与每种语言的默认音色，服务端按对白语言自动路由，
 * 不把某一个 TTS 厂商写死在业务逻辑中（PRD 13）。
 */

export const ttsVoiceSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().max(200),
  /** 音色所属语言；同一引擎可同时提供中泰两套音色。 */
  language: projectLanguageSchema,
});
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

/** 按语言给出默认音色；只支持单语种的引擎只需填对应字段。 */
export const ttsVoiceByLanguageSchema = z.object({
  zh: z.string().min(1).max(80).optional(),
  th: z.string().min(1).max(80).optional(),
});
export type TtsVoiceByLanguage = z.infer<typeof ttsVoiceByLanguageSchema>;

export const ttsProviderSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  /** 该引擎支持的语言；服务端据此按语言路由，不写死厂商。 */
  languages: z.array(projectLanguageSchema).min(1),
  voices: z.array(ttsVoiceSchema).min(1),
  defaultVoiceId: z.string().min(1).max(80),
  /** 每种语言的默认音色，自动路由时优先于 defaultVoiceId。 */
  defaultVoiceByLanguage: ttsVoiceByLanguageSchema.optional(),
  minSpeed: z.number().positive(),
  maxSpeed: z.number().positive(),
  defaultSpeed: z.number().positive(),
});
export type TtsProvider = z.infer<typeof ttsProviderSchema>;

export const ttsProvidersResponseSchema = z.object({
  data: z.object({ providers: z.array(ttsProviderSchema) }),
});

/**
 * 生成目标：不传 dialogueIds 表示全部对白；传单个即「重新生成单句」（PRD 13）。
 * providerId 省略表示「按语言自动路由」；显式指定时服务端校验引擎支持该语言。
 * language 省略表示处理全部语言的对白；指定后只处理该语言（便于分语种分别生成）。
 */
export const ttsGenerateTargetSchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().min(1).max(80).optional(),
  language: projectLanguageSchema.optional(),
  voiceId: z.string().min(1).max(80).optional(),
  speed: z.number().positive().optional(),
  dialogueIds: z.array(z.string().min(1).max(80)).min(1).max(200).optional(),
});
export type TtsGenerateTarget = z.infer<typeof ttsGenerateTargetSchema>;

export const ttsPlanRequestSchema = ttsGenerateTargetSchema;
export type TtsPlanRequest = z.infer<typeof ttsPlanRequestSchema>;

/** 一条路由明细：某语言用哪个引擎、哪个音色、覆盖几句。 */
export const ttsRoutingEntrySchema = z.object({
  language: projectLanguageSchema,
  providerId: z.string().min(1).max(80),
  providerName: z.string().min(1).max(80),
  voiceId: z.string().min(1).max(80),
  voiceName: z.string().min(1).max(80),
  count: z.number().int().nonnegative(),
});
export type TtsRoutingEntry = z.infer<typeof ttsRoutingEntrySchema>;

/**
 * 影响预览只读返回「会改什么、哪些受保护」，不伪造尚未生成的精确时长。
 * 真实时长只有生成音频后才能确定，写入由 confirmed 流程完成（PRD 12.3）。
 */
export const ttsPlanDialogueSchema = z.object({
  dialogueId: z.string().min(1).max(80),
  /** 该对白所属场景；多场景项目按场景顺序展示，单场景项目也始终有值。 */
  sceneName: z.string().min(1).max(80).optional(),
  characterName: z.string().min(1).max(80),
  text: z.string().min(1),
  /** 实际生效语言（显式字段或继承项目默认）。旧客户端可忽略。 */
  language: projectLanguageSchema.optional(),
  /** 该句实际路由到的引擎与音色；旧客户端可忽略。 */
  providerId: z.string().min(1).max(80).optional(),
  voiceId: z.string().min(1).max(80).optional(),
  currentStartFrame: z.number().int().nonnegative(),
  currentDurationFrames: z.number().int().positive(),
  /** 用户手动调整过时间：不自动移动起始帧，只保证时长不短于音频（保护策略）。 */
  manuallyTimed: z.boolean(),
  hasAudio: z.boolean(),
});
export type TtsPlanDialogue = z.infer<typeof ttsPlanDialogueSchema>;

export const ttsPlanSchema = z.object({
  /** 主引擎（首句路由结果），保持既有单引擎语义。 */
  providerId: z.string().min(1).max(80),
  voiceId: z.string().min(1).max(80),
  speed: z.number().positive(),
  /** 用户限定的语言；未限定则省略。 */
  language: projectLanguageSchema.optional(),
  /** 按语言拆分的实际路由明细，双语项目会有多条。 */
  routing: z.array(ttsRoutingEntrySchema),
  targetCount: z.number().int().nonnegative(),
  dialogues: z.array(ttsPlanDialogueSchema),
  /** 手动调整过、将被保护起始位置的对白数量。 */
  protectedCount: z.number().int().nonnegative(),
  /** 已存在音频、生成后会被替换（新资产）的对白数量。 */
  replacingCount: z.number().int().nonnegative(),
  /** 首个（工作台当前）场景的时长，保持阶段 7 语义不变。 */
  currentSceneDurationFrames: z.number().int().nonnegative(),
  /** 本次生成覆盖的场景数；单场景项目为 1。 */
  sceneCount: z.number().int().nonnegative(),
  /** 全部场景顺序拼接后的总帧数，供多场景导出参考。 */
  projectDurationFrames: z.number().int().nonnegative(),
  warning: z.string(),
});
export type TtsPlan = z.infer<typeof ttsPlanSchema>;

export const ttsPlanResponseSchema = z.object({ data: ttsPlanSchema });

/** confirmed 必须是字面量 true，服务端绝不隐式覆盖用户已编辑的时间轴。 */
export const ttsGenerateRequestSchema = ttsGenerateTargetSchema.extend({
  confirmed: z.literal(true),
});
export type TtsGenerateRequest = z.infer<typeof ttsGenerateRequestSchema>;

export const ttsGeneratedItemSchema = z.object({
  dialogueId: z.string().min(1).max(80),
  assetId: z.string().min(1).max(80),
  durationMs: z.number().positive(),
  /** 按音频真实时长换算并追加余量后的对白帧数，防止音频被提前截断。 */
  durationFrames: z.number().int().positive(),
  startFrame: z.number().int().nonnegative(),
  /** 该句实际使用的语言；旧客户端可忽略。 */
  language: projectLanguageSchema.optional(),
});
export type TtsGeneratedItem = z.infer<typeof ttsGeneratedItemSchema>;

export const ttsSkippedItemSchema = z.object({
  dialogueId: z.string().min(1).max(80),
  reason: z.string().min(1),
});

export const ttsGenerateResponseSchema = z.object({
  data: z.object({
    stage: stageDataSchema,
    audio: audioAssetFileSchema,
    generated: z.array(ttsGeneratedItemSchema),
    skipped: z.array(ttsSkippedItemSchema),
    sceneDurationFrames: z.number().int().nonnegative(),
  }),
});
export type TtsGenerateResult = z.infer<typeof ttsGenerateResponseSchema>['data'];
