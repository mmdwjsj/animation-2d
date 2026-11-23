import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src -> apps/server -> apps -> 仓库根
const repoRoot = path.resolve(currentDir, '..', '..', '..');

const dataDir = process.env.ANIMATION_DATA_DIR
  ? path.resolve(process.env.ANIMATION_DATA_DIR)
  : path.join(repoRoot, 'data');

export const appConfig = {
  repoRoot,
  dataDir,
  databasePath: path.join(dataDir, 'workbench.sqlite'),
  projectsDir: path.join(dataDir, 'projects'),
  port: Number(process.env.PORT ?? 4002),
  host: process.env.HOST ?? '127.0.0.1',
  appVersion: '0.1.0',
} as const;
