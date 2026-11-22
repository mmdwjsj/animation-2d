import { z } from 'zod';
import { POSTURE_VALUES } from '../constants';

/**
 * 剧本解析草稿（PRD 9 节 / 架构 5.3、6.2）。
 *
 * 解析器是纯逻辑模块：输入原始剧本文本，输出本结构。这里只承载剧本中
 * 明确写出的信息（场景、角色、对白、姿态、源行号），不含人物坐标、素材
 * 绑定、时间轴与动画事件——那些由阶段 5 的 Draft / Import Module 转换。
 *
 * 所有 ID 由解析器按出现顺序确定性生成，禁止使用随机数或时间戳，
 * 以保证「相同输入产生相同结果」。
 */

/** 架构 6.2：错误必须可定位到原始剧本行号。 */
export const PARSE_ERROR_TYPES = ['syntax', 'character', 'posture', 'scene', 'limit'] as const;
export type ParseErrorType = (typeof PARSE_ERROR_TYPES)[number];

export const PARSE_ERROR_TYPE_LABELS: Record<ParseErrorType, string> = {
  syntax: '语法错误',
  character: '角色错误',
  posture: '姿态错误',
  scene: '场景错误',
  limit: '数量超限',
};

export const parseErrorSchema = z.object({
  /** 1-based 原始行号（空行也计入）。 */
  line: z.number().int().positive(),
  /** 可选列号，供后续编辑器定位；第一版解析器不强制产生。 */
  column: z.number().int().positive().optional(),
  type: z.enum(PARSE_ERROR_TYPES),
  /** 面向用户的说明，包含修复建议，不暴露内部路径或堆栈。 */
  message: z.string().min(1).max(300),
});
export type ParseError = z.infer<typeof parseErrorSchema>;

export const draftCharacterSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  /** 该角色第一句对白的姿态；从未说话的角色为默认站立。 */
  initialPosture: z.enum(POSTURE_VALUES),
  sourceLine: z.number().int().positive(),
});
export type DraftCharacter = z.infer<typeof draftCharacterSchema>;

export const draftDialogueSchema = z.object({
  id: z.string().min(1).max(80),
  characterId: z.string().min(1).max(80),
  text: z.string().min(1),
  /** 姿态继承后的结果，在该对白事件开始时生效。 */
  posture: z.enum(POSTURE_VALUES),
  /** 全剧本内的对白顺序，从 1 开始。 */
  sequence: z.number().int().positive(),
  sourceLine: z.number().int().positive(),
});
export type DraftDialogue = z.infer<typeof draftDialogueSchema>;

export const draftSceneSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  characters: z.array(draftCharacterSchema),
  dialogues: z.array(draftDialogueSchema),
});
export type DraftScene = z.infer<typeof draftSceneSchema>;

export const scriptDraftSchema = z.object({
  scenes: z.array(draftSceneSchema),
  /** 阻断错误：全部修复后才允许创建动画草稿。 */
  errors: z.array(parseErrorSchema),
  /** 非阻断提醒，例如场景无对白、角色声明后未说话。 */
  warnings: z.array(z.string().min(1)),
});
export type ScriptDraft = z.infer<typeof scriptDraftSchema>;
