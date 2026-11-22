import {
  CHARACTER_DEFAULT_WIDTH,
  DRAFT_CHARACTER_ANCHORS,
  DRAFT_TIMING,
  stageDataSchema,
  type Asset,
  type CharacterAsset,
  type CharacterInstance,
  type DialogueEvent,
  type DraftImpact,
  type DraftMatch,
  type DraftMatchItem,
  type ScriptDraft,
  type StageData,
  type StageScene,
} from '@animation/shared';

/**
 * Draft / Import Module 的纯映射层（架构 5.4）。
 *
 * 解析器只输出「剧本写了什么」，本层负责把它变成可编辑的动画数据：
 * 名称 → 真实素材 ID、默认布局锚点、对白事件与估算时长。
 * 不读盘、不写盘、不接触 PixiJS，全部输入显式传入，便于单元测试。
 */

/** 按名称精确匹配素材库；未匹配项显式列出，不伪造占位素材 ID。 */
export function matchDraft(
  draft: ScriptDraft,
  assets: Asset[],
  characters: CharacterAsset[],
): DraftMatch {
  const sceneAssets = assets.filter((asset) => asset.kind === 'scene');

  const scenes: DraftMatchItem[] = draft.scenes.map((scene) => {
    const found = sceneAssets.find((asset) => asset.name === scene.name);
    return {
      id: scene.id,
      name: scene.name,
      assetId: found?.id ?? null,
      assetName: found?.name ?? null,
      matched: found !== undefined,
    };
  });

  const characterItems: DraftMatchItem[] = draft.scenes.flatMap((scene) =>
    scene.characters.map((character) => {
      const found = characters.find((asset) => asset.name === character.name);
      return {
        id: character.id,
        name: character.name,
        assetId: found?.id ?? null,
        assetName: found?.name ?? null,
        matched: found !== undefined,
      };
    }),
  );

  const unmatched = [
    ...scenes
      .filter((item) => !item.matched)
      .map((item) => `场景「${item.name}」未匹配到背景素材`),
    ...characterItems
      .filter((item) => !item.matched)
      .map((item) => `角色「${item.name}」未匹配到人物素材`),
  ];

  return { scenes, characters: characterItems, unmatched };
}

/** 无音频时的对白时长估算：只由文本长度决定，确定性、可重复。 */
export function estimateDialogueFrames(text: string): number {
  const raw = DRAFT_TIMING.baseFrames + text.length * DRAFT_TIMING.framesPerCharacter;
  return Math.min(
    DRAFT_TIMING.maxFrames,
    Math.max(DRAFT_TIMING.minFrames, Math.round(raw)),
  );
}

/** ScriptDraft → StageData。人物位置来自既定布局锚点，不由剧本或解析器猜测。 */
export function buildStageFromDraft(
  projectId: string,
  draft: ScriptDraft,
  match: DraftMatch,
  currentVersion: number,
): StageData {
  const scenes: StageScene[] = draft.scenes.map((scene) => {
    const sceneMatch = match.scenes.find((item) => item.id === scene.id);
    const instances: CharacterInstance[] = [];

    scene.characters.forEach((character, index) => {
      const characterMatch = match.characters.find((item) => item.id === character.id);
      // 未匹配的角色不生成实例，明确列入待处理事项，避免落盘悬空素材引用。
      if (!characterMatch?.assetId) return;
      const anchor =
        DRAFT_CHARACTER_ANCHORS[Math.min(index, DRAFT_CHARACTER_ANCHORS.length - 1)];
      instances.push({
        id: character.id,
        assetId: characterMatch.assetId,
        name: character.name,
        x: anchor.x,
        y: anchor.y,
        width: CHARACTER_DEFAULT_WIDTH,
        posture: character.initialPosture,
        eyeState: 'open',
        mouthState: 'closed',
        visible: true,
        zIndex: instances.length,
      });
    });

    let startFrame = 0;
    const dialogueEvents: DialogueEvent[] = scene.dialogues.map((dialogue) => {
      const durationFrames = estimateDialogueFrames(dialogue.text);
      const event: DialogueEvent = {
        id: dialogue.id,
        characterId: dialogue.characterId,
        text: dialogue.text,
        posture: dialogue.posture,
        startFrame,
        durationFrames,
        sourceLine: dialogue.sourceLine,
      };
      startFrame += durationFrames + DRAFT_TIMING.gapFrames;
      return event;
    });

    return {
      id: scene.id,
      name: scene.name,
      backgroundAssetId: sceneMatch?.assetId ?? null,
      objects: [],
      characters: instances,
      dialogueEvents,
    };
  });

  return stageDataSchema.parse({
    projectId,
    version: currentVersion,
    activeSceneId: scenes[0]?.id ?? null,
    scenes,
  });
}

function counts(stage: StageData): DraftImpact['current'] {
  return {
    scenes: stage.scenes.length,
    characters: stage.scenes.reduce((total, scene) => total + scene.characters.length, 0),
    dialogues: stage.scenes.reduce((total, scene) => total + scene.dialogueEvents.length, 0),
  };
}

/** 重新解析保护：第一版采用「整体替换 + 用户确认」，不做字段级自动合并。 */
export function summarizeImpact(
  current: StageData,
  draft: ScriptDraft,
  match: DraftMatch,
): DraftImpact {
  const hasExistingData = current.scenes.some(
    (scene) =>
      scene.objects.length > 0 ||
      scene.characters.length > 0 ||
      scene.dialogueEvents.length > 0 ||
      scene.backgroundAssetId !== null,
  );

  return {
    hasExistingData,
    current: counts(current),
    next: {
      scenes: draft.scenes.length,
      characters: match.characters.filter((item) => item.matched).length,
      dialogues: draft.scenes.reduce((total, scene) => total + scene.dialogues.length, 0),
    },
    unmatched: match.unmatched,
    warning: hasExistingData
      ? '创建动画草稿会整体替换当前动画数据，已手动调整的人物位置、姿态与道具将丢失，此操作不可撤销。'
      : null,
  };
}
