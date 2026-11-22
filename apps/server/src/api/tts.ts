import {
  ttsGenerateRequestSchema,
  ttsPlanRequestSchema,
  type TtsGenerateRequest,
  type TtsPlanRequest,
} from '@animation/shared';
import type { FastifyInstance } from 'fastify';
import { errors } from '../errors';
import type { TtsService } from '../services/ttsService';

/**
 * TTS / 音频 API（架构 12 节 / PRD 13）。
 * 输入输出全部由共享 Schema 校验；generate 的 confirmed 必须是字面量 true。
 */
export function registerTtsRoutes(app: FastifyInstance, tts: TtsService): void {
  /** 可用引擎与通用参数；厂商专有参数不会出现在响应里。 */
  app.get('/api/tts/providers', async () => ({
    data: { providers: tts.listProviders() },
  }));

  /** 音频资产索引（含缓存振幅包络），供时间轴与嘴型求值使用。 */
  app.get<{ Params: { id: string } }>('/api/projects/:id/audio', async (request) => ({
    data: tts.listAudio(request.params.id),
  }));

  /** 试听：只提供 assets.json 中登记过的 wav，禁用缓存避免重生成后播到旧音频。 */
  app.get<{ Params: { id: string; assetId: string } }>(
    '/api/projects/:id/audio/:assetId',
    async (request, reply) => {
      const { buffer } = tts.readAudio(request.params.id, request.params.assetId);
      return reply
        .type('audio/wav')
        .header('Cache-Control', 'no-store')
        .header('Content-Length', String(buffer.length))
        .send(buffer);
    },
  );

  /** 只读影响预览：不生成音频、不写盘、不改动动画数据。 */
  app.post<{ Params: { id: string } }>(
    '/api/projects/:id/tts/plan',
    async (request) => ({ data: tts.plan(request.params.id, parsePlan(request.body, request.params.id)) }),
  );

  /** 生成配音并回写真实时长；未确认时 Schema 直接拒绝，绝不隐式覆盖。 */
  app.post('/api/tts/generate', async (request) => {
    const parsed = parseGenerate(request.body);
    return { data: await tts.generate(parsed.projectId, parsed) };
  });
}

/** projectId 以路由参数为准，防止 body 与路径不一致造成跨项目写入。 */
function parsePlan(body: unknown, projectId: string): TtsPlanRequest {
  const merged =
    body && typeof body === 'object' ? { ...(body as Record<string, unknown>), projectId } : { projectId };
  const parsed = ttsPlanRequestSchema.safeParse(merged);
  if (!parsed.success) {
    throw errors.validation(parsed.error.issues[0]?.message ?? '配音参数不合法。');
  }
  return parsed.data;
}

function parseGenerate(body: unknown): TtsGenerateRequest {
  const parsed = ttsGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'confirmed') {
      throw errors.validation('生成配音前必须确认时间轴更新影响，未确认不会修改动画数据。');
    }
    throw errors.validation(issue?.message ?? '配音生成请求不合法。');
  }
  return parsed.data;
}
