import {
  characterFrame,
  centerViewport,
  clampObjectPosition,
  fitViewport,
  panViewport,
  zoomAt,
  type Point,
  type Size,
  type Viewport,
} from '@animation/animation-core';
import {
  CHARACTER_DEFAULT_WIDTH,
  DRAFT_TIMING,
  MAX_CHARACTERS_PER_SCENE,
  MAX_HISTORY_ENTRIES,
  MAX_STAGE_OBJECTS,
  PROJECT_DEFAULTS,
  PROJECT_LANGUAGE_LABELS,
  STAGE_VIEWPORT,
  TIMELINE_VIEW,
  dialogueEventSchema,
  normalizeSceneTransition,
  stageDataSchema,
  type Asset,
  type CharacterAsset,
  type CharacterInstance,
  type DialogueEvent,
  type ProjectLanguage,
  type SceneTransition,
  type StageData,
  type StageObject,
  type StageScene,
} from '@animation/shared';
import { create } from 'zustand';
import { assetsApi, charactersApi, getErrorMessage, stageApi } from '../lib/api';
import {
  createScene,
  duplicateScene as duplicateSceneOperation,
  normalizeSceneName,
  removeScene,
  reorderSceneTo,
  shiftScene,
} from '../features/workbench/sceneOperations';

export type StageSaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/** 逻辑画布尺寸：所有位置都以此坐标系保存，不存浏览器像素坐标。 */
export const LOGICAL_SIZE: Size = {
  width: PROJECT_DEFAULTS.width,
  height: PROJECT_DEFAULTS.height,
};

/** 一次可撤销操作的历史快照；stage 为不可变更新产生的旧引用，安全共享。 */
export interface HistorySnapshot {
  stage: StageData;
  label: string;
}

/**
 * 场景编辑弹窗一次提交的字段；未提供的字段保持不变。
 * 名称 / 背景 / 顺序合并为一步历史，避免一次保存产生多条撤销记录。
 */
export interface ScenePatch {
  name?: string;
  backgroundAssetId?: string | null;
  /** 0 基目标位置，即导出拼接顺序。 */
  index?: number;
  /** 进入本场景的转场；null 表示关闭。 */
  transition?: SceneTransition | null;
}

export interface StageState {
  assets: Asset[];
  assetsError: string | null;
  /** 校验通过的人物素材描述（阶段 3）。 */
  characters: CharacterAsset[];
  charactersError: string | null;
  stage: StageData | null;
  loading: boolean;
  loadError: string | null;
  selectedId: string | null;
  viewport: Viewport;
  showSafeArea: boolean;
  saveStatus: StageSaveStatus;
  saveError: string | null;
  /** 角色数超限等需要用户明确看到的提示，绝不静默失败。 */
  limitNotice: string | null;
  /** 阶段 6：撤销 / 重做历史栈与拖动合并批次。 */
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  historyBatch: HistorySnapshot | null;

  load: (projectId: string) => Promise<void>;
  reset: () => void;
  fitTo: (container: Size) => void;
  zoom: (anchor: Point, factor: number) => void;
  pan: (dx: number, dy: number) => void;
  toggleSafeArea: () => void;
  select: (id: string | null) => void;
  /**
   * 工作台场景切换：activeSceneId 是落盘字段，切换会标记未保存并纳入撤销历史。
   * 旧数据中 activeSceneId 为空 / 失效时，点击当前场景只修正指针，不压入历史。
   */
  setActiveScene: (sceneId: string) => void;
  /** 项目默认语言：对白未显式指定时继承，纳入撤销历史并立即落盘。 */
  setLanguage: (language: ProjectLanguage) => void;
  /** 工作台场景管理：结构变更统一走 applyChange，纳入撤销历史。 */
  addScene: () => string | null;
  /** 复制场景（含道具、人物、对白与转场配置），返回新场景 id。 */
  duplicateScene: (sceneId: string) => string | null;
  updateScene: (sceneId: string, patch: ScenePatch) => void;
  deleteScene: (sceneId: string) => void;
  moveScene: (sceneId: string, direction: 'left' | 'right') => void;
  moveSceneTo: (sceneId: string, targetIndex: number) => void;
  addObject: (assetId: string, point?: Point) => void;
  addCharacter: (assetId: string, point?: Point) => void;
  moveObject: (id: string, x: number, y: number) => void;
  moveCharacter: (id: string, x: number, y: number) => void;
  updateObject: (id: string, patch: Partial<StageObject>) => void;
  updateCharacter: (id: string, patch: Partial<CharacterInstance>) => void;
  removeObject: (id: string) => void;
  removeCharacter: (id: string) => void;
  reorderObject: (id: string, direction: 'up' | 'down') => void;
  reorderCharacter: (id: string, direction: 'up' | 'down') => void;
  clearLimitNotice: () => void;
  setBackground: (assetId: string | null) => void;
  /** 阶段 6：对白事件编辑（全部纳入撤销 / 重做）。 */
  updateDialogue: (id: string, patch: Partial<DialogueEvent>) => void;
  insertDialogue: (afterId?: string) => void;
  removeDialogue: (id: string) => void;
  moveDialogue: (id: string, direction: 'up' | 'down') => void;
  autoLayoutDialogues: () => void;
  /** 阶段 6：撤销 / 重做与连续拖动批次合并。 */
  undo: () => void;
  redo: () => void;
  beginBatch: (label: string) => void;
  endBatch: () => void;
  /**
   * 阶段 7：应用服务端已保存的动画数据（配音生成结果）。
   * 服务端已完成落盘，因此状态直接置为 saved，避免多余的一次自动保存；
   * 但仍压入历史，用户可以撤销这次时间轴更新。
   */
  applyServerStage: (stage: StageData, label: string) => void;
  saveNow: () => Promise<void>;
}

