/**
 * 第一版全局约束常量。
 * 集中定义，避免 UI、服务端与后续动画核心各写一份。
 */
export const PROJECT_DEFAULTS = {
  version: 1,
  fps: 30,
  width: 1080,
  height: 1920,
  aspectRatio: '9:16',
} as const;

export const MAX_CHARACTERS_PER_SCENE = 4;

export const POSTURE_VALUES = ['standing', 'sitting'] as const;
export type Posture = (typeof POSTURE_VALUES)[number];

export const POSTURE_LABELS: Record<Posture, string> = {
  standing: '站着',
  sitting: '坐着',
};

/** 展示给用户的相对路径，不暴露系统绝对路径。 */
export const PROJECTS_ROOT_DISPLAY = 'data/projects';
export const DATABASE_FILE_DISPLAY = 'data/workbench.sqlite';
export const AUTOSAVE_DELAY_MS = 2000;

/** 阶段 2 画布视口约束（animation-core 会接收这些值，自身保持零依赖）。 */
export const STAGE_VIEWPORT = {
  minScale: 0.05,
  maxScale: 2,
  fitPadding: 32,
  zoomStep: 1.2,
  safeAreaRatio: 0.05,
} as const;

/** 单场景可放置的静态对象上限，防止误操作撑爆项目文件。 */
export const MAX_STAGE_OBJECTS = 40;

/** 新增人物时的默认显示宽度（1080 × 1920 逻辑坐标）。 */
export const CHARACTER_DEFAULT_WIDTH = 300;
/** 嘴型循环帧数由 animation-core 单一定义并导出，避免两份常量漂移。 */

/**
 * 阶段 5 草稿导入的默认人物锚点（1080 × 1920 逻辑坐标，脚底中心）。
 * 这是编辑器既定的布局规则，不是解析器对剧本的猜测；解析器完全不产出坐标。
 */
export const DRAFT_CHARACTER_ANCHORS = [
  { x: 180, y: 1650 },
  { x: 440, y: 1650 },
  { x: 700, y: 1650 },
  { x: 900, y: 1650 },
] as const;

/**
 * 无音频时对白时长的确定性估算（30 FPS）。阶段 7 TTS 生成后用真实时长覆盖。
 * 只依赖文本长度，不依赖时钟、随机数或网络，保证同一草稿每次导入结果一致。
 */
export const DRAFT_TIMING = {
  framesPerCharacter: 5,
  baseFrames: 30,
  minFrames: 60,
  maxFrames: 300,
  gapFrames: 15,
} as const;

/** 阶段 6 时间轴显示与编辑约束。FPS 沿用 PROJECT_DEFAULTS.fps（30），不另立常量。 */
export const TIMELINE_VIEW = {
  minPxPerFrame: 0.5,
  maxPxPerFrame: 8,
  defaultPxPerFrame: 2,
  zoomStep: 1.5,
  /** 对白事件最短时长，防止拖到 0 帧后无法再操作。 */
  minDialogueFrames: 15,
  /** 轨道标签列宽度，时间轴内容区独立横向滚动。 */
  trackLabelWidth: 116,
} as const;

/** 编辑器撤销 / 重做快照上限，只保存 StageData 引用（不可变更新），内存可控。 */
export const MAX_HISTORY_ENTRIES = 50;

/**
 * 阶段 7 TTS 音频常量。真实时长由 Provider 生成的 PCM 样本数决定，
 * 这里只固定编码参数和「防止音频被提前截断」的尾部余量（PRD 12.3）。
 */
export const TTS_AUDIO = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  /** 对白帧数在音频帧数之外额外追加的余量，避免最后一帧音频被截断。 */
  tailFrames: 6,
  /** 最短对白帧数：极短音频也保证字幕与嘴型可见。 */
  minDialogueFrames: 30,
  /** 最短音频时长（毫秒），极短文本也生成可播放文件。 */
  minDurationMs: 300,
  minSpeed: 0.5,
  maxSpeed: 2,
  defaultSpeed: 1,
} as const;

/** 缓存振幅包络的嘴型阈值由 animation-core 单一定义并导出，避免两份常量漂移。 */

/**
 * 场景间「进入转场」预设（工作台场景编辑 → 导出拼接）。
 *
 * 转场叠加在场景边界开始的前 N 个**项目逻辑帧**上，不额外占用时间轴，
 * 因此 buildSceneSpans、音频全局偏移、导出总帧数都不受影响。
 * 30 FPS 下 9 帧 ≈ 0.3 秒、15 帧 ≈ 0.5 秒。
 */
export const SCENE_TRANSITION_PRESETS = [
  { id: 'none', label: '无转场', durationFrames: 0 },
  { id: 'fade-300', label: '淡化 0.3 秒（9 帧）', durationFrames: 9 },
  { id: 'fade-500', label: '淡化 0.5 秒（15 帧）', durationFrames: 15 },
] as const;
export type SceneTransitionPresetId = (typeof SCENE_TRANSITION_PRESETS)[number]['id'];

/** 防止误填超大转场帧数把整个场景吃掉。 */
export const MAX_SCENE_TRANSITION_FRAMES = 60;

export function sceneTransitionPresetById(id: SceneTransitionPresetId) {
  return SCENE_TRANSITION_PRESETS.find((item) => item.id === id) ?? SCENE_TRANSITION_PRESETS[0];
}
