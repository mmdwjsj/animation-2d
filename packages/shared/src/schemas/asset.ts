import { z } from 'zod';

/**
 * 素材索引（架构 5.2 / 12 节 /api/assets/*）。
 * 素材库与项目实例分离：项目只保存稳定的 assetId，不复制素材定义。
 */
export const assetKindSchema = z.enum(['scene', 'prop', 'character']);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  scene: '场景',
  prop: '道具',
  character: '人物',
};

/**
 * file 为相对 assets/ 的 POSIX 路径。场景 / 道具为 .svg，
 * 人物为 character.json 描述文件（层文件路径写在描述文件内）。
 * 每段只允许 [a-zA-Z0-9_-]，从根上挡住前导 /、.. 穿越和连续分隔符。
 */
export const assetSchema = z.object({
  id: z.string().min(1).max(80),
  kind: assetKindSchema,
  name: z.string().min(1).max(80),
  file: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:svg|json)$/),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  category: z.string().min(1).max(40),
  /** 素材内归一化锚点。静态素材统一底部中心；阶段 3 人物素材可单独定义。 */
  anchorX: z.number().min(0).max(1).default(0.5),
  anchorY: z.number().min(0).max(1).default(1),
});
export type Asset = z.infer<typeof assetSchema>;

export const assetIndexSchema = z
  .object({
    version: z.number().int().nonnegative(),
    assets: z.array(assetSchema),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const asset of value.assets) {
      if (seen.has(asset.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `素材 ID 重复：${asset.id}`,
        });
      }
      seen.add(asset.id);
    }
  });
export type AssetIndex = z.infer<typeof assetIndexSchema>;

export const assetListResponseSchema = z.object({ data: z.array(assetSchema) });

/** 素材缺失检测的真实结果，来自文件系统扫描。 */
export const assetStatusSchema = z.object({
  total: z.number().int().nonnegative(),
  missing: z.array(z.string()),
});
export type AssetStatus = z.infer<typeof assetStatusSchema>;

export const assetStatusResponseSchema = z.object({ data: assetStatusSchema });
