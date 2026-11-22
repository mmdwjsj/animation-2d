import { describe, expect, it } from 'vitest';
import { detectSubtitleLanguage, wrapSubtitle, subtitleLineHeight } from './subtitle';

describe('双语字幕排版', () => {
  it('中文按码点断行，不丢字', () => {
    const lines = wrapSubtitle('你回来了吗今天过得怎么样', 'zh', 5);
    expect(lines).toEqual(['你回来了吗', '今天过得怎', '么样']);
    expect(lines.join('')).toBe('你回来了吗今天过得怎么样');
  });

  it('泰文按字素簇断行，组合元音与声调不脱离基字符', () => {
    // 「ก」+ 元音「ะ」是一个字素簇；「ก่」含声调符号，同样不可拆。
    const text = 'กะก่กะก่กะ';
    const lines = wrapSubtitle(text, 'th', 3);
    expect(lines.join('')).toBe(text);
    for (const line of lines) {
      expect(line.startsWith('ะ')).toBe(false);
      expect(line.startsWith('\u0E48')).toBe(false);
    }
  });

  it('泰文行高明显大于中文，为上下标字符留空间', () => {
    expect(subtitleLineHeight('th', 48)).toBeGreaterThan(subtitleLineHeight('zh', 48));
    expect(subtitleLineHeight('zh', 48)).toBeCloseTo(48 * 1.28, 5);
    expect(subtitleLineHeight('th', 48)).toBeCloseTo(48 * 1.58, 5);
  });

  it('超过最大行数时合并到末行，不截断台词', () => {
    const text = '一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾';
    const lines = wrapSubtitle(text, 'zh', 2);
    expect(lines).toHaveLength(3);
    expect(lines.join('')).toBe(text);
  });

  it('按台词实际文字检测语言，含泰文码点即按泰文排版', () => {
    expect(detectSubtitleLanguage('你回来了？')).toBe('zh');
    expect(detectSubtitleLanguage('สวัสดีครับ')).toBe('th');
    expect(detectSubtitleLanguage('你好 สวัสดี')).toBe('th');
    expect(detectSubtitleLanguage('Hello 123')).toBe('zh');
  });

  it('保留显式换行且忽略空行', () => {
    const lines = wrapSubtitle('你回来了\n我在这儿', 'zh', 18);
    expect(lines).toEqual(['你回来了', '我在这儿']);
    expect(wrapSubtitle('', 'th', 10)).toEqual([]);
  });
});
