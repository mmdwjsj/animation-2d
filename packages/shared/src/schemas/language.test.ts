import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_LANGUAGE,
  PROJECT_LANGUAGES,
  PROJECT_LANGUAGE_LABELS,
} from '../constants';
import { projectLanguageSchema, resolveDialogueLanguage, resolveLanguage } from './language';
import { createDefaultStage, dialogueEventSchema, stageDataSchema } from './stage';
import { projectSchema } from './project';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

describe('语言 Schema', () => {
  it('中文与泰语是唯二的一等语言', () => {
    expect(PROJECT_LANGUAGES).toEqual(['zh', 'th']);
    expect(projectLanguageSchema.parse('th')).toBe('th');
    expect(projectLanguageSchema.safeParse('en').success).toBe(false);
    expect(PROJECT_LANGUAGE_LABELS.zh).toBe('中文');
    expect(PROJECT_LANGUAGE_LABELS.th).toBe('泰语');
  });

  it('非法或缺省的 language 安全回落到默认语言', () => {
    expect(resolveLanguage(undefined)).toBe(DEFAULT_PROJECT_LANGUAGE);
    expect(resolveLanguage('en')).toBe(DEFAULT_PROJECT_LANGUAGE);
    expect(resolveLanguage('th', 'zh')).toBe('th');
    expect(resolveLanguage(null, 'th')).toBe('th');
  });

  it('对白显式语言优先，否则继承舞台语言', () => {
    expect(resolveDialogueLanguage(undefined, 'th')).toBe('th');
    expect(resolveDialogueLanguage('zh', 'th')).toBe('zh');
    expect(resolveDialogueLanguage('th', 'zh')).toBe('th');
    expect(resolveDialogueLanguage('invalid', 'th')).toBe('th');
    expect(resolveDialogueLanguage(undefined, undefined)).toBe('zh');
  });
});

describe('旧数据零迁移', () => {
  it('舞台缺省语言自动补为中文，显式泰语会保留', () => {
    const parsed = stageDataSchema.parse({ projectId: PROJECT_ID, scenes: [] });
    expect(parsed.language).toBe('zh');
    expect(stageDataSchema.parse({ projectId: PROJECT_ID, scenes: [], language: 'th' }).language).toBe(
      'th',
    );
    expect(createDefaultStage(PROJECT_ID).language).toBe('zh');
  });

  it('项目元数据缺省语言自动补为中文', () => {
    const base = {
      id: PROJECT_ID,
      name: '双语项目',
      version: 1,
      fps: 30,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
      sceneIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(projectSchema.parse(base).language).toBe('zh');
    expect(projectSchema.parse({ ...base, language: 'th' }).language).toBe('th');
  });

  it('对白语言是可选覆盖，非法值由 Schema 直接拒绝', () => {
    const base = {
      id: 'dlg-1',
      characterId: 'char-1',
      text: 'สวัสดีครับ',
      posture: 'standing',
      startFrame: 0,
      durationFrames: 60,
    };
    expect(dialogueEventSchema.parse(base).language).toBeUndefined();
    expect(dialogueEventSchema.parse({ ...base, language: 'th' }).language).toBe('th');
    expect(dialogueEventSchema.safeParse({ ...base, language: 'en' }).success).toBe(false);
  });
});
