/**
 * 确定性动画状态求值器（架构 5.6 / 7.1 / 7.2，PRD 12）。
 *
 * 这是预览与导出唯一共用的业务逻辑：给定项目数据、场景 ID 和整数帧，
 * 直接算出该帧每个人物的姿态 / 嘴型 / 说话状态与字幕，不依赖上一帧、
 * 不依赖 requestAnimationFrame 调用间隔、不使用随机数、不读时钟与 IO。
 *
 * 包内零依赖：输入用结构化接口描述，shared 的 StageData / StageScene
 * 天然满足这些结构，无需让动画核心反向依赖 shared。
 */
import { mouthStateAtFrame, type EyeState, type MouthState, type Posture } from '../character/transform';
import {
  mouthStateFromEnvelope,
  type MouthSource,
} from './mouthEnvelope';

/** 无对白时场景至少保留的时长，避免空场景时间轴宽度为 0。 */
export const MIN_SCENE_DURATION_FRAMES = 60;
/** 最后一句对白结束后保留的尾部帧数。 */
export const DEFAULT_SCENE_TAIL_FRAMES = 30;

export interface DialogueLike {
  id: string;
  characterId: string;
  text: string;
  posture: Posture;
  startFrame: number;
  durationFrames: number;
  /** 阶段 7：已生成音频的资产 ID，用于查缓存的振幅包络。 */
  audioAssetId?: string;
}

export interface CharacterLike {
  id: string;
  name: string;
  posture: Posture;
  eyeState: EyeState;
  mouthState: MouthState;
  visible: boolean;
}

export interface SceneLike {
  id: string;
  name: string;
  characters: readonly CharacterLike[];
  dialogueEvents: readonly DialogueLike[];
}

export interface AnimationProjectLike {
  scenes: readonly SceneLike[];
}

export interface EvaluatorOptions {
  /** 项目帧率，必须由调用方显式传入（默认 30 FPS 由 PROJECT_DEFAULTS 提供）。 */
  fps: number;
  /** 嘴型循环帧数，默认复用 animation-core 的 MOUTH_CYCLE_FRAMES。 */
  mouthCycleFrames?: number;
  /** 最后一句对白后的尾部帧数。 */
  tailFrames?: number;
  /**
   * 阶段 7：按 audioAssetId 索引的缓存振幅包络。
   * 有包络时说话嘴型由音频驱动，无包络时回退确定性整数帧循环；
   * 两者都不依赖上一帧结果，可任意跳帧。
   */
  audioEnvelopes?: Readonly<Record<string, readonly number[]>>;
}

export interface CharacterFrameState {
  id: string;
  name: string;
  /** 说话时由对白事件驱动，其余时间使用实例静态姿态。 */
  posture: Posture;
  eyeState: EyeState;
  /** 说话时优先用缓存音频包络，否则按整数帧确定性循环；不说话恒闭嘴。 */
  mouthState: MouthState;
  /** 嘴型来源，便于诊断与验证音频驱动是否生效。 */
  mouthSource: MouthSource;
  isSpeaking: boolean;
  activeDialogueId: string | null;
  visible: boolean;
}

export interface SubtitleFrameState {
  text: string;
  characterName: string;
  dialogueId: string;
}

export interface AnimationFrameState {
  frame: number;
  fps: number;
  sceneId: string;
  sceneName: string;
  durationFrames: number;
  characters: CharacterFrameState[];
  activeDialogue: DialogueLike | null;
  subtitle: SubtitleFrameState | null;
}

/** 把任意输入帧归一化为非负整数帧；NaN / Infinity 视为 0。 */
export function normalizeFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.floor(frame));
}

/** 整数帧 → 秒。秒数只用于显示与外部接口，不参与动画状态计算。 */
export function frameToSeconds(frame: number, fps: number): number {
  return normalizeFrame(frame) / fps;
}

/** 秒 → 整数帧（四舍五入）。 */
export function secondsToFrame(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.round(seconds * fps));
}

