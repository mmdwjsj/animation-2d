import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  animationDataSchema,
  createProjectRequestSchema,
  PROJECT_DEFAULTS,
  projectSchema,
  referencesSchema,
  scriptDraftSchema,
  type Project,
} from '@animation/shared';
import { z } from 'zod';
import { appConfig } from '../config';
import { AppError, errors } from '../errors';
import type { ProjectRepository, ProjectRow } from '../repositories/projectRepository';
import { atomicWriteJson, atomicWriteRaw } from '../utils/atomicWrite';

/**
 * 项目模块（架构 5.1）：创建、打开、保存、删除。
 * 不负责剧本解析、动画状态计算或视频编码。
 */
export class ProjectService {
  private readonly projectsDir: string;

  constructor(
    private readonly repository: ProjectRepository,
    projectsDir: string = appConfig.projectsDir,
  ) {
    this.projectsDir = path.resolve(projectsDir);
  }

  listProjects(): Project[] {
    return this.repository.list().map((row) => this.readProjectFile(row));
  }

  getProject(id: string): Project {
    this.assertId(id);
    const row = this.repository.findById(id);
    if (!row) throw errors.notFound('项目不存在或已被删除。');
    return this.readProjectFile(row);
  }

  createProject(input: unknown): Project {
    const parsed = createProjectRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? '项目名称不合法。');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const project = projectSchema.parse({
      id,
      name: parsed.data.name,
      version: PROJECT_DEFAULTS.version,
      fps: PROJECT_DEFAULTS.fps,
      width: PROJECT_DEFAULTS.width,
      height: PROJECT_DEFAULTS.height,
      aspectRatio: PROJECT_DEFAULTS.aspectRatio,
      sceneIds: [],
      createdAt: now,
      updatedAt: now,
    });

    const projectDir = this.projectDir(id);
    if (existsSync(projectDir)) {
      throw errors.io('项目目录已存在，为避免覆盖数据已取消创建，请重试。');
    }

    let indexInserted = false;
    try {
      for (const dir of ['scripts', 'animation', 'audio', 'renders']) {
        mkdirSync(path.join(projectDir, dir), { recursive: true });
      }

      atomicWriteJson(path.join(projectDir, 'project.json'), project);
      writeFileSync(path.join(projectDir, 'scripts', 'original.txt'), '', 'utf8');
      atomicWriteJson(
        path.join(projectDir, 'scripts', 'parsed-draft.json'),
        scriptDraftSchema.parse({ scenes: [], errors: [], warnings: [] }),
      );
      atomicWriteJson(
        path.join(projectDir, 'animation', 'animation.json'),
        animationDataSchema.parse({ projectId: id, scenes: [] }),
      );
      atomicWriteJson(
        path.join(projectDir, 'references.json'),
        referencesSchema.parse({ version: 1, assets: [] }),
      );

      this.repository.insert({
        id,
        name: project.name,
        path: path.relative(appConfig.repoRoot, projectDir).split(path.sep).join('/'),
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      });
      indexInserted = true;
    } catch (cause) {
      if (indexInserted) {
        try {
          this.repository.remove(id);
        } catch (rollbackError) {
          console.error('[animation-video] 创建失败后回滚索引失败：', rollbackError);
        }
      }
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('[animation-video] 创建失败后清理半成品目录失败：', cleanupError);
      }
      if (cause instanceof AppError) throw cause;
      throw errors.io('创建项目失败，未保留半成品目录，请重试。', cause);
    }

    return project;
  }

  saveProject(id: string, input: unknown): Project {
    this.assertId(id);
    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation('项目数据不合法，保存已取消。');
    }
    const incoming = parsed.data;
    if (incoming.id !== id) {
      throw errors.validation('项目 ID 与请求路径不一致，保存已取消。');
    }

    const row = this.repository.findById(id);
    if (!row) throw errors.notFound('项目不存在或已被删除。');

    const filePath = this.projectFilePath(id);
    let previousRaw: string;
    try {
      previousRaw = readFileSync(filePath, 'utf8');
    } catch (cause) {
      throw errors.io('无法读取当前项目数据，保存已取消，原有数据未被修改。', cause);
    }

    const next = projectSchema.parse({
      ...incoming,
      name: incoming.name.trim(),
      version: incoming.version + 1,
      updatedAt: new Date().toISOString(),
    });

    try {
      atomicWriteJson(filePath, next);
    } catch (cause) {
      throw errors.io('写入项目数据失败，原有数据未被修改。', cause);
    }

    try {
      this.repository.update(id, next.name, next.updatedAt);
    } catch (cause) {
      try {
        atomicWriteRaw(filePath, previousRaw);
      } catch (rollbackError) {
        console.error('[animation-video] 索引更新失败后回滚项目文件失败：', rollbackError);
      }
      throw errors.io('更新项目索引失败，项目文件已回滚，请重试。', cause);
    }

    return next;
  }

  deleteProject(id: string): void {
    this.assertId(id);
    if (!this.repository.findById(id)) throw errors.notFound('项目不存在或已被删除。');

    // 先删目录再删索引：目录删除失败时项目数据与索引都保持原样，
    // 不会出现「索引没了但文件还在」的半删除状态。
    const projectDir = this.projectDir(id);
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch (cause) {
      throw errors.io('删除项目目录失败，项目数据未改动，请重试。', cause);
    }
    // 目录删除成功后，一次性清理索引与关联的渲染任务元数据。
    this.repository.remove(id);
  }

  private readProjectFile(row: ProjectRow): Project {
    const filePath = this.projectFilePath(row.id);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (cause) {
      throw errors.io('项目数据文件缺失或无法读取，请检查项目目录。', cause);
    }

    let project: Project;
    try {
      project = projectSchema.parse(JSON.parse(raw) as unknown);
    } catch (cause) {
      throw errors.io('项目数据校验失败，文件可能已损坏。', cause);
    }
    if (project.id !== row.id) {
      throw errors.io('项目数据与索引不一致，请检查项目目录。');
    }
    return project;
  }

  private assertId(id: string): void {
    if (!z.string().uuid().safeParse(id).success) {
      throw errors.validation('项目 ID 格式不正确。');
    }
  }

  private projectDir(id: string): string {
    const dir = path.resolve(this.projectsDir, id);
    if (!dir.startsWith(this.projectsDir + path.sep)) {
      throw errors.validation('非法的项目路径。');
    }
    return dir;
  }

  private projectFilePath(id: string): string {
    return path.join(this.projectDir(id), 'project.json');
  }
}
