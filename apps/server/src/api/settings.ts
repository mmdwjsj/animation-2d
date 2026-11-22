import type { FastifyInstance } from 'fastify';
import {
  DATABASE_FILE_DISPLAY,
  PROJECTS_ROOT_DISPLAY,
  PROJECT_DEFAULTS,
} from '@animation/shared';
import { appConfig } from '../config';

/** 只返回可展示的相对路径与固定配置，不暴露系统绝对路径。 */
export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/settings', async () => ({
    data: {
      projectsRoot: PROJECTS_ROOT_DISPLAY,
      databaseFile: DATABASE_FILE_DISPLAY,
      fps: PROJECT_DEFAULTS.fps,
      width: PROJECT_DEFAULTS.width,
      height: PROJECT_DEFAULTS.height,
      aspectRatio: PROJECT_DEFAULTS.aspectRatio,
      appVersion: appConfig.appVersion,
      nodeVersion: process.version,
    },
  }));
}