/** 显示用时间码 mm:ss:ff（ff 为秒内帧序号，两位补零）。 */
export function formatTimecode(frame: number, fps: number): string {
  const total = normalizeFrame(frame);
  const safeFps = Math.max(1, Math.floor(fps));
  const minutes = Math.floor(total / (safeFps * 60));
  const seconds = Math.floor(total / safeFps) % 60;
  const frames = total % safeFps;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/**
 * 半开区间 [startFrame, startFrame + durationFrames) 内的生效对白。
 * 重叠时取 startFrame 最大的（后开始者优先），再按 id 字典序兜底，
 * 保证同一份数据任意跳帧结果一致，不依赖数组遍历顺序的偶然性。
 */
export function activeDialogueAtFrame(
  events: readonly DialogueLike[],
  frame: number,
): DialogueLike | null {
  const at = normalizeFrame(frame);
  let active: DialogueLike | null = null;
  for (const event of events) {
    const start = normalizeFrame(event.startFrame);
    const end = start + Math.max(0, normalizeFrame(event.durationFrames));
    if (at < start || at >= end) continue;
    if (
      active === null ||
      start > normalizeFrame(active.startFrame) ||
      (start === normalizeFrame(active.startFrame) && event.id < active.id)
    ) {
      active = event;
    }
  }
  return active;
}

/** 场景总时长：最后一句对白结束 + 尾部留白，且不小于最小场景时长。 */
export function sceneDurationFrames(
  scene: Pick<SceneLike, 'dialogueEvents'>,
  tailFrames: number = DEFAULT_SCENE_TAIL_FRAMES,
): number {
  const end = scene.dialogueEvents.reduce(
    (max, event) =>
      Math.max(max, normalizeFrame(event.startFrame) + normalizeFrame(event.durationFrames)),
    0,
  );
  return Math.max(MIN_SCENE_DURATION_FRAMES, end + Math.max(0, Math.floor(tailFrames)));
}

/**
 * 计算指定帧的完整动画状态。
 * 找不到场景时返回 null，由调用方决定降级显示，不猜测场景内容。
 */
export function getStateAtFrame(
  project: AnimationProjectLike,
  sceneId: string,
  frame: number,
  options: EvaluatorOptions,
): AnimationFrameState | null {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return null;

  const fps = Math.max(1, Math.floor(options.fps));
  const at = normalizeFrame(frame);
  const activeDialogue = activeDialogueAtFrame(scene.dialogueEvents, at);
  const cycleFrames = options.mouthCycleFrames;
  const tailFrames = options.tailFrames;
  // 音频包络只在「当前生效对白」上查一次，避免每个角色重复判断。
  const activeEnvelope = activeDialogue?.audioAssetId
    ? options.audioEnvelopes?.[activeDialogue.audioAssetId]
    : undefined;
  const useAudioMouth = Boolean(activeEnvelope && activeEnvelope.length > 0);
  const activeStart = activeDialogue ? normalizeFrame(activeDialogue.startFrame) : 0;

  const characters: CharacterFrameState[] = scene.characters.map((character) => {
    const speaking = activeDialogue?.characterId === character.id;
    let mouthState: MouthState;
    let mouthSource: MouthSource;
    if (!speaking) {
      mouthState = 'closed';
      mouthSource = 'silent';
    } else if (useAudioMouth && activeEnvelope) {
      mouthState = mouthStateFromEnvelope(activeEnvelope, at - activeStart);
      mouthSource = 'audio';
    } else {
      mouthState = mouthStateAtFrame(at, true, cycleFrames);
      mouthSource = 'cycle';
    }
    return {
      id: character.id,
      name: character.name,
      posture: speaking && activeDialogue ? activeDialogue.posture : character.posture,
      eyeState: character.eyeState,
      mouthState,
      mouthSource,
      isSpeaking: speaking,
      activeDialogueId: speaking && activeDialogue ? activeDialogue.id : null,
      visible: character.visible,
    };
  });

  const speaker = activeDialogue
    ? scene.characters.find((item) => item.id === activeDialogue.characterId)
    : undefined;

  return {
    frame: at,
    fps,
    sceneId: scene.id,
    sceneName: scene.name,
    durationFrames: sceneDurationFrames(scene, tailFrames),
    characters,
    activeDialogue,
    subtitle: activeDialogue
      ? {
          text: activeDialogue.text,
          characterName: speaker?.name ?? '',
          dialogueId: activeDialogue.id,
        }
      : null,
  };
}
