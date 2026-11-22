import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { scriptDraftSchema } from '@animation/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import { AppError } from '../errors';
import { ProjectRepository } from '../repositories/projectRepository';
import { ProjectService } from './projectService';
import { ScriptService } from './scriptService';

const roots: string[] = [];
const databases: DatabaseSync[] = [];

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-script-service-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const db = openDatabase(path.join(dataDir, 'workbench.sqlite'));
  databases.push(db);
  const projectsDir = path.join(dataDir, 'projects');
  const project = new ProjectService(new ProjectRepository(db), projectsDir).createProject({
    name: '剧本读写测试',
  });
  return { project, service: new ScriptService(projectsDir), dir: path.join(projectsDir, project.id) };
}

afterEach(() => {
  for (const db of databases) {
    try {
      db.close();
    } catch {
      // 已关闭时忽略
    }
  }
  databases.length = 0;
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响测试结果
    }
  }
  roots.length = 0;
});

const SAMPLE = '# 场景：客厅\n# 角色：老王\n老王：你好';

describe('ScriptService · 原始剧本与解析草稿', () => {
  it('新建项目后读取到空剧本与空草稿', () => {
    const { project, service } = createFixture();
    const file = service.getScript(project.id);
    expect(file.original).toBe('');
    expect(file.draft).toEqual({ scenes: [], errors: [], warnings: [] });
  });

  it('保存落盘两个文件，且绝不修改 animation.json', () => {
    const { project, service, dir } = createFixture();
    const animationPath = path.join(dir, 'animation', 'animation.json');
    const before = readFileSync(animationPath, 'utf8');

    const draft = scriptDraftSchema.parse({ scenes: [], errors: [], warnings: [] });
    const saved = service.saveScript(project.id, { original: SAMPLE, draft });

    expect(saved.original).toBe(SAMPLE);
    expect(readFileSync(path.join(dir, 'scripts', 'original.txt'), 'utf8')).toBe(SAMPLE);
    expect(
      JSON.parse(readFileSync(path.join(dir, 'scripts', 'parsed-draft.json'), 'utf8')),
    ).toEqual(draft);
    expect(readFileSync(animationPath, 'utf8')).toBe(before);
    expect(service.getScript(project.id)).toEqual({ original: SAMPLE, draft });
  });

  it('草稿文件损坏时报错，不静默回退成成功', () => {
    const { project, service, dir } = createFixture();
    const draftPath = path.join(dir, 'scripts', 'parsed-draft.json');
    writeFileSync(draftPath, '{ broken', 'utf8');
    expect(() => service.getScript(project.id)).toThrow(/校验失败/);
  });

  it('非法请求体不写盘、非法/不存在项目被拒绝', () => {
    const { project, service, dir } = createFixture();
    const originalPath = path.join(dir, 'scripts', 'original.txt');
    expect(() => service.saveScript(project.id, { original: 123 })).toThrow(AppError);
    expect(readFileSync(originalPath, 'utf8')).toBe('');
    expect(() => service.getScript('not-a-uuid')).toThrow(AppError);
    expect(() => service.getScript('00000000-0000-4000-8000-000000000099')).toThrow(AppError);
    expect(existsSync(originalPath)).toBe(true);
  });
});
