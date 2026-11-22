import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_CHARACTERS_PER_SCENE,
  createDefaultStage,
  stageDataSchema,
  type StageData,
} from '@animation/shared';
import { z } from 'zod';
import { appConfig } from '../config';
import { errors } from '../errors';
import { atomicWriteJson } from '../utils/atomicWrite';
import type { AssetService } from './assetService';

/**
 * 舞台布局持久化（架构 10 节 animation/animation.json）。
 * 与 project.json 分开保存：原始剧本、解析草稿、最终动画数据互不覆盖（AGENTS 5.4）。
 * 只负责静态布局的读写与校验，不负责剧本解析或动画状态计算。
 */
export class StageService {
  private readonly projectsDir: string;

  constructor(
    private readonly assets: AssetService,
    projectsDir: string = appConfig.projectsDir,
  ) {
    this.projectsDir = path.resolve(projectsDir);
  }

  getStage(id: string): StageData {
    this.assertId(id);
    this.assertProjectExists(id);
    const filePath = this.stageFilePath(id);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (cause) {
      throw errors.io('动画数据文件缺失或无法读取。', cause);
    }

    let data: StageData;
    try {
      data = stageDataSchema.parse(JSON.parse(raw) as unknown);
    } catch (cause) {
      throw errors.io('动画数据校验失败，文件可能已损坏。', cause);
    }
    if (data.projectId !== id) {
      throw errors.io('动画数据与项目不一致，请检查项目目录。');
    }
    // 阶段 1 落盘的是空 scenes。返回内存中的确定性默认场景，
    // 避免 GET 请求产生写盘副作用；首次保存时才真正落盘。
    if (data.scenes.length === 0) {
      const fallback = createDefaultStage(id);
      return { ...fallback, version: data.version };
    }
    return data;
  }

  saveStage(id: string, input: unknown): StageData {
    this.assertId(id);
    this.assertProjectExists(id);
    const parsed = stageDataSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation('动画数据不合法，保存已取消。');
    }
    if (parsed.data.projectId !== id) {
      throw errors.validation('动画数据项目 ID 与请求路径不一致，保存已取消。');
    }
    this.assertReferences(parsed.data);

    const next = stageDataSchema.parse({
      ...parsed.data,
      version: parsed.data.version + 1,
    });
    const filePath = this.stageFilePath(id);
    try {
      atomicWriteJson(filePath, next);
    } catch (cause) {
      throw errors.io('写入动画数据失败，原有数据未被修改。', cause);
    }
    return next;
  }

  /** 素材引用必须真实存在，且类型与用途匹配，防止落盘悬空引用。 */
  private assertReferences(stage: StageData): void {
    for (const scene of stage.scenes) {
      if (scene.backgroundAssetId) {
        const asset = this.assets.list().find((item) => item.id === scene.backgroundAssetId);
        if (!asset || asset.kind !== 'scene') {
          throw errors.validation(`场景「${scene.name}」引用了不存在或非场景类型的背景素材。`);
        }
      }
      const objectIds = new Set<string>();
      for (const object of scene.objects) {
        if (objectIds.has(object.id)) {
          throw errors.validation(`场景中存在重复的对象 ID：${object.id}`);
        }
        objectIds.add(object.id);
        const asset = this.assets.list().find((item) => item.id === object.assetId);
        if (!asset || asset.kind !== 'prop') {
          throw errors.validation(`对象「${object.name}」引用了不存在或非道具类型的素材。`);
        }
      }

      // 阶段 3：人物引用必须是可用的人物素材，且每场景角色数有硬上限。
      if (scene.characters.length > MAX_CHARACTERS_PER_SCENE) {
        throw errors.validation(
          `场景「${scene.name}」人物数量超过 ${MAX_CHARACTERS_PER_SCENE} 个，保存已取消。`,
        );
      }
      for (const character of scene.characters) {
        if (objectIds.has(character.id)) {
          throw errors.validation(`场景中存在重复的对象 ID：${character.id}`);
        }
        objectIds.add(character.id);
        const asset = this.assets.list().find((item) => item.id === character.assetId);
        if (!asset || asset.kind !== 'character') {
          throw errors.validation(`人物「${character.name}」引用了不存在或非人物类型的素材。`);
        }
        if (!this.assets.hasCharacter(character.assetId)) {
          throw errors.validation(`人物「${character.name}」的素材描述文件不可用，请检查素材库。`);
        }
      }
    }
  }

  private assertId(id: string): void {
    if (!z.string().uuid().safeParse(id).success) {
      throw errors.validation('项目 ID 格式不正确。');
    }
  }

  private assertProjectExists(id: string): void {
    if (!existsSync(path.join(this.projectDir(id), 'project.json'))) {
      throw errors.notFound('项目不存在或已被删除。');
    }
  }

  private projectDir(id: string): string {
    const dir = path.resolve(this.projectsDir, id);
    if (!dir.startsWith(this.projectsDir + path.sep)) {
      throw errors.validation('非法的项目路径。');
    }
    return dir;
  }

  private stageFilePath(id: string): string {
    return path.join(this.projectDir(id), 'animation', 'animation.json');
  }
}
