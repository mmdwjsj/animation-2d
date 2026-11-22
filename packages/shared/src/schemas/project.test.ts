import { describe, expect, it } from 'vitest';
import {
  animationDataSchema,
  createProjectRequestSchema,
  projectSchema,
  scriptDraftSchema,
  PROJECT_DEFAULTS,
} from '../index';

const validProject = {
  id: '2c1d9b8e-8a4f-4b2c-9f3a-1e7d5c6b4a90',
  name: '老王和小李',
  version: 1,
  fps: 30,
  width: 1080,
  height: 1920,
  aspectRatio: '9:16',
  sceneIds: [],
  createdAt: '2026-11-22T08:00:00.000Z',
  updatedAt: '2026-11-22T08:00:00.000Z',
};

describe('projectSchema', () => {
  it('接受符合第一版约束的项目', () => {
    expect(projectSchema.parse(validProject)).toEqual(validProject);
  });

  it('拒绝空名称和超长名称', () => {
    expect(() => projectSchema.parse({ ...validProject, name: '' })).toThrow();
    expect(() => projectSchema.parse({ ...validProject, name: '项'.repeat(81) })).toThrow();
  });

  it('拒绝非默认的帧率、分辨率和画面比例', () => {
    expect(() => projectSchema.parse({ ...validProject, fps: 24 })).toThrow();
    expect(() => projectSchema.parse({ ...validProject, width: 1920 })).toThrow();
    expect(() => projectSchema.parse({ ...validProject, aspectRatio: '16:9' })).toThrow();
  });

  it('拒绝非法 id 和时间格式', () => {
    expect(() => projectSchema.parse({ ...validProject, id: 'not-a-uuid' })).toThrow();
    expect(() => projectSchema.parse({ ...validProject, createdAt: '2026/11/22' })).toThrow();
  });
});

describe('createProjectRequestSchema', () => {
  it('去除名称首尾空格并接受中英文标点', () => {
    expect(createProjectRequestSchema.parse({ name: '  第一集：你回来了？  ' }).name).toBe('第一集：你回来了？');
  });

  it('拒绝空白名称和缺少名称', () => {
    expect(() => createProjectRequestSchema.parse({ name: '   ' })).toThrow();
    expect(() => createProjectRequestSchema.parse({})).toThrow();
  });
});

describe('默认项目数据文件', () => {
  it('接受空剧本草稿与空动画数据', () => {
    expect(scriptDraftSchema.parse({ scenes: [], errors: [], warnings: [] })).toEqual({
      scenes: [],
      errors: [],
      warnings: [],
    });
    expect(
      animationDataSchema.parse({ projectId: validProject.id, scenes: [] }),
    ).toEqual({
      projectId: validProject.id,
      version: 0,
      activeSceneId: null,
      scenes: [],
    });
  });

  it('默认值常量与 schema 一致', () => {
    expect(PROJECT_DEFAULTS.fps).toBe(30);
    expect(PROJECT_DEFAULTS.width).toBe(1080);
    expect(PROJECT_DEFAULTS.height).toBe(1920);
  });
});
