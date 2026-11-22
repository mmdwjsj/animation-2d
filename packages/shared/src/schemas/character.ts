import { z } from 'zod';
import { POSTURE_VALUES } from '../constants';

/**
 * 人物素材描述与人物实例（PRD 10 节 / 架构 6.3、7.3）。
 *
 * 素材描述文件 character.json 是运行时与素材文件之间的唯一契约：
 * 每个姿态声明统一画布 size、基准 anchor 和若干「层」。层文件只是相对路径，
 * 因此第一版用 SVG 分层、未来替换为透明 PNG 都不需要改动运行时代码。
 */

/** 第一版嘴型（PRD 10.3）：说话时循环切换，不说话时闭嘴。 */
export const MOUTH_VALUES = ['closed', 'open_small', 'open_large'] as const;
export type MouthState = (typeof MOUTH_VALUES)[number];
export const MOUTH_LABELS: Record<MouthState, string> = {
  closed: '闭嘴',
  open_small: '小张嘴',
  open_large: '大张嘴',
};

/** 眼睛状态（PRD 10.1 可选素材，但描述文件必须两套齐全）。 */
export const EYE_VALUES = ['open', 'closed'] as const;
export type EyeState = (typeof EYE_VALUES)[number];
export const EYE_LABELS: Record<EyeState, string> = {
  open: '睁眼',
  closed: '闭眼',
};

export const CHARACTER_LAYER_ROLES = ['body', 'head', 'eyes', 'mouth'] as const;
export type CharacterLayerRole = (typeof CHARACTER_LAYER_ROLES)[number];
export const CHARACTER_LAYER_ROLE_LABELS: Record<CharacterLayerRole, string> = {
  body: '身体',
  head: '头部',
  eyes: '眼睛',
  mouth: '嘴型',
};

/** 层文件相对人物目录的 POSIX 路径，正则从根上挡住绝对路径与 .. 穿越。 */
const relativeSvgPath = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.svg$/);

/** 层在姿态局部坐标系中的位置与尺寸，单位与姿态 size 一致。 */
export const characterLayerBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
});
export type CharacterLayerBox = z.infer<typeof characterLayerBoxSchema>;

export const characterLayerSchema = z.object({
  role: z.enum(CHARACTER_LAYER_ROLES),
  /** eyes / mouth 的状态变体；body / head 不填。 */
  variant: z.string().min(1).max(24).optional(),
  file: relativeSvgPath,
  box: characterLayerBoxSchema,
  /** 同一姿态内的绘制顺序，从下到上。 */
  zIndex: z.number().int().nonnegative().max(1000),
});
export type CharacterLayer = z.infer<typeof characterLayerSchema>;

const sizeSchema = z.object({
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
});

const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/**
 * 单个姿态的描述。superRefine 强制素材齐全：
 * body / head、睁眼 / 闭眼、三种嘴型缺一不可，避免运行时拿到缺层素材却静默降级。
 */
export const characterPostureSchema = z
  .object({
    size: sizeSchema,
    /** 统一基准锚点：站立为脚底中心，坐姿为接触点，均为姿态局部坐标。 */
    anchor: pointSchema,
    anchorLabel: z.string().min(1).max(40).default('脚底中心'),
    layers: z.array(characterLayerSchema).min(1),
  })
  .superRefine((posture, ctx) => {
    const { size, anchor, layers } = posture;
    if (anchor.x < 0 || anchor.x > size.width || anchor.y < 0 || anchor.y > size.height) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '姿态锚点必须落在素材画布内。' });
    }
    for (const role of ['body', 'head'] as const) {
      if (!layers.some((layer) => layer.role === role)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `姿态缺少 ${role} 层。` });
      }
    }
    for (const variant of EYE_VALUES) {
      if (!layers.some((layer) => layer.role === 'eyes' && layer.variant === variant)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `姿态缺少 eyes/${variant} 层。` });
      }
    }
    for (const variant of MOUTH_VALUES) {
      if (!layers.some((layer) => layer.role === 'mouth' && layer.variant === variant)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `姿态缺少 mouth/${variant} 层。` });
      }
    }
    const seen = new Set<string>();
    for (const layer of layers) {
      const key = `${layer.role}:${layer.variant ?? ''}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `重复的层定义：${key}` });
      }
      seen.add(key);
      const box = layer.box;
      if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > size.width + 0.001 ||
        box.y + box.height > size.height + 0.001
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `层「${layer.file}」超出姿态画布范围。` });
      }
    }
  });
export type CharacterPosture = z.infer<typeof characterPostureSchema>;

/** 人物素材描述文件（assets/characters/<id>/character.json）。 */
export const characterDescriptorSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  version: z.number().int().nonnegative(),
  postures: z.object({
    standing: characterPostureSchema,
    sitting: characterPostureSchema,
  }),
});
export type CharacterDescriptor = z.infer<typeof characterDescriptorSchema>;

/** /api/assets/characters 的响应项：索引元数据 + 完整描述文件。 */
export const characterAssetSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  descriptor: characterDescriptorSchema,
});
export type CharacterAsset = z.infer<typeof characterAssetSchema>;
export const characterListResponseSchema = z.object({ data: z.array(characterAssetSchema) });

/**
 * 舞台中的人物实例（架构 6.3）。
 * 只存显示宽度，高度由姿态 size 比例推导，避免切换站 / 坐后宽高比失真。
 * 嘴型与眼睛状态在阶段 3 由用户预览切换；阶段 7 起由对白与音频驱动。
 */
export const characterInstanceSchema = z.object({
  id: z.string().min(1).max(80),
  assetId: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  /** 逻辑锚点坐标（1080 × 1920），姿态切换时保持不变。 */
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(10000),
  posture: z.enum(POSTURE_VALUES).default('standing'),
  eyeState: z.enum(EYE_VALUES).default('open'),
  mouthState: z.enum(MOUTH_VALUES).default('closed'),
  visible: z.boolean().default(true),
  zIndex: z.number().int().nonnegative().max(10000),
  /** 阶段 7：角色级音色覆盖（不区分语言时的通用值）。 */
  voiceId: z.string().min(1).max(80).optional(),
  /**
   * 角色按语言的音色覆盖：中泰双语项目里同一角色可分别指定音色。
   * 优先级高于通用 voiceId，也高于 Provider 的语言默认音色。
   */
  voiceByLanguage: z
    .object({
      zh: z.string().min(1).max(80).optional(),
      th: z.string().min(1).max(80).optional(),
    })
    .optional(),
  speed: z.number().positive().optional(),
});
export type CharacterInstance = z.infer<typeof characterInstanceSchema>;
