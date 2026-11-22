import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  saveScriptRequestSchema,
  scriptDraftSchema,
  type ScriptFile,
} from '@animation/shared';
import { appConfig } from '../config';
import { errors } from '../errors';
import { assertProjectId, resolveProjectDir } from '../utils/projectPaths';
import { atomicWriteJson, atomicWriteRaw } from '../utils/atomicWrite';

/**
 * 剧本文件模块（架构 10、11 节）。
 * 只负责 scripts/original.txt 与 scripts/parsed-draft.json 的读写，
 * 绝不触碰 animation/animation.json——那是用户确认后的导入动作。
 */
export class ScriptService {
  private readonly projectsDir: string;

  constructor(projectsDir: string = appConfig.projectsDir) {
    this.projectsDir = path.resolve(projectsDir);
  }

  getScript(id: string): ScriptFile {
    assertProjectId(id);
    this.assertProjectExists(id);
    const { originalPath, draftPath } = this.paths(id);

    let original = '';
    if (existsSync(originalPath)) {
      try {
        original = readFileSync(originalPath, 'utf8');
      } catch (cause) {
        throw errors.io('原始剧本读取失败。', cause);
      }
    }

    let draft: ScriptFile['draft'];
    if (existsSync(draftPath)) {
      try {
        draft = scriptDraftSchema.parse(
          JSON.parse(readFileSync(draftPath, 'utf8')) as unknown,
        );
      } catch (cause) {
        throw errors.io('解析草稿校验失败，文件可能已损坏。', cause);
      }
    } else {
      // 阶段 1 创建项目时可能没有草稿文件，按空草稿处理，GET 不产生写盘副作用。
      draft = scriptDraftSchema.parse({ scenes: [], errors: [], warnings: [] });
    }

    return { original, draft };
  }

  saveScript(id: string, input: unknown): ScriptFile {
    assertProjectId(id);
    this.assertProjectExists(id);
    const parsed = saveScriptRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation('剧本数据不合法，保存已取消。');
    }
    const { original, draft } = parsed.data;
    const { originalPath, draftPath } = this.paths(id);

    let previousOriginal: string | null;
    try {
      previousOriginal = existsSync(originalPath) ? readFileSync(originalPath, 'utf8') : null;
    } catch (cause) {
      throw errors.io('无法读取当前剧本，保存已取消，原有数据未被修改。', cause);
    }

    // 两个文件必须一致：草稿写失败时回滚原始剧本，避免留下错配的中间状态。
    try {
      atomicWriteRaw(originalPath, original);
      atomicWriteJson(draftPath, draft);
    } catch (cause) {
      try {
        if (previousOriginal === null) rmSync(originalPath, { force: true });
        else atomicWriteRaw(originalPath, previousOriginal);
      } catch (rollbackError) {
        console.error('[animation-video] 剧本保存失败后回滚失败：', rollbackError);
      }
      throw errors.io('写入剧本失败，原有数据未被修改。', cause);
    }

    return { original, draft };
  }

  private assertProjectExists(id: string): void {
    const projectJson = path.join(this.dir(id), 'project.json');
    if (!existsSync(projectJson)) throw errors.notFound('项目不存在或已被删除。');
  }

  private dir(id: string): string {
    return resolveProjectDir(this.projectsDir, id);
  }

  private paths(id: string): { originalPath: string; draftPath: string } {
    const scriptsDir = path.join(this.dir(id), 'scripts');
    return {
      originalPath: path.join(scriptsDir, 'original.txt'),
      draftPath: path.join(scriptsDir, 'parsed-draft.json'),
    };
  }
}