const initialState = {
  assets: [] as Asset[],
  assetsError: null as string | null,
  characters: [] as CharacterAsset[],
  charactersError: null as string | null,
  stage: null as StageData | null,
  loading: false,
  loadError: null as string | null,
  selectedId: null as string | null,
  viewport: centerViewport({ width: 800, height: 900 }, LOGICAL_SIZE, 0.25),
  showSafeArea: false,
  saveStatus: 'saved' as StageSaveStatus,
  saveError: null as string | null,
  limitNotice: null as string | null,
  historyPast: [] as HistorySnapshot[],
  historyFuture: [] as HistorySnapshot[],
  historyBatch: null as HistorySnapshot | null,
};

export function selectActiveScene(state: StageState): StageScene | null {
  const stage = state.stage;
  if (!stage || stage.scenes.length === 0) return null;
  return stage.scenes.find((scene) => scene.id === stage.activeSceneId) ?? stage.scenes[0];
}

function mutateScene(stage: StageData, updater: (scene: StageScene) => StageScene): StageData {
  const activeId = stage.activeSceneId ?? stage.scenes[0]?.id;
  return {
    ...stage,
    scenes: stage.scenes.map((scene) => (scene.id === activeId ? updater(scene) : scene)),
  };
}

function withDialogues(stage: StageData, events: DialogueEvent[]): StageData {
  return mutateScene(stage, (scene) => ({ ...scene, dialogueEvents: events }));
}

