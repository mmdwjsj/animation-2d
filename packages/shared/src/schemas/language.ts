import { z } from 'zod';
import { DEFAULT_PROJECT_LANGUAGE, PROJECT_LANGUAGES, type ProjectLanguage } from '../constants';

/**
 * 语言是第一版的一等维度：中文与泰语并列。
 *
 * 语言只影响配音引擎 / 音色路由与字幕排版，不改变确定性剧本解析规则，
 * 也不做界面国际化；旧数据缺字段一律回落默认语言，零迁移。
 */
export const projectLanguageSchema = z.enum(PROJECT_LANGUAGES);
export type { ProjectLanguage };

/** 安全归一化：外部输入或旧数据缺字段 / 非法值一律回落到指定默认。 */
export function resolveLanguage(
  value: unknown,
  fallback: ProjectLanguage = DEFAULT_PROJECT_LANGUAGE,
): ProjectLanguage {
  const parsed = projectLanguageSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/**
 * 对白语言：显式字段优先，否则继承舞台（项目）默认语言。
 * 支持同一项目内中泰混排，但剧本解析器仍按既有确定性规则工作。
 */
export function resolveDialogueLanguage(
  dialogueLanguage: unknown,
  stageLanguage: unknown,
): ProjectLanguage {
  const inherited = resolveLanguage(stageLanguage);
  return resolveLanguage(dialogueLanguage, inherited);
}
