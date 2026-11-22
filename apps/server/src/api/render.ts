import { readFileSync } from 'node:fs';
import {
  RENDER_SCOPES,
  renderRequestSchema,
  type RenderRequest,
  type RenderScope,
} from '@animation/shared';
import type { FastifyInstance } from 'fastify';
import { errors } from '../errors';
import type { RenderService } from '../render/renderService';

/**
 * 渲染 API（架构 12 节）：创建任务、查询状态、只读校验、下载成品。
 * 输入由共享 Schema 校验；状态与进度均来自真实渲染过程。
 */
export function registerRenderRoutes(app: FastifyInstance, render: RenderService): void {
  /** PRD 14 步骤 1-5 的只读检查，供导出弹窗在开始前展示阻断项与提示项。 */
  app.get<{
    Params: { id: string };
    Querystring: { fps?: string; scope?: string };
  }>('/api/projects/:id/render/validate', async (request) => {
    const rawFps = request.query.fps;
    let fps: number | undefined;
    if (rawFps !== undefined) {
      fps = Number(rawFps);
      if (!Number.isFinite(fps) || fps <= 0) throw errors.validation('帧率参数不合法。');
    }
    const rawScope = request.query.scope;
    let scope: RenderScope | undefined;
    if (rawScope !== undefined) {
      if (!(RENDER_SCOPES as readonly string[]).includes(rawScope)) {
        throw errors.validation('导出范围参数不合法。');
      }
      scope = rawScope as RenderScope;
    }
    return { data: render.validate(request.params.id, fps, scope) };
  });

  app.post('/api/render', async (request) => {
    const parsed = renderRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? '导出参数不合法。');
    }
    return { data: render.createJob(parsed.data as RenderRequest) };
  });

  app.get<{ Params: { id: string } }>('/api/render/:id', async (request) => ({
    data: render.getJob(request.params.id),
  }));

  /** 下载已完成的 MP4；服务端只暴露项目 renders/ 内的真实文件。 */
  app.get<{ Params: { id: string } }>('/api/render/:id/file', async (request, reply) => {
    const { absolutePath, fileName } = render.getJobFile(request.params.id);
    const buffer = readFileSync(absolutePath);
    return reply
      .type('video/mp4')
      .header(
        'Content-Disposition',
        `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      )
      .header('Content-Length', String(buffer.length))
      .header('Cache-Control', 'no-store')
      .send(buffer);
  });
}