/** 按数组顺序串排对白时间；保留各自时长，间隔沿用草稿导入规则。 */
function sequentialize(events: readonly DialogueEvent[]): DialogueEvent[] {
  let cursor = 0;
  return events.map((event) => {
    const next: DialogueEvent = { ...event, startFrame: cursor };
    cursor += event.durationFrames + DRAFT_TIMING.gapFrames;
    return next;
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function shallowEqual(a: object, b: object): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return keys.every((key) => Object.is(left[key], right[key]));
}

function sameDialogues(a: readonly DialogueEvent[], b: readonly DialogueEvent[]): boolean {
  return a.length === b.length && a.every((item, index) => shallowEqual(item, b[index]));
}

function sameTransition(
  a: SceneTransition | null | undefined,
  b: SceneTransition | null,
): boolean {
  const left = a ?? null;
  if (left === null || b === null) return left === null && b === null;
  return left.type === b.type && left.durationFrames === b.durationFrames;
}

/**
 * 所有舞台编辑统一走这里提交：压入历史、清空重做栈、标记未保存。
 * batch 期间（人物拖动、事件拖动）不逐次压栈，由 endBatch 合并为一步。
 */
function applyChange(
  state: StageState,
  nextStage: StageData,
  label: string,
): Partial<StageState> {
  if (!state.stage || nextStage === state.stage) return {};
  const dirty = { stage: nextStage, saveStatus: 'dirty' as const, saveError: null };
  if (state.historyBatch) return dirty;
  return {
    ...dirty,
    historyPast: [...state.historyPast, { stage: state.stage, label }].slice(-MAX_HISTORY_ENTRIES),
    historyFuture: [],
  };
}

function anchorOf(assets: Asset[], assetId: string) {
  const asset = assets.find((item) => item.id === assetId);
  return { anchorX: asset?.anchorX ?? 0.5, anchorY: asset?.anchorY ?? 1 };
}

interface LayerEntry {
  kind: 'prop' | 'character';
  id: string;
  zIndex: number;
}

/**
 * 道具与人物共用一条图层序列，zIndex 全局唯一且连续。
 * 阶段 3 引入人物后不能各自从 0 编号，否则「上移一层」会失去意义。
 */
function layerEntries(scene: StageScene): LayerEntry[] {
  return [
    ...scene.objects.map((object) => ({ kind: 'prop' as const, id: object.id, zIndex: object.zIndex })),
    ...scene.characters.map((character) => ({
      kind: 'character' as const,
      id: character.id,
      zIndex: character.zIndex,
    })),
  ];
}

function nextZIndex(scene: StageScene): number {
  return layerEntries(scene).reduce((max, entry) => Math.max(max, entry.zIndex), -1) + 1;
}

/** 按当前 zIndex 重排并重新编号，保证删除后没有空洞。 */
function normalizeLayers(scene: StageScene): StageScene {
  const ordered = layerEntries(scene).slice().sort((a, b) => a.zIndex - b.zIndex);
  const indices = new Map(ordered.map((entry, index) => [`${entry.kind}:${entry.id}`, index]));
  return {
    ...scene,
    objects: scene.objects.map((object) => ({
      ...object,
      zIndex: indices.get(`prop:${object.id}`) ?? object.zIndex,
    })),
    characters: scene.characters.map((character) => ({
      ...character,
      zIndex: indices.get(`character:${character.id}`) ?? character.zIndex,
    })),
  };
}

function reorderLayer(stage: StageData, id: string, direction: 'up' | 'down'): StageData {
  return mutateScene(stage, (scene) => {
    const ordered = layerEntries(scene).slice().sort((a, b) => a.zIndex - b.zIndex);
    const index = ordered.findIndex((entry) => entry.id === id);
    const swapWith = direction === 'up' ? index + 1 : index - 1;
    if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return scene;
    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
    const indices = new Map(ordered.map((entry, layer) => [`${entry.kind}:${entry.id}`, layer]));
    return {
      ...scene,
      objects: scene.objects.map((object) => ({
        ...object,
        zIndex: indices.get(`prop:${object.id}`) ?? object.zIndex,
      })),
      characters: scene.characters.map((character) => ({
        ...character,
        zIndex: indices.get(`character:${character.id}`) ?? character.zIndex,
      })),
    };
  });
}

/** 人物等效包围盒：由 animation-core 按当前姿态锚点推导，不另写一套几何。 */
function characterFrameOf(characters: CharacterAsset[], instance: CharacterInstance) {
  const asset = characters.find((item) => item.id === instance.assetId);
  if (!asset) return null;
  return characterFrame({ x: instance.x, y: instance.y, width: instance.width }, asset.descriptor.postures[instance.posture]);
}

export const useStageStore = create<StageState>((set, get) => ({
  ...initialState,

  load: async (projectId) => {
    set({ ...initialState, loading: true });
    try {
      const [assets, characters, stage] = await Promise.all([
        assetsApi.list(),
        charactersApi.list(),
        stageApi.get(projectId),
      ]);
      set({
        assets,
        assetsError: null,
        characters,
        charactersError: null,
        stage,
        loading: false,
        loadError: null,
        selectedId: null,
        saveStatus: 'saved',
        saveError: null,
        limitNotice: null,
        historyPast: [],
        historyFuture: [],
        historyBatch: null,
      });
    } catch (error) {
      set({ loading: false, loadError: getErrorMessage(error) });
    }
  },

  reset: () => set(initialState),

  fitTo: (container) =>
    set({
      viewport: fitViewport(
        container,
        LOGICAL_SIZE,
        STAGE_VIEWPORT.fitPadding,
        STAGE_VIEWPORT.minScale,
        STAGE_VIEWPORT.maxScale,
      ),
    }),

  zoom: (anchor, factor) =>
    set((state) => ({
      viewport: zoomAt(
        state.viewport,
        factor,
        anchor,
        STAGE_VIEWPORT.minScale,
        STAGE_VIEWPORT.maxScale,
      ),
    })),

  pan: (dx, dy) => set((state) => ({ viewport: panViewport(state.viewport, dx, dy) })),

  toggleSafeArea: () => set((state) => ({ showSafeArea: !state.showSafeArea })),

  select: (id) => set({ selectedId: id }),

  setActiveScene: (sceneId) =>
    set((state) => {
      const stage = state.stage;
      if (!stage) return state;
      const target = stage.scenes.find((scene) => scene.id === sceneId);
      if (!target || stage.activeSceneId === sceneId) return state;

      const nextStage: StageData = { ...stage, activeSceneId: sceneId };
      // 旧项目 animation.json 里 activeSceneId 可能为 null 或指向已删场景，
      // selectActiveScene 会回退到第一个场景：此时点击的正是当前编辑目标，
      // 只修正指针并落盘，不产生一条「切换场景」的撤销记录。
      if (selectActiveScene(state)?.id === sceneId) {
        return { stage: nextStage, saveStatus: 'dirty', saveError: null };
      }
      return {
        ...applyChange(state, nextStage, `切换到「${target.name}」`),
        selectedId: null,
        limitNotice: null,
      };
    }),

  setLanguage: (language) =>
    set((state) => {
      const stage = state.stage;
      if (!stage || stage.language === language) return state;
      const nextStage: StageData = { ...stage, language };
      return applyChange(state, nextStage, `项目语言设为「${PROJECT_LANGUAGE_LABELS[language]}」`);
    }),

  addScene: () => {
    const stage = get().stage;
    if (!stage) return null;
    const id = `scene-${crypto.randomUUID()}`;
    const scene = createScene(id, stage.scenes);
    const nextStage: StageData = {
      ...stage,
      activeSceneId: id,
      scenes: [...stage.scenes, scene],
    };
    set((state) => ({
      ...applyChange(state, nextStage, `新建场景「${scene.name}」`),
      selectedId: null,
      limitNotice: null,
    }));
    return id;
  },

  duplicateScene: (sceneId) => {
    const stage = get().stage;
    if (!stage) return null;
    const id = `scene-${crypto.randomUUID()}`;
    const result = duplicateSceneOperation(stage.scenes, sceneId, id);
    if (!result) return null;
    const nextStage: StageData = { ...stage, ...result };
    // 复制出的实例 id 全部由新 scene id 派生，Schema 兜底保证可安全落盘。
    if (!stageDataSchema.safeParse(nextStage).success) return null;
    const name = nextStage.scenes.find((item) => item.id === id)?.name ?? '副本';
    set((state) => ({
      ...applyChange(state, nextStage, `复制场景「${name}」`),
      selectedId: null,
      limitNotice: null,
    }));
    return id;
  },

  updateScene: (sceneId, patch) =>
    set((state) => {
      const stage = state.stage;
      if (!stage) return state;
      const index = stage.scenes.findIndex((item) => item.id === sceneId);
      if (index < 0) return state;
      const target = stage.scenes[index];

      let scenes: StageScene[] = stage.scenes.slice();
      let changed = false;

      if (patch.name !== undefined) {
        const name = normalizeSceneName(patch.name);
        // 名称不合法时整次编辑拒绝，避免只写入部分字段却让用户以为全部保存成功。
        if (name === null) return state;
        if (name !== target.name) {
          scenes[index] = { ...scenes[index], name };
          changed = true;
        }
      }

      if (patch.backgroundAssetId !== undefined) {
        const assetId = patch.backgroundAssetId;
        if (
          assetId !== null &&
          !state.assets.some((asset) => asset.id === assetId && asset.kind === 'scene')
        ) {
          return state;
        }
        if (assetId !== (target.backgroundAssetId ?? null)) {
          scenes[index] = { ...scenes[index], backgroundAssetId: assetId };
          changed = true;
        }
      }

      if (patch.index !== undefined) {
        const reordered = reorderSceneTo(scenes, sceneId, patch.index);
        if (reordered) {
          scenes = reordered;
          changed = true;
        }
      }

      if (patch.transition !== undefined) {
        const transition =
          patch.transition === null ? null : normalizeSceneTransition(patch.transition);
        // 非法转场配置整次编辑拒绝，避免只写入部分字段却显示成功。
        if (patch.transition !== null && transition === null) return state;
        // 顺序调整可能已经重排数组，必须按 id 重新定位目标场景。
        const targetIndex = scenes.findIndex((item) => item.id === sceneId);
        const current = scenes[targetIndex];
        if (current && !sameTransition(current.transition, transition)) {
          scenes[targetIndex] = { ...current, transition };
          changed = true;
        }
      }

      if (!changed) return state;
      const nextStage: StageData = { ...stage, scenes };
      // 兜底校验：绝不把 Schema 不通过的场景结构交给保存链路。
      if (!stageDataSchema.safeParse(nextStage).success) return state;
      const finalName = nextStage.scenes.find((item) => item.id === sceneId)?.name ?? target.name;
      return applyChange(state, nextStage, `编辑场景「${finalName}」`);
    }),

  deleteScene: (sceneId) =>
    set((state) => {
      const stage = state.stage;
      if (!stage) return state;
      const target = stage.scenes.find((item) => item.id === sceneId);
      if (!target) return state;
      const result = removeScene(stage.scenes, stage.activeSceneId, sceneId);
      if (!result) return state; // 至少保留一个场景，不静默删空项目
      const nextStage: StageData = { ...stage, ...result };
      return {
        ...applyChange(state, nextStage, `删除场景「${target.name}」`),
        selectedId: null,
        limitNotice: null,
      };
    }),

  moveScene: (sceneId, direction) =>
    set((state) => {
      if (!state.stage) return state;
      const scenes = shiftScene(state.stage.scenes, sceneId, direction);
      if (!scenes) return state;
      return applyChange(state, { ...state.stage, scenes }, '调整场景顺序');
    }),

  moveSceneTo: (sceneId, targetIndex) =>
    set((state) => {
      if (!state.stage) return state;
      const scenes = reorderSceneTo(state.stage.scenes, sceneId, targetIndex);
      if (!scenes) return state;
      return applyChange(state, { ...state.stage, scenes }, '调整场景顺序');
    }),

  clearLimitNotice: () => set({ limitNotice: null }),

  addObject: (assetId, point) =>
    set((state) => {
      const asset = state.assets.find((item) => item.id === assetId && item.kind === 'prop');
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!asset || !stage || !scene || scene.objects.length >= MAX_STAGE_OBJECTS) return state;

      const size = { width: asset.width, height: asset.height };
      const preferred = point ?? { x: LOGICAL_SIZE.width / 2, y: LOGICAL_SIZE.height * 0.82 };
      const position = clampObjectPosition(preferred, LOGICAL_SIZE, size, anchorOf(state.assets, assetId));
      const object: StageObject = {
        id: `obj-${crypto.randomUUID()}`,
        assetId: asset.id,
        name: asset.name,
        x: round(position.x),
        y: round(position.y),
        width: asset.width,
        height: asset.height,
        rotation: 0,
        zIndex: nextZIndex(scene),
        visible: true,
      };
      const nextStage = mutateScene(stage, (current) =>
        normalizeLayers({ ...current, objects: [...current.objects, object] }),
      );
      return { ...applyChange(state, nextStage, `添加道具「${asset.name}」`), selectedId: object.id };
    }),

  addCharacter: (assetId, point) =>
    set((state) => {
      const characterAsset = state.characters.find((item) => item.id === assetId);
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!characterAsset || !stage || !scene) return state;
      if (scene.characters.length >= MAX_CHARACTERS_PER_SCENE) {
        return {
          limitNotice: `每个场景最多 ${MAX_CHARACTERS_PER_SCENE} 个角色，请先移除一个已添加的角色。`,
        };
      }

      const frame = characterFrame(
        { x: 0, y: 0, width: CHARACTER_DEFAULT_WIDTH },
        characterAsset.descriptor.postures.standing,
      );
      const preferred = point ?? { x: LOGICAL_SIZE.width / 2, y: LOGICAL_SIZE.height * 0.86 };
      const position = clampObjectPosition(
        preferred,
        LOGICAL_SIZE,
        { width: frame.width, height: frame.height },
        { anchorX: frame.anchorX, anchorY: frame.anchorY },
      );
      const instance: CharacterInstance = {
        id: `char-${crypto.randomUUID()}`,
        assetId,
        name: characterAsset.name,
        x: round(position.x),
        y: round(position.y),
        width: CHARACTER_DEFAULT_WIDTH,
        posture: 'standing',
        eyeState: 'open',
        mouthState: 'closed',
        visible: true,
        zIndex: nextZIndex(scene),
      };
      const nextStage = mutateScene(stage, (current) =>
        normalizeLayers({ ...current, characters: [...current.characters, instance] }),
      );
      return {
        ...applyChange(state, nextStage, `添加人物「${characterAsset.name}」`),
        selectedId: instance.id,
        limitNotice: null,
      };
    }),

  moveObject: (id, x, y) =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      const target = scene?.objects.find((object) => object.id === id);
      if (!stage || !scene || !target) return state;
      const position = clampObjectPosition(
        { x, y },
        LOGICAL_SIZE,
        { width: target.width, height: target.height },
        anchorOf(state.assets, target.assetId),
      );
      const next = { x: round(position.x), y: round(position.y) };
      if (target.x === next.x && target.y === next.y) return state;
      const nextStage = mutateScene(stage, (current) => ({
        ...current,
        objects: current.objects.map((object) =>
          object.id === id ? { ...object, ...next } : object,
        ),
      }));
      return applyChange(state, nextStage, `移动「${target.name}」`);
    }),

  moveCharacter: (id, x, y) =>
    set((state) => {
      const stage = state.stage;
      const target = selectActiveScene(state)?.characters.find((item) => item.id === id);
      if (!stage || !target) return state;
      const frame = characterFrameOf(state.characters, target);
      if (!frame) return state;
      const position = clampObjectPosition(
        { x, y },
        LOGICAL_SIZE,
        { width: frame.width, height: frame.height },
        { anchorX: frame.anchorX, anchorY: frame.anchorY },
      );
      const next = { x: round(position.x), y: round(position.y) };
      if (target.x === next.x && target.y === next.y) return state;
      const nextStage = mutateScene(stage, (current) => ({
        ...current,
        characters: current.characters.map((item) =>
          item.id === id ? { ...item, ...next } : item,
        ),
      }));
      return applyChange(state, nextStage, `移动「${target.name}」`);
    }),

  updateObject: (id, patch) =>
    set((state) => {
      const stage = state.stage;
      const target = selectActiveScene(state)?.objects.find((object) => object.id === id);
      if (!stage || !target) return state;
      const width = patch.width ?? target.width;
      const height = patch.height ?? target.height;
      if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) return state;
      const position = clampObjectPosition(
        { x: patch.x ?? target.x, y: patch.y ?? target.y },
        LOGICAL_SIZE,
        { width, height },
        anchorOf(state.assets, target.assetId),
      );
      const next: StageObject = {
        ...target,
        ...patch,
        name: patch.name?.trim() || target.name,
        x: round(position.x),
        y: round(position.y),
        width,
        height,
      };
      if (shallowEqual(target, next)) return state;
      const nextStage = mutateScene(stage, (current) => ({
        ...current,
        objects: current.objects.map((object) => (object.id === id ? next : object)),
      }));
      return applyChange(state, nextStage, `修改「${target.name}」属性`);
    }),

  updateCharacter: (id, patch) =>
    set((state) => {
      const stage = state.stage;
      const target = selectActiveScene(state)?.characters.find((item) => item.id === id);
      if (!stage || !target) return state;
      const width = patch.width ?? target.width;
      if (width <= 0 || !Number.isFinite(width)) return state;
      const posture = patch.posture ?? target.posture;
      const asset = state.characters.find((item) => item.id === target.assetId);
      if (!asset) return state;
      const frame = characterFrame({ x: 0, y: 0, width }, asset.descriptor.postures[posture]);

      // 姿态 / 嘴型 / 显示等非几何改动严禁改变逻辑锚点（PRD 10.2「不允许人物突然跳动」）。
      const geometryChanged =
        patch.x !== undefined || patch.y !== undefined || patch.width !== undefined;
      const position = geometryChanged
        ? clampObjectPosition(
            { x: patch.x ?? target.x, y: patch.y ?? target.y },
            LOGICAL_SIZE,
            { width: frame.width, height: frame.height },
            { anchorX: frame.anchorX, anchorY: frame.anchorY },
          )
        : { x: target.x, y: target.y };

      const next: CharacterInstance = {
        ...target,
        ...patch,
        name: patch.name?.trim() || target.name,
        x: round(position.x),
        y: round(position.y),
        width,
        posture,
      };
      if (shallowEqual(target, next)) return state;
      const nextStage = mutateScene(stage, (current) => ({
        ...current,
        characters: current.characters.map((item) => (item.id === id ? next : item)),
      }));
      return applyChange(state, nextStage, `修改「${target.name}」属性`);
    }),

  removeObject: (id) =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!stage || !scene || !scene.objects.some((object) => object.id === id)) return state;
      const name = scene.objects.find((object) => object.id === id)?.name ?? '道具';
      const nextStage = mutateScene(stage, (current) =>
        normalizeLayers({ ...current, objects: current.objects.filter((object) => object.id !== id) }),
      );
      return {
        ...applyChange(state, nextStage, `删除「${name}」`),
        selectedId: state.selectedId === id ? null : state.selectedId,
      };
    }),

  removeCharacter: (id) =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!stage || !scene || !scene.characters.some((item) => item.id === id)) return state;
      const name = scene.characters.find((item) => item.id === id)?.name ?? '人物';
      const nextStage = mutateScene(stage, (current) =>
        normalizeLayers({
          ...current,
          characters: current.characters.filter((item) => item.id !== id),
        }),
      );
      return {
        ...applyChange(state, nextStage, `删除「${name}」`),
        selectedId: state.selectedId === id ? null : state.selectedId,
        limitNotice: null,
      };
    }),

  reorderObject: (id, direction) =>
    set((state) => {
      if (!state.stage) return state;
      return applyChange(state, reorderLayer(state.stage, id, direction), '调整图层顺序');
    }),

  reorderCharacter: (id, direction) =>
    set((state) => {
      if (!state.stage) return state;
      return applyChange(state, reorderLayer(state.stage, id, direction), '调整图层顺序');
    }),

  setBackground: (assetId) =>
    set((state) => {
      const stage = state.stage;
      if (!stage) return state;
      if (assetId && !state.assets.some((item) => item.id === assetId && item.kind === 'scene')) {
        return state;
      }
      const nextStage = mutateScene(stage, (current) => ({ ...current, backgroundAssetId: assetId }));
      return applyChange(state, nextStage, '设置场景背景');
    }),

  updateDialogue: (id, patch) =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      const target = scene?.dialogueEvents.find((event) => event.id === id);
      if (!stage || !scene || !target) return state;
      const nextStartFrame =
        patch.startFrame === undefined
          ? target.startFrame
          : Math.max(0, Math.floor(patch.startFrame));
      const nextDurationFrames =
        patch.durationFrames === undefined
          ? target.durationFrames
          : Math.max(TIMELINE_VIEW.minDialogueFrames, Math.floor(patch.durationFrames));
      // 只有时间值真的发生变化才算「用户手动调整」；夹到原值不误触发保护策略。
      const timingChanged =
        nextStartFrame !== target.startFrame || nextDurationFrames !== target.durationFrames;
      const candidate: DialogueEvent = {
        ...target,
        ...patch,
        ...(timingChanged ? { manuallyTimed: true } : {}),
        startFrame: nextStartFrame,
        durationFrames: nextDurationFrames,
      };
      // 用共享 Schema 做运行时校验，空文本 / 非法帧不会静默写入坏数据。
      const parsed = dialogueEventSchema.safeParse(candidate);
      if (!parsed.success || shallowEqual(target, parsed.data)) return state;
      const events = scene.dialogueEvents.map((event) => (event.id === id ? parsed.data : event));
      return applyChange(state, withDialogues(stage, events), '编辑对白');
    }),

  insertDialogue: (afterId) =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!stage || !scene) return state;
      const firstCharacter = scene.characters[0];
      if (!firstCharacter) {
        return { limitNotice: '当前场景没有人物，请先添加人物后再插入对白。' };
      }
      const index = afterId ? scene.dialogueEvents.findIndex((event) => event.id === afterId) : -1;
      const anchor = index >= 0 ? scene.dialogueEvents[index] : undefined;
      const nextEvent: DialogueEvent = {
        id: `dlg-${crypto.randomUUID()}`,
        characterId: anchor?.characterId ?? firstCharacter.id,
        text: '新对白',
        posture: anchor?.posture ?? firstCharacter.posture,
        startFrame: anchor ? anchor.startFrame + anchor.durationFrames + DRAFT_TIMING.gapFrames : 0,
        durationFrames: DRAFT_TIMING.minFrames,
      };
      const events = scene.dialogueEvents.slice();
      events.splice(index >= 0 ? index + 1 : events.length, 0, nextEvent);
      return {
        ...applyChange(state, withDialogues(stage, events), '插入对白'),
        limitNotice: null,
      };
    }),

  removeDialogue: (id) =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!stage || !scene || !scene.dialogueEvents.some((event) => event.id === id)) return state;
      const events = scene.dialogueEvents.filter((event) => event.id !== id);
      return applyChange(state, withDialogues(stage, events), '删除对白');
    }),

  moveDialogue: (id, direction) =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!stage || !scene) return state;
      const events = scene.dialogueEvents.slice();
      const index = events.findIndex((event) => event.id === id);
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || swapWith < 0 || swapWith >= events.length) return state;
      [events[index], events[swapWith]] = [events[swapWith], events[index]];
      // 顺序变化后同步串排时间，避免「显示顺序」与「播放顺序」不一致。
      return applyChange(state, withDialogues(stage, sequentialize(events)), '调整对白顺序');
    }),

  autoLayoutDialogues: () =>
    set((state) => {
      const stage = state.stage;
      const scene = selectActiveScene(state);
      if (!stage || !scene || scene.dialogueEvents.length === 0) return state;
      const laidOut = sequentialize(scene.dialogueEvents.slice().sort((a, b) => a.startFrame - b.startFrame));
      if (sameDialogues(scene.dialogueEvents, laidOut)) return state;
      return applyChange(state, withDialogues(stage, laidOut), '自动排布对白时间');
    }),

  undo: () =>
    set((state) => {
      if (!state.stage || state.historyPast.length === 0) return state;
      const previous = state.historyPast[state.historyPast.length - 1];
      return {
        // version 由服务端递增，撤销不回退版本号，避免与后续保存的版本基线冲突。
        stage: { ...previous.stage, version: state.stage.version },
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [...state.historyFuture, { stage: state.stage, label: previous.label }],
        historyBatch: null,
        saveStatus: 'dirty',
        saveError: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (!state.stage || state.historyFuture.length === 0) return state;
      const next = state.historyFuture[state.historyFuture.length - 1];
      return {
        stage: { ...next.stage, version: state.stage.version },
        historyFuture: state.historyFuture.slice(0, -1),
        historyPast: [...state.historyPast, { stage: state.stage, label: next.label }],
        historyBatch: null,
        saveStatus: 'dirty',
        saveError: null,
      };
    }),

  beginBatch: (label) =>
    set((state) =>
      state.stage && !state.historyBatch
        ? { historyBatch: { stage: state.stage, label } }
        : {},
    ),

  endBatch: () =>
    set((state) => {
      if (!state.historyBatch || !state.stage) return { historyBatch: null };
      const base = state.historyBatch;
      if (base.stage === state.stage) return { historyBatch: null };
      return {
        historyBatch: null,
        historyPast: [...state.historyPast, base].slice(-MAX_HISTORY_ENTRIES),
        historyFuture: [],
      };
    }),

  applyServerStage: (stage, label) =>
    set((state) => {
      if (!state.stage) {
        return { stage, saveStatus: 'saved', saveError: null };
      }
      return {
        stage,
        saveStatus: 'saved',
        saveError: null,
        historyPast: [...state.historyPast, { stage: state.stage, label }].slice(
          -MAX_HISTORY_ENTRIES,
        ),
        historyFuture: [],
        historyBatch: null,
      };
    }),

  saveNow: async () => {
    const snapshot = get();
    if (!snapshot.stage || snapshot.saveStatus === 'saving') return;
    if (snapshot.saveStatus === 'saved') return;
    set({ saveStatus: 'saving', saveError: null });
    try {
      const saved = await stageApi.save(snapshot.stage);
      // 保存期间若又有新改动（dirty），不能覆盖本地新数据，也不显示"已保存"。
      set((state) => {
        if (state.saveStatus !== 'saving') return {};
        return {
          stage: state.stage ? { ...state.stage, version: saved.version } : state.stage,
          saveStatus: 'saved',
          saveError: null,
        };
      });
    } catch (error) {
      set((state) =>
        state.saveStatus === 'saving'
          ? { saveStatus: 'error', saveError: getErrorMessage(error) }
          : {},
      );
    }
  },
}));
