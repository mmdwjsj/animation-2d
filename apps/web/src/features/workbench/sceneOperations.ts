import type { StageScene } from '@animation/shared';

/**
 * 工作台场景结构操作（纯函数，无 IO、无时钟、无随机数）。
 *
 * 场景 id 由调用方生成后传入，保证「相同输入产生相同结果」；
 * 场景顺序即导出拼接顺序，与服务端 render/sceneSpans.ts 一致。
 * 所有函数都不修改传入数组，返回新数组；无变化或输入非法时返回 null，
 * 由 stageStore 决定是否压入撤销历史。
 */

/** 与 stageSceneSchema.name 的 max(80) 保持一致。 */
export const SCENE_NAME_MAX_LENGTH = 80;
/** 一个项目至少保留一个场景，避免导出得到 0 帧时间轴。 */
export const MIN_SCENES = 1;

export interface SceneListChange {
  scenes: StageScene[];
  activeSceneId: string | null;
}

/** 取未占用的最小「场景 N」，删除中间场景后再新建不会与已有场景重名。 */
export function nextSceneName(scenes: readonly StageScene[]): string {
  const used = new Set(scenes.map((scene) => scene.name.trim()));
  let index = 1;
  while (used.has(`场景 ${index}`)) index += 1;
  return `场景 ${index}`;
}

/** 校验并归一化名称；空串或超长返回 null，绝不写入 Schema 不通过的数据。 */
export function normalizeSceneName(rawName: string): string | null {
  const name = rawName.trim();
  if (!name || name.length > SCENE_NAME_MAX_LENGTH) return null;
  return name;
}

/** 新建一个空场景：无背景、无人物、无道具、无对白。 */
export function createScene(id: string, scenes: readonly StageScene[]): StageScene {
  return {
    id,
    name: nextSceneName(scenes),
    backgroundAssetId: null,
    objects: [],
    characters: [],
    dialogueEvents: [],
  };
}

/** 重命名；名称非法、场景不存在或与当前名称相同都视为无变更。 */
export function renameScene(
  scenes: readonly StageScene[],
  sceneId: string,
  rawName: string,
): StageScene[] | null {
  const name = normalizeSceneName(rawName);
  if (name === null) return null;
  const target = scenes.find((scene) => scene.id === sceneId);
  if (!target || target.name === name) return null;
  return scenes.map((scene) => (scene.id === sceneId ? { ...scene, name } : scene));
}

/**
 * 删除场景并修正 activeSceneId。
 * 删除当前场景（或旧数据中指针已失效）时，指向删除位置的前一个场景，
 * 若删的是第一个则指向新的第一个，与「其余场景自动前移」的视觉一致。
 */
export function removeScene(
  scenes: readonly StageScene[],
  activeSceneId: string | null,
  sceneId: string,
): SceneListChange | null {
  if (scenes.length <= MIN_SCENES) return null;
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return null;

  const remaining = scenes.filter((scene) => scene.id !== sceneId);
  let nextActive = activeSceneId;
  if (activeSceneId === sceneId) {
    // 删除当前场景：停留在新顺序中的前一个场景；删首场景则取新的第一个。
    const fallback = Math.max(0, Math.min(index - 1, remaining.length - 1));
    nextActive = remaining[fallback].id;
  } else if (!remaining.some((scene) => scene.id === activeSceneId)) {
    // 旧数据里 activeSceneId 为 null 或已失效：回退到第一个场景，
    // 与 selectActiveScene 的回退规则保持一致。
    nextActive = remaining[0].id;
  }
  return { scenes: remaining, activeSceneId: nextActive };
}

/** 把场景移动到目标 0 基索引（拖拽落点用）；越界夹到合法范围，无变化返回 null。 */
export function reorderSceneTo(
  scenes: readonly StageScene[],
  sceneId: string,
  targetIndex: number,
): StageScene[] | null {
  const from = scenes.findIndex((scene) => scene.id === sceneId);
  if (from < 0 || !Number.isFinite(targetIndex)) return null;
  const to = Math.max(0, Math.min(scenes.length - 1, Math.trunc(targetIndex)));
  if (from === to) return null;

  const next = scenes.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 相邻移动（前移 / 后移按钮用）。 */
export function shiftScene(
  scenes: readonly StageScene[],
  sceneId: string,
  direction: 'left' | 'right',
): StageScene[] | null {
  const from = scenes.findIndex((scene) => scene.id === sceneId);
  if (from < 0) return null;
  return reorderSceneTo(scenes, sceneId, from + (direction === 'left' ? -1 : 1));
}

/**
 * 复制场景：深拷贝背景、道具、人物、对白与转场配置，插到源场景之后。
 *
 * - 所有实例 id 由 newSceneId 派生，保证纯函数（无随机数 / 时钟）且全局不重名；
 * - 对白的 characterId 重新映射到副本人物，避免引用到原场景人物；
 * - audioAssetId 沿用原音频文件（素材文件不复制、不删除），重新生成配音时会自动更新；
 * - 不修改传入数组；源场景不存在时返回 null。
 */
export function duplicateScene(
  scenes: readonly StageScene[],
  sceneId: string,
  newSceneId: string,
): SceneListChange | null {
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0 || !newSceneId.trim()) return null;
  const source = scenes[index];

  const characterIds = new Map<string, string>();
  const characters = source.characters.map((character, position) => {
    const id = `${newSceneId}-char-${position}`;
    characterIds.set(character.id, id);
    return { ...character, id };
  });
  const objects = source.objects.map((object, position) => ({
    ...object,
    id: `${newSceneId}-obj-${position}`,
  }));
  const dialogueEvents = source.dialogueEvents.map((event, position) => ({
    ...event,
    id: `${newSceneId}-dlg-${position}`,
    characterId: characterIds.get(event.characterId) ?? event.characterId,
  }));

  const copy: StageScene = {
    ...source,
    id: newSceneId,
    name: nextCopyName(scenes, source.name),
    objects,
    characters,
    dialogueEvents,
  };
  const next = scenes.slice();
  next.splice(index + 1, 0, copy);
  return { scenes: next, activeSceneId: newSceneId };
}

/** 「XX 副本」，重名时追加序号；超长时回退到未占用的「场景 N」。 */
function nextCopyName(scenes: readonly StageScene[], sourceName: string): string {
  const used = new Set(scenes.map((scene) => scene.name.trim()));
  const base = `${sourceName.trim()} 副本`;
  if (base.length <= SCENE_NAME_MAX_LENGTH && !used.has(base)) return base;
  if (base.length > SCENE_NAME_MAX_LENGTH) return nextSceneName(scenes);
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = ` ${suffix}`;
    const candidate = `${base.slice(0, SCENE_NAME_MAX_LENGTH - tail.length)}${tail}`;
    if (!used.has(candidate)) return candidate;
  }
  return nextSceneName(scenes);
}
