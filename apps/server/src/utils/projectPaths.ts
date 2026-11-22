import path from 'node:path';
import { z } from 'zod';
import { errors } from '../errors';

/** 项目 ID 与路径校验集中一处，供剧本服务复用（不改动既有服务）。 */
export function assertProjectId(id: string): void {
  if (!z.string().uuid().safeParse(id).success) {
    throw errors.validation('项目 ID 格式不正确。');
  }
}

export function resolveProjectDir(projectsDir: string, id: string): string {
  const root = path.resolve(projectsDir);
  const dir = path.resolve(root, id);
  if (!dir.startsWith(root + path.sep)) {
    throw errors.validation('非法的项目路径。');
  }
  return dir;
}
