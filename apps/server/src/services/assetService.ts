import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assetIndexSchema,
  characterDescriptorSchema,
  type Asset,
  type AssetKind,
  type CharacterAsset,
  type CharacterDescriptor,
} from '@animation/shared';
import { appConfig } from '../config';
import { errors } from '../errors';

interface CharacterEntry {
  asset: Asset;
  descriptor: CharacterDescriptor;
  /** 相对 assets 根的层文件路径 -> 绝对路径，同时充当访问白名单。 */
  layerPaths: Map<string, string>;
}

/**
 * 素材模块（架构 5.2）：素材索引、分层人物描述、预览与缺失检测。
 * 素材库与项目实例分离，项目只通过稳定 assetId 引用。
 * 本服务只读取仓库内的只读素材库，不管理用户上传素材（后续阶段）。
 */
export class AssetService {
  private readonly root: string;
  private readonly index: Asset[];
  private readonly characters: Map<string, CharacterEntry>;
  private readonly characterIssues: Map<string, string>;

  constructor(root: string = path.join(appConfig.repoRoot, 'assets')) {
    this.root = path.resolve(root);
    const indexPath = path.join(this.root, 'index.json');
    let raw: string;
    try {
      raw = readFileSync(indexPath, 'utf8');
    } catch (cause) {
      throw errors.io('素材索引读取失败，请检查 assets/index.json。', cause);
    }
    let parsed: ReturnType<typeof assetIndexSchema.parse>;
    try {
      parsed = assetIndexSchema.parse(JSON.parse(raw) as unknown);
    } catch (cause) {
      throw errors.io('素材索引校验失败，请检查 assets/index.json。', cause);
    }
    this.index = parsed.assets;
    const loaded = this.loadCharacters();
    this.characters = loaded.entries;
    this.characterIssues = loaded.issues;
  }

  list(kind?: AssetKind): Asset[] {
    return kind ? this.index.filter((asset) => asset.kind === kind) : this.index.slice();
  }

  has(id: string): boolean {
    return this.index.some((asset) => asset.id === id);
  }

  get(id: string): Asset {
    const asset = this.index.find((item) => item.id === id);
    if (!asset) throw errors.assetNotFound('素材不存在或已被移除。');
    return asset;
  }

  /** 返回素材文件二进制；仅允许索引内声明的相对路径，杜绝路径穿越。 */
  readFile(id: string): { asset: Asset; content: Buffer } {
    const asset = this.get(id);
    if (asset.kind === 'character') {
      throw errors.validation('人物素材请通过分层素材接口访问。');
    }
    const filePath = this.resolvePath(asset);
    if (!existsSync(filePath)) {
      throw errors.assetNotFound(`素材「${asset.name}」文件缺失，请检查素材目录。`);
    }
    try {
      return { asset, content: readFileSync(filePath) };
    } catch (cause) {
      throw errors.io(`素材「${asset.name}」读取失败。`, cause);
    }
  }

  /** 人物素材列表：只包含描述文件校验通过的素材（不伪造占位人物）。 */
  listCharacters(): CharacterAsset[] {
    return [...this.characters.values()].map((entry) => ({
      id: entry.asset.id,
      name: entry.asset.name,
      descriptor: entry.descriptor,
    }));
  }

  hasCharacter(id: string): boolean {
    return this.characters.has(id);
  }

  getCharacter(id: string): CharacterAsset {
    const entry = this.characters.get(id);
    if (!entry) {
      const issue = this.characterIssues.get(id);
      throw errors.assetNotFound(
        issue ? `人物素材不可用：${issue}` : '人物素材不存在或描述文件缺失。',
      );
    }
    return { id: entry.asset.id, name: entry.asset.name, descriptor: entry.descriptor };
  }

  /**
   * 人物分层文件。relativePath 为相对人物目录、不带扩展名的路径（如 standing/body）。
   * 必须先在该人物 character.json 声明的层白名单内命中，才允许读取。
   */
  readLayer(characterId: string, relativePath: string): { content: Buffer } {
    const entry = this.characters.get(characterId);
    if (!entry) throw errors.assetNotFound('人物素材不存在或描述文件不可用。');
    const sanitized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const baseDir = path.posix.dirname(entry.asset.file);
    const fullPath = `${baseDir}/${sanitized}.svg`;
    const absolute = entry.layerPaths.get(fullPath);
    if (!absolute) {
      throw errors.assetNotFound('该人物素材未声明此分层文件，已拒绝访问。');
    }
    if (!existsSync(absolute)) {
      throw errors.assetNotFound('分层素材文件缺失，画布中会显示占位图。');
    }
    try {
      return { content: readFileSync(absolute) };
    } catch (cause) {
      throw errors.io('分层素材读取失败。', cause);
    }
  }

  /** 真实缺失检测：结果来自文件系统，不是静态假状态。 */
  checkMissing(): { total: number; missing: string[] } {
    const missing: string[] = [];
    for (const asset of this.index) {
      if (!existsSync(this.resolvePath(asset))) missing.push(asset.id);
      if (asset.kind !== 'character') continue;
      if (this.characterIssues.has(asset.id)) {
        missing.push(`${asset.id}:character.json`);
        continue;
      }
      const entry = this.characters.get(asset.id);
      if (!entry) continue;
      for (const [relative, absolute] of entry.layerPaths) {
        if (!existsSync(absolute)) missing.push(`${asset.id}:${relative}`);
      }
    }
    return { total: this.index.length, missing };
  }

  /** 单个描述文件损坏不影响其他素材加载，但会在缺失检测中如实上报。 */
  private loadCharacters(): {
    entries: Map<string, CharacterEntry>;
    issues: Map<string, string>;
  } {
    const entries = new Map<string, CharacterEntry>();
    const issues = new Map<string, string>();
    for (const asset of this.index.filter((item) => item.kind === 'character')) {
      try {
        const raw = readFileSync(this.resolvePath(asset), 'utf8');
        const descriptor = characterDescriptorSchema.parse(JSON.parse(raw) as unknown);
        if (descriptor.id !== asset.id) {
          throw new Error('描述文件 id 与素材索引 id 不一致。');
        }
        const baseDir = path.posix.dirname(asset.file);
        const layerPaths = new Map<string, string>();
        for (const posture of Object.values(descriptor.postures)) {
          for (const layer of posture.layers) {
            const relative = `${baseDir}/${layer.file}`;
            layerPaths.set(relative, this.resolveRelative(relative));
          }
        }
        entries.set(asset.id, { asset, descriptor, layerPaths });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '描述文件不可用';
        issues.set(asset.id, message);
      }
    }
    return { entries, issues };
  }

  private resolvePath(asset: Asset): string {
    return this.resolveRelative(asset.file);
  }

  private resolveRelative(relative: string): string {
    const segments = relative.split('/');
    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(segment),
      )
    ) {
      throw errors.validation('非法素材路径，已拒绝访问。');
    }
    const resolved = path.resolve(this.root, ...segments);
    if (!resolved.startsWith(this.root + path.sep)) {
      throw errors.validation('非法素材路径，已拒绝访问。');
    }
    return resolved;
  }
}
