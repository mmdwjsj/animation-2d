import { z } from 'zod';
import { PROJECT_DEFAULTS } from '../constants';

/**
 * 阶段 8 视频导出契约（PRD 14 / 架构 5.8、10、13）。
 *
 * 核心原则：任务状态必须反映真实阶段与真实进度。
 * - `progress` 只在 Remotion `onProgress` 给出真实值时有值；准备/音频合成阶段为 null，
 *   UI 显示「进行中」而不是伪造百分比。
 * - 阶段严格按 PRD 14：准备中 → 渲染中 → 音频合成中 → 完成 / 失败。
 */

/** 分辨率预设。逻辑坐标恒为 1080 × 1920，渲染时按 scale 缩放。 */
export const RENDER_RESOLUTIONS = [
  { id: '1080x1920', width: 1080, height: 1920, label: '1080 × 1920（原画质）' },
  { id: '720x1280', width: 720, height: 1280, label: '720 × 1280' },
  { id: '540x960', width: 540, height: 960, label: '540 × 960（快速预览）' },
] as const;
export type RenderResolutionId = (typeof RENDER_RESOLUTIONS)[number]['id'];

export const RENDER_FPS_OPTIONS = [24, 30, 60] as const;

/**
 * 导出范围。`all` 按 stage.scenes 顺序自动拼接全部场景；
 * `active` 只导出工作台当前场景（保留阶段 8 第一版行为）。
 * 单场景项目下两者等价。
 */
export const RENDER_SCOPES = ['all', 'active'] as const;
export type RenderScope = (typeof RENDER_SCOPES)[number];
export const RENDER_SCOPE_LABELS: Record<RenderScope, string> = {
  all: '全部场景（按顺序拼接）',
  active: '仅当前场景',
};

/** H.264 CRF 与编码预设（真实作用于 Remotion renderMedia）。 */
export const RENDER_QUALITIES = [
  { id: 'draft', label: '草稿（最快）', crf: 28 },
  { id: 'standard', label: '标准', crf: 23 },
  { id: 'high', label: '高画质', crf: 18 },
] as const;
export type RenderQualityId = (typeof RENDER_QUALITIES)[number]['id'];

/** 文件名：只允许安全字符，禁止路径分隔符与遍历。 */
export const renderFileNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, '文件名只能包含中英文、数字、下划线和连字符。');

/** 输出目录固定为项目内 renders/ 的子目录，不暴露也不接受系统绝对路径。 */
export const renderOutputDirSchema = z
  .string()
  .max(60)
  .regex(/^renders(?:\/[a-zA-Z0-9_\-\u4e00-\u9fa5]+)*$/, '输出目录必须位于项目 renders/ 内。')
  .default('renders');

export const renderConfigSchema = z.object({
  fileName: renderFileNameSchema.default('animation'),
  resolution: z.enum(RENDER_RESOLUTIONS.map((item) => item.id) as [RenderResolutionId, ...RenderResolutionId[]]),
  fps: z
    .number()
    .int()
    .refine((value): value is (typeof RENDER_FPS_OPTIONS)[number] =>
      (RENDER_FPS_OPTIONS as readonly number[]).includes(value),
    '帧率只支持 24 / 30 / 60。'),
  quality: z.enum(RENDER_QUALITIES.map((item) => item.id) as [RenderQualityId, ...RenderQualityId[]]),
  outputDir: renderOutputDirSchema,
  scope: z.enum(RENDER_SCOPES).default('all'),
});
export type RenderConfig = z.infer<typeof renderConfigSchema>;

export const DEFAULT_RENDER_CONFIG: RenderConfig = renderConfigSchema.parse({
  fileName: 'animation',
  resolution: '1080x1920',
  fps: PROJECT_DEFAULTS.fps,
  quality: 'standard',
  outputDir: 'renders',
  scope: 'all',
});

/** PRD 14 导出步骤 1-5 的校验项。 */
export const RENDER_CHECK_IDS = [
  'project',
  'assets',
  'dialogues',
  'audio',
  'timeline',
] as const;
export type RenderCheckId = (typeof RENDER_CHECK_IDS)[number];

export const renderCheckSchema = z.object({
  id: z.enum(RENDER_CHECK_IDS),
  label: z.string(),
  ok: z.boolean(),
  /** 阻断级问题为 false；缺失音频属提示级，不阻断无声导出。 */
  blocking: z.boolean(),
  detail: z.string(),
});
export type RenderCheck = z.infer<typeof renderCheckSchema>;

/**
 * 多场景自动拼接的时间轴片段。
 * 坐标是「全局项目逻辑帧」（30 FPS 基准），endFrame 为不含上界。
 * 场景之间无缝衔接：下一个 startFrame 等于上一个 endFrame。
 */
