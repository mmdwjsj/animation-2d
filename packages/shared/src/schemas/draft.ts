import { z } from 'zod';
import { scriptDraftSchema } from './script';
import { stageDataSchema } from './stage';

/**
 * 阶段 5「动画草稿导入」的 API 契约（架构 5.4、11、12 节 / PRD 8）。
 *
 * 数据流：原始剧本文本 → 解析器输出 ScriptDraft → 素材匹配 → 影响对比 →
 * 用户确认 → Draft/Import 层转换为 StageData。
 * 原始剧本、解析草稿与最终动画数据分开保存，确认前不覆盖动画数据。
 */

/** scripts/original.txt + scripts/parsed-draft.json 的读取/保存结构。 */
export const scriptFileSchema = z.object({
  original: z.string().max(200000),
  draft: scriptDraftSchema,
});
export type ScriptFile = z.infer<typeof scriptFileSchema>;

export const saveScriptRequestSchema = scriptFileSchema;
export type SaveScriptRequest = ScriptFile;
export const scriptFileResponseSchema = z.object({ data: scriptFileSchema });

/** POST /api/scripts/parse：只解析，不落盘。 */
export const parseScriptRequestSchema = z.object({
  text: z.string().max(200000),
});
export type ParseScriptRequest = z.infer<typeof parseScriptRequestSchema>;

/** 单个名称到真实素材的匹配结果；未匹配必须显式展示，不得伪装成已绑定。 */
export const draftMatchItemSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  assetId: z.string().min(1).max(80).nullable(),
  assetName: z.string().min(1).max(80).nullable(),
  matched: z.boolean(),
});
export type DraftMatchItem = z.infer<typeof draftMatchItemSchema>;

export const draftMatchSchema = z.object({
  scenes: z.array(draftMatchItemSchema),
  characters: z.array(draftMatchItemSchema),
  /** 待处理事项：未匹配到素材的场景名 / 角色名。 */
  unmatched: z.array(z.string().min(1)),
});
export type DraftMatch = z.infer<typeof draftMatchSchema>;

export const parseScriptResponseSchema = z.object({
  data: z.object({ draft: scriptDraftSchema, match: draftMatchSchema }),
});
export type ParseScriptResponse = z.infer<typeof parseScriptResponseSchema>;

const countsSchema = z.object({
  scenes: z.number().int().nonnegative(),
  characters: z.number().int().nonnegative(),
  dialogues: z.number().int().nonnegative(),
});

/**
 * 创建动画草稿前的影响对比（架构 11 节）。
 * 第一版采用「保留旧数据并确认整体替换」，不做字段级自动合并。
 */
export const draftImpactSchema = z.object({
  hasExistingData: z.boolean(),
  current: countsSchema,
  next: countsSchema,
  unmatched: z.array(z.string().min(1)),
  warning: z.string().nullable(),
});
export type DraftImpact = z.infer<typeof draftImpactSchema>;

export const draftPreviewRequestSchema = z.object({ draft: scriptDraftSchema });
export type DraftPreviewRequest = z.infer<typeof draftPreviewRequestSchema>;

/** confirmed 必须是字面量 true，服务端绝不隐式覆盖用户已编辑的动画数据。 */
export const draftImportRequestSchema = z.object({
  draft: scriptDraftSchema,
  confirmed: z.literal(true),
});
export type DraftImportRequest = z.infer<typeof draftImportRequestSchema>;

export const draftImpactResponseSchema = z.object({ data: draftImpactSchema });
export const draftImportResponseSchema = z.object({ data: stageDataSchema });
