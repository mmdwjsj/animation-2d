import {
  draftImportRequestSchema,
  draftPreviewRequestSchema,
  parseScriptRequestSchema,
  type ParseScriptResponse,
} from '@animation/shared';
import { parseScript } from '@animation/script-parser';
import type { FastifyInstance } from 'fastify';
import { errors } from '../errors';
import type { DraftImportService } from '../services/draftImportService';
import type { ScriptService } from '../services/scriptService';

/** 剧本解析与草稿导入 API（架构 12 节 / PRD 8）。输入输出由共享 Schema 校验。 */
export function registerScriptRoutes(
  app: FastifyInstance,
  scripts: ScriptService,
  drafts: DraftImportService,
): void {
  /** 纯解析：不落盘、不修改动画数据，附带素材匹配结果供右侧预览。 */
  app.post('/api/scripts/parse', async (request) => {
    const parsed = parseScriptRequestSchema.safeParse(request.body);
    if (!parsed.success) throw errors.validation('剧本内容不合法。');
    const draft = parseScript(parsed.data.text);
    const response: ParseScriptResponse = { data: { draft, match: drafts.match(draft) } };
    return response;
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/script', async (request) => ({
    data: scripts.getScript(request.params.id),
  }));

  /** 保存原始剧本与新草稿；用户确认前绝不覆盖 animation.json。 */
  app.put<{ Params: { id: string } }>('/api/projects/:id/script', async (request) => ({
    data: scripts.saveScript(request.params.id, request.body),
  }));

  /** 影响对比：只读。 */
  app.post<{ Params: { id: string } }>('/api/projects/:id/draft/preview', async (request) => {
    const parsed = draftPreviewRequestSchema.safeParse(request.body);
    if (!parsed.success) throw errors.validation('草稿数据不合法。');
    return { data: drafts.preview(request.params.id, parsed.data.draft) };
  });

  /** 确认导入：confirmed 由 Schema 强制为 true。 */
  app.post<{ Params: { id: string } }>('/api/projects/:id/draft/import', async (request) => {
    const parsed = draftImportRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw errors.validation('创建动画草稿前必须确认替换影响，未确认不会修改动画数据。');
    }
    return {
      data: drafts.import(request.params.id, parsed.data.draft, parsed.data.confirmed),
    };
  });
}