export const renderSceneSpanSchema = z.object({
  sceneId: z.string().min(1),
  sceneName: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  endFrame: z.number().int().positive(),
});
export type RenderSceneSpan = z.infer<typeof renderSceneSpanSchema>;

/**
 * 导出时生效的场景间转场明细（只读校验结果，供导出弹窗展示）。
 * 只有导出范围内相邻的两个场景之间才会应用；按目标场景的「进入转场」配置。
 */
export const renderTransitionSchema = z.object({
  fromSceneName: z.string().min(1),
  toSceneName: z.string().min(1),
  /** 项目逻辑帧，转场不额外占用时间轴。 */
  durationFrames: z.number().int().positive(),
  /** 按导出帧率换算后的帧数，仅供界面展示。 */
  exportFrames: z.number().int().positive(),
});
export type RenderTransition = z.infer<typeof renderTransitionSchema>;

export const renderValidationSchema = z.object({
  projectId: z.string().uuid(),
  /** 首个导出场景；多场景拼接时仍保留，供兼容与界面显示。 */
  sceneId: z.string().nullable(),
  /** 本次导出范围。 */
  scope: z.enum(RENDER_SCOPES),
  /** 本次参与导出的场景数。 */
  sceneCount: z.number().int().nonnegative(),
  /** 按导出顺序排列的场景时间轴，供界面展示拼接明细。 */
  sceneSpans: z.array(renderSceneSpanSchema),
  /** 本次导出实际生效的场景间转场（无转场时为空数组）。 */
  sceneTransitions: z.array(renderTransitionSchema).default([]),
  checks: z.array(renderCheckSchema),
  canRender: z.boolean(),
  totalFrames: z.number().int().nonnegative(),
  /** 项目逻辑帧（30 FPS 基准），未做导出帧率重采样；多场景下为各场景时长之和。 */
  projectDurationFrames: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type RenderValidation = z.infer<typeof renderValidationSchema>;

export const RENDER_JOB_STAGES = [
  'preparing',
  'rendering',
  'muxing',
  'completed',
  'failed',
] as const;
export type RenderJobStage = (typeof RENDER_JOB_STAGES)[number];

export const RENDER_STAGE_LABELS: Record<RenderJobStage, string> = {
  preparing: '准备中',
  rendering: '渲染中',
  muxing: '音频合成中',
  completed: '完成',
  failed: '失败',
};

export const renderJobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const renderJobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  stage: z.enum(RENDER_JOB_STAGES),
  /** 0..1 的真实进度；无真实数据来源时为 null，绝不伪造。 */
  progress: z.number().min(0).max(1).nullable(),
  /** Remotion 真实已渲染帧数 / 总帧数；准备阶段为 0。 */
  framesRendered: z.number().int().nonnegative(),
  totalFrames: z.number().int().nonnegative(),
  message: z.string(),
  config: renderConfigSchema,
  /** 相对项目根目录的输出文件，如 renders/animation.mp4。 */
  outputFile: z.string().nullable(),
  error: renderJobErrorSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RenderJob = z.infer<typeof renderJobSchema>;

export const renderRequestSchema = z.object({
  projectId: z.string().uuid(),
  config: renderConfigSchema,
});
export type RenderRequest = z.infer<typeof renderRequestSchema>;

export const renderJobResponseSchema = z.object({ data: renderJobSchema });
export const renderValidationResponseSchema = z.object({ data: renderValidationSchema });

/** 按导出帧率把项目逻辑帧重采样为视频帧。 */
export function resampleFrames(projectFrames: number, exportFps: number): number {
  const safe = Math.max(1, Math.floor(exportFps));
  return Math.max(1, Math.ceil((Math.max(0, projectFrames) * safe) / PROJECT_DEFAULTS.fps));
}

/** 视频帧 → 项目逻辑帧（与 composition 内映射一致，供测试与音频定位复用）。 */
export function videoFrameToProjectFrame(videoFrame: number, exportFps: number): number {
  const safe = Math.max(1, Math.floor(exportFps));
  return Math.max(0, Math.floor((videoFrame * PROJECT_DEFAULTS.fps) / safe));
}

export function resolutionById(id: RenderResolutionId): (typeof RENDER_RESOLUTIONS)[number] {
  return RENDER_RESOLUTIONS.find((item) => item.id === id) ?? RENDER_RESOLUTIONS[0];
}

export function qualityById(id: RenderQualityId): (typeof RENDER_QUALITIES)[number] {
  return RENDER_QUALITIES.find((item) => item.id === id) ?? RENDER_QUALITIES[1];
}
