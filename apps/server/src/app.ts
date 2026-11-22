import path from 'node:path';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerAssetRoutes } from './api/assets';
import { registerProjectRoutes } from './api/projects';
import { registerRenderRoutes } from './api/render';
import { registerScriptRoutes } from './api/scripts';
import { registerSettingsRoutes } from './api/settings';
import { registerStageRoutes } from './api/stage';
import { registerTtsRoutes } from './api/tts';
import { appConfig } from './config';
import { openDatabase } from './db';
import { AppError, errors } from './errors';
import { ProjectRepository } from './repositories/projectRepository';
import { AssetService } from './services/assetService';
import { DraftImportService } from './services/draftImportService';
import { ProjectService } from './services/projectService';
import { ScriptService } from './services/scriptService';
import { StageService } from './services/stageService';
import { LocalToneProvider } from './services/tts/localToneProvider';
import { loadConfiguredTtsProviders } from './services/tts/loadConfiguredProviders';
import { TtsProviderRegistry } from './services/tts/provider';
import { TtsService } from './services/ttsService';
import { RenderService } from './render/renderService';

export interface BuildAppOptions {
  /** 覆盖数据目录与素材目录，供测试使用。 */
  dataDir?: string;
  assetsDir?: string;
  logger?: boolean;
  /** 测试用：覆盖 Remotion 入口与浏览器路径，避免在测试里触发真实渲染。 */
  renderEntryPoint?: string;
  renderBrowserExecutable?: string | null;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const dataDir = options.dataDir ?? appConfig.dataDir;
  const db = openDatabase(path.join(dataDir, 'workbench.sqlite'));
  const repository = new ProjectRepository(db);
  const service = new ProjectService(repository, path.join(dataDir, 'projects'));
  const assetService = new AssetService(options.assetsDir);
  const stageService = new StageService(assetService, path.join(dataDir, 'projects'));
  const scriptService = new ScriptService(path.join(dataDir, 'projects'));
  const draftService = new DraftImportService(assetService, stageService);
  // 阶段 7 / 双语：注册表是唯一扩展点。外部引擎仅由配置显式加载并优先注册，
  // 本地离线音色始终保留为显式可选的最后兜底，不会静默顶替真实引擎。
  const ttsProviders = new TtsProviderRegistry([
    ...loadConfiguredTtsProviders(),
    new LocalToneProvider(),
  ]);
  const ttsService = new TtsService(ttsProviders, stageService, path.join(dataDir, 'projects'));
  // 阶段 8：导出任务元数据存 SQLite，成品 MP4 落项目 renders/。
  const renderService = new RenderService({
    db,
    projectsDir: path.join(dataDir, 'projects'),
    assets: assetService,
    stage: stageService,
    ...(options.renderEntryPoint ? { entryPoint: options.renderEntryPoint } : {}),
    ...(options.renderBrowserExecutable !== undefined
      ? { browserExecutable: options.renderBrowserExecutable }
      : {}),
  });

  const app = Fastify({ logger: options.logger ?? false });
  // 服务关闭时释放 SQLite 连接（Windows 上否则文件会一直被占用）。
  app.addHook('onClose', async () => {
    db.close();
  });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    const appError = toAppError(error);
    // 开发环境记录详细堆栈，界面只返回可理解的信息。
    if (appError.statusCode >= 500) {
      console.error('[animation-video] 服务错误：', error);
    }
    void reply.code(appError.statusCode).send({
      error: { code: appError.code, message: appError.message },
    });
  });

  registerProjectRoutes(app, service);
  registerSettingsRoutes(app);
  registerAssetRoutes(app, assetService);
  registerStageRoutes(app, stageService);
  registerScriptRoutes(app, scriptService, draftService);
  registerTtsRoutes(app, ttsService);
  registerRenderRoutes(app, renderService);
  return app;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return errors.validation(first ? `请求数据不合法：${first.message}` : '请求数据不合法。');
  }
  return errors.io('服务内部错误，请稍后重试。', error);
}
