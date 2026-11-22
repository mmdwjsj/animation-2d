import type { FastifyInstance } from 'fastify';
import type { ProjectService } from '../services/projectService';

/** 项目管理 API（架构 12 节）。输入输出由共享 Zod Schema 校验。 */
export function registerProjectRoutes(app: FastifyInstance, service: ProjectService): void {
  app.get('/api/projects', async () => ({ data: service.listProjects() }));

  app.post('/api/projects', async (request, reply) => {
    const project = service.createProject(request.body);
    return reply.code(201).send({ data: project });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) => ({
    data: service.getProject(request.params.id),
  }));

  app.put<{ Params: { id: string } }>('/api/projects/:id', async (request) => ({
    data: service.saveProject(request.params.id, request.body),
  }));

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    service.deleteProject(request.params.id);
    return reply.code(204).send();
  });
}
