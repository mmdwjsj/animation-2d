import { z } from 'zod';
import { stageDataSchema } from './stage';
import { audioAssetFileSchema } from './audio';

/**
 * 阶段 7 TTS API 契约（架构 5.7 / 9 / 12 节，PRD 12.3 / 13）。
 *
 * Provider 的参数差异全部封装在服务端 Provider 描述里，UI 只拿到通用字段
 * （引擎 / 声音 / 语速），不包含任何厂商专有参数（架构 5.7）。
 */

export const ttsVoiceSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().max(200),
});
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

export const ttsProviderSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  voices: z.array(ttsVoiceSchema).min(1),
  defaultVoiceId: z.string().min(1).max(80),
  minSpeed: z.number().positive(),
  maxSpeed: z.number().positive(),
  defaultSpeed: z.number().positive(),
});
export type TtsProvider = z.infer<typeof ttsProviderSchema>;

export const ttsProvidersResponseSchema = z.object({
  data: z.object({ providers: z.array(ttsProviderSchema) }),
});

/** 生成目标：不传 dialogueIds 表示全部对白；传单个即「重新生成单句」（PRD 13）。 */
export const ttsGenerateTargetSchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().min(1).max(80),
  voiceId: z.string().min(1).max(80).optional(),
  speed: z.number().positive().optional(),
  dialogueIds: z.array(z.string().min(1).max(80)).min(1).max(200).optional(),
});
export type TtsGenerateTarget = z.infer<typeof ttsGenerateTargetSchema>;

export const ttsPlanRequestSchema = ttsGenerateTargetSchema;
export type TtsPlanRequest = z.infer<typeof ttsPlanRequestSchema>;

/**
 * 影响预览只读返回「会改什么、哪些受保护」，不伪造尚未生成的精确时长。
 * 真实时长只有生成音频后才能确定，写入由 confirmed 流程完成（PRD 12.3）。
 */
export const ttsPlanDialogueSchema = z.object({
  dialogueId: z.string().min(1).max(80),
  characterName: z.string().min(1).max(80),
  text: z.string().min(1),
  currentStartFrame: z.number().int().nonnegative(),
  currentDurationFrames: z.number().int().positive(),
  /** 用户手动调整过时间：不自动移动起始帧，只保证时长不短于音频（保护策略）。 */
  manuallyTimed: z.boolean(),
  hasAudio: z.boolean(),
});
export type TtsPlanDialogue = z.infer<typeof ttsPlanDialogueSchema>;

export const ttsPlanSchema = z.object({
  providerId: z.string().min(1).max(80),
  voiceId: z.string().min(1).max(80),
  speed: z.number().positive(),
  targetCount: z.number().int().nonnegative(),
  dialogues: z.array(ttsPlanDialogueSchema),
  /** 手动调整过、将被保护起始位置的对白数量。 */
  protectedCount: z.number().int().nonnegative(),
  /** 已存在音频、生成后会被替换（新资产）的对白数量。 */
  replacingCount: z.number().int().nonnegative(),
  currentSceneDurationFrames: z.number().int().nonnegative(),
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
