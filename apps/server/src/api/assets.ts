import type { FastifyInstance } from 'fastify';
import type { AssetService } from '../services/assetService';

/** 素材 API（架构 12 节）。列表来自真实索引，文件内容按白名单读取。 */
export function registerAssetRoutes(app: FastifyInstance, assets: AssetService): void {
  app.get('/api/assets', async () => ({ data: assets.list() }));

  app.get('/api/assets/scenes', async () => ({ data: assets.list('scene') }));

  app.get('/api/assets/props', async () => ({ data: assets.list('prop') }));

  /** 阶段 3：返回校验通过的人物描述文件，不是示例数据。 */
  app.get('/api/assets/characters', async () => ({ data: assets.listCharacters() }));

  app.get('/api/assets/status', async () => ({ data: assets.checkMissing() }));

  // URL 带 .svg 后缀，让 PixiJS 的 SVG loader 能按扩展名正确识别纹理。
  app.get<{ Params: { file: string } }>('/api/assets/files/:file', async (request, reply) => {
    const id = request.params.file.replace(/\.svg$/i, '');
    const { content } = assets.readFile(id);
    return reply
      .type('image/svg+xml')
      .header('Cache-Control', 'public, max-age=3600')
      .send(content);
  });

  /**
   * 人物分层文件。路径形如 /api/assets/layers/char-old-wang/standing/body.svg，
   * 只有 character.json 已声明的层才能访问，杜绝任意文件读取。
   */
  app.get<{ Params: { id: string; '*': string } }>(
    '/api/assets/layers/:id/*',
    async (request, reply) => {
      const relative = request.params['*'].replace(/\.svg$/i, '');
      const { content } = assets.readLayer(request.params.id, relative);
      return reply
        .type('image/svg+xml')
        .header('Cache-Control', 'public, max-age=3600')
        .send(content);
    },
  );
}
