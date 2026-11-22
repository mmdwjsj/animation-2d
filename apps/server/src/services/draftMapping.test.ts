import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript } from '@animation/script-parser';
import {
  assetIndexSchema,
  characterDescriptorSchema,
  createDefaultStage,
  type Asset,
  type CharacterAsset,
  type StageData,
} from '@animation/shared';
import { describe, expect, it } from 'vitest';
import {
  buildStageFromDraft,
  estimateDialogueFrames,
  matchDraft,
  summarizeImpact,
} from './draftMapping';

const assetsIndexPath = fileURLToPath(
  new URL('../../../../assets/index.json', import.meta.url),
);
const charactersRoot = fileURLToPath(
  new URL('../../../../assets/characters/', import.meta.url),
);

const assets: Asset[] = assetIndexSchema.parse(
  JSON.parse(readFileSync(assetsIndexPath, 'utf8')) as unknown,
).assets;

function loadCharacter(dir: string, id: string, name: string): CharacterAsset {
  const raw = JSON.parse(
    readFileSync(path.join(charactersRoot, dir, 'character.json'), 'utf8'),
  ) as unknown;
  return { id, name, descriptor: characterDescriptorSchema.parse(raw) };
}

const characters: CharacterAsset[] = [
  loadCharacter('old-wang', 'char-old-wang', '老王'),
  loadCharacter('xiao-li', 'char-xiao-li', '小李'),
];

const ACCEPTANCE_SCRIPT = [
  '# 场景：客厅',
  '',
  '# 角色：老王、小李',
  '',
  '老王（坐着）：你回来了？',
  '小李（站着）：我的蛋糕呢？',
  '老王：我不知道啊。',
  '小李：那你嘴角的奶油是什么？',
  '老王（站着）：这是牙膏！',
].join('\n');

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

describe('matchDraft · 名称到真实素材', () => {
  it('标准验收剧本的场景与两个角色全部匹配，无待处理事项', () => {
    const match = matchDraft(parseScript(ACCEPTANCE_SCRIPT), assets, characters);
    expect(match.scenes[0]).toMatchObject({
      name: '客厅',
      assetId: 'scene-living-room',
      matched: true,
    });
    expect(match.characters.map((item) => [item.name, item.assetId, item.matched])).toEqual([
      ['老王', 'char-old-wang', true],
      ['小李', 'char-xiao-li', true],
    ]);
    expect(match.unmatched).toEqual([]);
  });

  it('未匹配的场景与角色显式进入待处理事项，不伪造素材 ID', () => {
    const script = [
      '# 场景：阳台',
      '# 角色：老王、张三',
      '老王：你好',
      '张三：我也好',
    ].join('\n');
    const match = matchDraft(parseScript(script), assets, characters);
    expect(match.scenes[0].matched).toBe(false);
    expect(match.scenes[0].assetId).toBeNull();
    expect(match.characters[1]).toMatchObject({ name: '张三', assetId: null, matched: false });
    expect(match.unmatched).toHaveLength(2);
    expect(match.unmatched[0]).toContain('阳台');
    expect(match.unmatched[1]).toContain('张三');
  });
});

describe('estimateDialogueFrames · 确定性估算', () => {
  it('同样文本得到同样帧数，短句有下限、长句有上限', () => {
    expect(estimateDialogueFrames('好')).toBe(60);
    expect(estimateDialogueFrames('好')).toBe(estimateDialogueFrames('好'));
    expect(estimateDialogueFrames('这是一句比较普通的对白内容')).toBeGreaterThanOrEqual(60);
    expect(estimateDialogueFrames('啊'.repeat(1000))).toBe(300);
  });
});

describe('buildStageFromDraft · 草稿转动画数据', () => {
  it('生成 1 场景、2 人物、5 对白事件，素材与锚点来自既定规则', () => {
    const draft = parseScript(ACCEPTANCE_SCRIPT);
    const stage = buildStageFromDraft(PROJECT_ID, draft, matchDraft(draft, assets, characters), 0);

    expect(stage.scenes).toHaveLength(1);
    const scene = stage.scenes[0];
    expect(scene.backgroundAssetId).toBe('scene-living-room');
    expect(scene.characters.map((item) => [item.id, item.assetId, item.x, item.y, item.posture])).toEqual([
      ['char-1-1', 'char-old-wang', 180, 1650, 'sitting'],
      ['char-1-2', 'char-xiao-li', 440, 1650, 'standing'],
    ]);
    expect(scene.dialogueEvents).toHaveLength(5);
    expect(scene.dialogueEvents.map((event) => event.sourceLine)).toEqual([5, 6, 7, 8, 9]);
    expect(scene.dialogueEvents.map((event) => event.posture)).toEqual([
      'sitting',
      'standing',
      'sitting',
      'standing',
      'standing',
    ]);
    expect(scene.dialogueEvents[0].startFrame).toBe(0);
    for (let index = 1; index < scene.dialogueEvents.length; index += 1) {
      const previous = scene.dialogueEvents[index - 1];
      expect(scene.dialogueEvents[index].startFrame).toBe(
        previous.startFrame + previous.durationFrames + 15,
      );
    }
    expect(stage.activeSceneId).toBe('scene-1');
  });

  it('未匹配角色不生成人物实例，但草稿对白仍完整保留', () => {
    const script = ['# 场景：客厅', '# 角色：老王、张三', '老王：你好', '张三：我也好'].join('\n');
    const draft = parseScript(script);
    const stage = buildStageFromDraft(PROJECT_ID, draft, matchDraft(draft, assets, characters), 3);

    expect(stage.version).toBe(3);
    expect(stage.scenes[0].characters).toHaveLength(1);
    expect(stage.scenes[0].dialogueEvents).toHaveLength(2);
  });
});

describe('summarizeImpact · 重新解析保护', () => {
  it('空项目无既有编辑成果，不显示替换警告', () => {
    const draft = parseScript(ACCEPTANCE_SCRIPT);
    const match = matchDraft(draft, assets, characters);
    const impact = summarizeImpact(createDefaultStage(PROJECT_ID), draft, match);

    expect(impact.hasExistingData).toBe(false);
    expect(impact.warning).toBeNull();
    expect(impact.next).toEqual({ scenes: 1, characters: 2, dialogues: 5 });
  });

  it('已有编辑成果时明确提示整体替换影响', () => {
    const draft = parseScript(ACCEPTANCE_SCRIPT);
    const match = matchDraft(draft, assets, characters);
    const existing: StageData = buildStageFromDraft(PROJECT_ID, draft, match, 1);
    const impact = summarizeImpact(existing, draft, match);

    expect(impact.hasExistingData).toBe(true);
    expect(impact.current).toEqual({ scenes: 1, characters: 2, dialogues: 5 });
    expect(impact.warning).toContain('不可撤销');
  });
});
