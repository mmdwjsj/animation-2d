import { z } from 'zod';

/**
 * 阶段 7 TTS 音频资产（架构 9 节 / PRD 13）。
 *
 * 音频文件与元数据存文件系统，不进 SQLite；元数据里保存由 Provider
 * 一次性计算好的「每帧振幅包络」，供 animation-core 驱动嘴型，
 * 绝不在渲染每帧时临时分析音频（架构 7.4）。
 */
export const AUDIO_FORMATS = ['wav'] as const;

/** 相对项目目录的音频文件路径，严格限制在项目内，避免路径穿越。 */
export const audioFilePathSchema = z
  .string()
  .regex(/^audio\/[a-zA-Z0-9_-]+\.wav$/);

/** 每个整数帧一个 0..1 的归一化振幅；缓存数据，长度与音频帧数一致。 */
export const audioEnvelopeSchema = z
  .array(z.number().min(0).max(1))
  .max(100000);

export const audioAssetSchema = z.object({
  id: z.string().min(1).max(80),
  filePath: audioFilePathSchema,
  durationMs: z.number().positive(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  format: z.enum(AUDIO_FORMATS),
  /** 生成该资产的 Provider，业务层只记录 ID，不绑定厂商参数。 */
  providerId: z.string().min(1).max(80),
  voiceId: z.string().min(1).max(80),
  speed: z.number().positive(),
  /** 来源对白 ID，重新生成后引用必须指向新资产，不留下悬空引用。 */
  sourceDialogueId: z.string().min(1).max(80),
  /** 对白文本 + 参数的确定性摘要，用于判断是否真的需要重新生成。 */
  textHash: z.string().min(1).max(80),
  createdAt: z.string().min(1),
  /** superseded 表示已被同一对白的新资产替换；文件保留，不擅自删除用户数据。 */
  status: z.enum(['ready', 'superseded']),
  envelope: audioEnvelopeSchema,
  /** 包络的帧率，必须与 PROJECT_DEFAULTS.fps 一致才能按帧索引。 */
  envelopeFps: z.number().int().positive(),
});
export type AudioAsset = z.infer<typeof audioAssetSchema>;

/** <project>/audio/assets.json 的落盘结构。 */
export const audioAssetFileSchema = z.object({
  version: z.number().int().nonnegative().default(1),
  assets: z.array(audioAssetSchema),
});
export type AudioAssetFile = z.infer<typeof audioAssetFileSchema>;

export const audioAssetListResponseSchema = z.object({
  data: audioAssetFileSchema,
});
