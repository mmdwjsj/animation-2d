import { z } from 'zod';
import { PROJECT_DEFAULTS } from '../constants';

/** 项目名称规则：创建、重命名、保存共用，避免规则漂移。 */
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, '项目名称不能为空')
  .max(80, '项目名称不能超过 80 个字符');

/**
 * 项目元数据（架构 6.1 Project）。
 * 第一版画面比例、分辨率、帧率为固定默认值，因此用 literal 锁定。
 */
export const projectSchema = z.object({
  id: z.string().uuid(),
  name: projectNameSchema,
  version: z.number().int().nonnegative(),
  fps: z.literal(PROJECT_DEFAULTS.fps),
  width: z.literal(PROJECT_DEFAULTS.width),
  height: z.literal(PROJECT_DEFAULTS.height),
  aspectRatio: z.literal(PROJECT_DEFAULTS.aspectRatio),
  sceneIds: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Project = z.infer<typeof projectSchema>;

/** POST /api/projects */
export const createProjectRequestSchema = z.object({
  name: projectNameSchema,
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** PUT /api/projects/:id：保存完整项目元数据 */
export const saveProjectRequestSchema = projectSchema;
export type SaveProjectRequest = Project;

/**
 * parsed-draft.json 的结构就是剧本解析草稿（架构 6.2、10 节）。
 * 阶段 1 曾以 unknown[] 占位；阶段 4 起统一复用 schemas/script.ts 的完整定义，
 * 避免落盘文件结构与解析器输出出现两套校验规则。
 */
export { scriptDraftSchema } from './script';
export type { ScriptDraft as ScriptDraftFile } from './script';

/** 动画数据文件已由 stage.ts 定义，此处保留导出名以兼容阶段 1 的服务端代码。 */
export { stageDataSchema as animationDataSchema } from './stage';
export type { StageData as AnimationDataFile } from './stage';

export const referencesSchema = z.object({
  version: z.number().int().nonnegative(),
  assets: z.array(z.unknown()),
});
export type ReferencesFile = z.infer<typeof referencesSchema>;
