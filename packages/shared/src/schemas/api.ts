import { z } from 'zod';
import { projectSchema } from './project';

/** 架构 13 节统一错误分类，补充项目不存在这一业务错误。 */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'SCRIPT_PARSE_ERROR',
  'ASSET_NOT_FOUND',
  'TTS_FAILED',
  'RENDER_FAILED',
  'PROJECT_IO_ERROR',
  'PROJECT_NOT_FOUND',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
});
export type ApiErrorPayload = z.infer<typeof apiErrorSchema>['error'];

export const projectListResponseSchema = z.object({
  data: z.array(projectSchema),
});
export const projectResponseSchema = z.object({
  data: projectSchema,
});

export const settingsSchema = z.object({
  projectsRoot: z.string(),
  databaseFile: z.string(),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  aspectRatio: z.string(),
  appVersion: z.string(),
  nodeVersion: z.string(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsResponseSchema = z.object({
  data: settingsSchema,
});
