import type { FastifyInstance } from 'fastify';
import type { StageService } from '../services/stageService';

/** 舞台布局读写；输入输出由共享 stageDataSchema 校验。 */
export function registerStageRoutes(app: FastifyInstance, service: StageService): void {
  app.get<{ Params: { id: string } }>('/api/projects/:id/stage', async (request) => ({
    data: service.getStage(request.params.id),
  }));

  app.put<{ Params: { id: string } }>('/api/projects/:id/stage', async (request) => ({
    data: service.saveStage(request.params.id, request.body),
  }));
}
