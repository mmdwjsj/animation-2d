import { z } from 'zod';
import { MAX_CHARACTERS_PER_SCENE, MAX_STAGE_OBJECTS, MAX_SCENE_TRANSITION_FRAMES, POSTURE_VALUES } from '../constants';
import { characterInstanceSchema } from './character';

/**
 * 场景「进入转场」：从上一个场景切入本场景时叠加的交叉淡化。
 * 可选字段，旧项目没有该字段即视为无转场；null 表示用户主动关闭。
 * 转场不占额外帧，只在场景开头前 durationFrames 帧内做画面叠加。
 */
export const sceneTransitionSchema = z.object({
  type: z.literal('fade'),
  durationFrames: z.number().int().positive().max(MAX_SCENE_TRANSITION_FRAMES),
});
export type SceneTransition = z.infer<typeof sceneTransitionSchema>;

/** 把任意输入（含旧数据 / 外部 API）安全地归一化为合法转场配置。 */
export function normalizeSceneTransition(value: unknown): SceneTransition | null {
  const parsed = sceneTransitionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * 舞台布局数据（架构 6.5 SceneProjectData 的静态子集）。
 * 阶段 2 建立背景与静态道具，阶段 3 增加人物实例与姿态；
 * 对白事件、时间轴在后续阶段扩展。
 * 坐标全部是 1080 × 1920 逻辑坐标，不保存浏览器像素坐标（PRD 7.4）。
 */
export const stageObjectSchema = z.object({
  id: z.string().min(1).max(80),
  assetId: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  /** 锚点位置（默认素材底部中心），逻辑坐标 */
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
  rotation: z.number().finite().min(-360).max(360).default(0),
  zIndex: z.number().int().nonnegative().max(10000),
  visible: z.boolean().default(true),
});
export type StageObject = z.infer<typeof stageObjectSchema>;

/**
 * 对白事件（架构 6.4 / PRD 12.2），阶段 5 由剧本草稿导入生成。
 * 第一版尚未接入 TTS，时长按确定性规则估算；阶段 7 用音频真实时长覆盖。
 */
export const dialogueEventSchema = z.object({
  id: z.string().min(1).max(80),
  characterId: z.string().min(1).max(80),
  text: z.string().min(1),
  posture: z.enum(POSTURE_VALUES),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive().max(100000),
  audioAssetId: z.string().min(1).max(80).optional(),
  sourceLine: z.number().int().positive().optional(),
  /**
   * 阶段 7：用户是否手动调整过该对白的时间。
   * TTS 生成真实音频后，手动调整过的对白不会被自动移动起始帧，
   * 只会把时长延长到不小于音频时长，避免音频被提前截断（PRD 12.3）。
   */
  manuallyTimed: z.boolean().optional(),
});
export type DialogueEvent = z.infer<typeof dialogueEventSchema>;

export const stageSceneSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  backgroundAssetId: z.string().nullable().default(null),
  /** 静态道具。 */
  objects: z.array(stageObjectSchema).max(MAX_STAGE_OBJECTS),
  /** 人物实例；.default([]) 兼容阶段 2 落盘的数据。 */
  characters: z.array(characterInstanceSchema).max(MAX_CHARACTERS_PER_SCENE).default([]),
  /** 对白事件；.default([]) 兼容阶段 2/3 落盘的数据。 */
  dialogueEvents: z.array(dialogueEventSchema).default([]),
  /** 进入本场景的转场；缺省 / null 表示无转场，兼容历史项目数据。 */
  transition: sceneTransitionSchema.nullable().optional(),
});
export type StageScene = z.infer<typeof stageSceneSchema>;

/**
 * 落盘于 <project>/animation/animation.json。
 * 所有字段提供默认值，以兼容阶段 1 写入的 { projectId, scenes: [] }。
 */
export const stageDataSchema = z.object({
  projectId: z.string().uuid(),
  version: z.number().int().nonnegative().default(0),
  activeSceneId: z.string().nullable().default(null),
  scenes: z.array(stageSceneSchema).default([]),
});
export type StageData = z.infer<typeof stageDataSchema>;

export const stageResponseSchema = z.object({ data: stageDataSchema });

/** 阶段 2 单场景默认舞台，保证每次打开空项目得到确定性的初始布局。 */
export const DEFAULT_SCENE_ID = 'scene-default';

export function createDefaultStage(projectId: string): StageData {
  return stageDataSchema.parse({
    projectId,
    version: 0,
    activeSceneId: DEFAULT_SCENE_ID,
    scenes: [
      {
        id: DEFAULT_SCENE_ID,
        name: '场景 1',
        backgroundAssetId: null,
        objects: [],
      },
    ],
  });
}
