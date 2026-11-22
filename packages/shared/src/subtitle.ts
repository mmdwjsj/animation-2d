import { SUBTITLE_TYPOGRAPHY } from './constants';
import type { ProjectLanguage } from './constants';

/**
 * 字幕排版纯函数（Web 预览与 Remotion 成品共用，避免两处规则漂移）。
 *
 * 泰文没有空格分词，且元音 / 声调符号是跟随基字符的组合标记：
 * 断行必须按 grapheme cluster，否则会把「ก + ะ」拆到两行导致字形破碎；
 * 行高也要更大，给上下标字符留出空间（PRD 双语适配）。
 */

const segmenters = new Map<string, Intl.Segmenter>();

/** 中文按码点切；泰文按字素簇切（Intl.Segmenter 不可用时按码点兜底）。 */
function graphemes(text: string, language: ProjectLanguage): string[] {
  if (language === 'zh') return Array.from(text);
  try {
    let segmenter = segmenters.get(language);
    if (!segmenter) {
      segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
      segmenters.set(language, segmenter);
    }
    return Array.from(segmenter.segment(text), (item) => item.segment);
  } catch {
    return Array.from(text);
  }
}

/**
 * 按每行最大字素簇数断行；保留显式换行，最多保留 maxLines 行，
 * 超出部分不截断内容而是合并到末行，避免台词丢失。
 */
export function wrapSubtitle(
  text: string,
  language: ProjectLanguage,
  maxUnitsPerLine = 18,
): string[] {
  const limit = Math.max(1, Math.floor(maxUnitsPerLine));
  const typography = SUBTITLE_TYPOGRAPHY[language];
  const lines: string[] = [];
  let current = '';
  let units = 0;

  for (const unit of graphemes(text, language)) {
    if (unit === '\n') {
      if (current) lines.push(current);
      current = '';
      units = 0;
      continue;
    }
    if (units >= limit) {
      lines.push(current);
      current = '';
      units = 0;
    }
    current += unit;
    units += 1;
  }
  if (current) lines.push(current);

  if (lines.length <= typography.maxLines) return lines;
  const kept = lines.slice(0, typography.maxLines - 1);
  kept.push(lines.slice(typography.maxLines - 1).join(''));
  return kept;
}

/** 泰文行高更大，避免上下标元音与声调符号被裁切。 */
export function subtitleLineHeight(language: ProjectLanguage, fontSize: number): number {
  return fontSize * SUBTITLE_TYPOGRAPHY[language].lineHeightRatio;
}

/**
 * 按台词实际文字检测排版语言：出现泰文码点（U+0E00–U+0E7F）即按泰文排版。
 * Web 预览与 Remotion 成品共用此规则，保证同一句台词两端断行一致；
 * 数据层的 language 字段只用于 TTS 引擎路由，不参与字形排版。
 */
export function detectSubtitleLanguage(text: string): ProjectLanguage {
  return /[\u0E00-\u0E7F]/.test(text) ? 'th' : 'zh';
}
