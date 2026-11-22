import {
  MAX_CHARACTERS_PER_SCENE,
  type DraftImpact,
  type DraftMatch,
  type ScriptDraft,
  type StageData,
} from '@animation/shared';
import { errors } from '../errors';
import type { AssetService } from './assetService';
import { buildStageFromDraft, matchDraft, summarizeImpact } from './draftMapping';
import type { StageService } from './stageService';

/**
 * Draft / Import Module（架构 5.4、11 节）。
 * 纯映射逻辑在 draftMapping.ts；本服务负责组合素材库、当前动画数据与持久化。
 * 关键约束：preview 只读不写；import 必须收到 confirmed=true 才覆盖动画数据。
 */
export class DraftImportService {
  constructor(
    private readonly assets: AssetService,
    private readonly stages: StageService,
  ) {}

  /** 名称 → 真实素材 ID 的匹配结果，供解析结果预览与导入共用同一套规则。 */
  match(draft: ScriptDraft): DraftMatch {
    return matchDraft(draft, this.assets.list(), this.assets.listCharacters());
  }

  /** 只计算影响，不修改任何文件。 */
  preview(projectId: string, draft: ScriptDraft): DraftImpact {
    this.assertImportable(draft);
    const current = this.stages.getStage(projectId);
    return summarizeImpact(current, draft, this.match(draft));
  }

  /** 用户确认后整体替换动画数据；复用 StageService 的素材校验与版本递增。 */
  import(projectId: string, draft: ScriptDraft, confirmed: true): StageData {
    this.assertImportable(draft);
    if (confirmed !== true) {
      throw errors.validation('创建动画草稿前必须确认替换影响。');
    }
    const current = this.stages.getStage(projectId);
    const next = buildStageFromDraft(projectId, draft, this.match(draft), current.version);
    return this.stages.saveStage(projectId, next);
  }

  private assertImportable(draft: ScriptDraft): void {
    if (draft.errors.length > 0) {
      throw errors.scriptParse(
        `剧本仍有 ${draft.errors.length} 处解析错误，请先修正后再创建动画草稿。`,
      );
    }
    if (draft.scenes.length === 0) {
      throw errors.scriptParse('剧本中没有可导入的场景，请先写一个 # 场景： 声明。');
    }
    for (const scene of draft.scenes) {
      if (scene.characters.length > MAX_CHARACTERS_PER_SCENE) {
        throw errors.scriptParse(
          `场景「${scene.name}」角色数量超过 ${MAX_CHARACTERS_PER_SCENE} 个，请先删减。`,
        );
      }
    }
  }
}
