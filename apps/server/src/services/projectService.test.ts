import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import { AppError } from '../errors';
import { ProjectRepository } from '../repositories/projectRepository';
import { ProjectService } from './projectService';

const tempRoots: string[] = [];
const openConnections: DatabaseSync[] = [];

function createFixture(): { dataDir: string; service: ProjectService } {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-video-test-'));
  tempRoots.push(root);
  const dataDir = path.join(root, 'data');
  const db = openDatabase(path.join(dataDir, 'workbench.sqlite'));
  openConnections.push(db);
  const service = new ProjectService(new ProjectRepository(db), path.join(dataDir, 'projects'));
  return { dataDir, service };
}

afterEach(() => {
  // Windows 上 SQLite 文件被连接持有会导致删除目录 EBUSY，必须先关闭连接。
  for (const db of openConnections) {
    try {
      db.close();
    } catch {
      // 连接已关闭时忽略
    }
  }
  openConnections.length = 0;
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响测试结果
    }
  }
  tempRoots.length = 0;
});

describe('ProjectService 项目闭环', () => {
  it('创建项目会落盘完整目录与默认数据，并写入索引', () => {
    const { dataDir, service } = createFixture();
    const project = service.createProject({ name: '  老王和小李  ' });

    expect(project.name).toBe('老王和小李');
    expect(project.fps).toBe(30);
    expect(project.sceneIds).toEqual([]);

    const dir = path.join(dataDir, 'projects', project.id);
    expect(existsSync(path.join(dir, 'project.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'scripts', 'original.txt'))).toBe(true);
    expect(existsSync(path.join(dir, 'scripts', 'parsed-draft.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'animation', 'animation.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'references.json'))).toBe(true);

    expect(service.listProjects()).toHaveLength(1);
    expect(service.getProject(project.id).name).toBe('老王和小李');
  });

  it('保存会更新名称与版本，文件与索引保持一致', () => {
    const { dataDir, service } = createFixture();
    const project = service.createProject({ name: '初稿' });
    const saved = service.saveProject(project.id, { ...project, name: '第二稿' });

    expect(saved.name).toBe('第二稿');
    expect(saved.version).toBe(project.version + 1);
    expect(saved.updatedAt >= project.updatedAt).toBe(true);
    expect(service.getProject(project.id).name).toBe('第二稿');

    const raw = JSON.parse(
      readFileSync(path.join(dataDir, 'projects', project.id, 'project.json'), 'utf8'),
    ) as { name: string };
    expect(raw.name).toBe('第二稿');
  });

  it('删除会移除目录与索引，重复删除返回明确错误', () => {
    const { dataDir, service } = createFixture();
    const project = service.createProject({ name: '待删除' });
    const dir = path.join(dataDir, 'projects', project.id);

    service.deleteProject(project.id);
    expect(existsSync(dir)).toBe(false);
    expect(service.listProjects()).toHaveLength(0);

    try {
      service.deleteProject(project.id);
      throw new Error('应当抛出错误');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PROJECT_NOT_FOUND');
    }
  });

  it('非法名称、非法 ID 与 ID 不匹配都会给出可理解错误', () => {
    const { service } = createFixture();
    expect(() => service.createProject({ name: '   ' })).toThrow(/项目名称不能为空/);
    expect(() => service.getProject('not-a-uuid')).toThrow(/项目 ID 格式不正确/);

    const project = service.createProject({ name: 'A' });
    expect(() => service.saveProject(project.id, { ...project, id: randomUUID() })).toThrow(
      /项目 ID 与请求路径不一致/,
    );
  });
});
