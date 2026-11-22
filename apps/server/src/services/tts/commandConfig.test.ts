import { describe, expect, it } from 'vitest';
import { commandTtsConfigSchema, ttsProvidersFileSchema } from './commandConfig';

const thaiVoice = {
  id: 'spk-1',
  name: '泰语音色 1',
  description: 'speaker 1',
  language: 'th' as const,
};

const base = {
  id: 'kokoro-thai-local',
  name: 'Kokoro Thai（本地离线）',
  description: '离线泰语引擎',
  languages: ['th'] as const,
  kind: 'command' as const,
  command: 'python',
  args: ['tts.py', '--text', '{text}', '--voice', '{voice}', '--output', '{output}'],
  voices: [thaiVoice],
  defaultVoiceByLanguage: { th: 'spk-1' },
};

describe('外部 TTS 引擎配置契约', () => {
  it('合法命令模板配置通过，并补齐默认值', () => {
    const parsed = commandTtsConfigSchema.parse(base);
    expect(parsed.timeoutMs).toBe(120000);
    expect(parsed.outputExtension).toBe('.wav');
    expect(parsed.defaultSpeed).toBe(1);
    expect(parsed.args).toContain('{text}');
  });

  it('kind=command 缺 command 被拒绝', () => {
    const { command: _command, ...withoutCommand } = base;
    expect(commandTtsConfigSchema.safeParse(withoutCommand).success).toBe(false);
  });

  it('kind=http 缺 baseUrl 被拒绝，密钥只声明环境变量名', () => {
    expect(
      commandTtsConfigSchema.safeParse({
        ...base,
        kind: 'http',
        command: undefined,
        apiKeyEnv: 'MY_TTS_KEY',
      }).success,
    ).toBe(false);
    expect(
      commandTtsConfigSchema.safeParse({
        ...base,
        kind: 'http',
        command: undefined,
        baseUrl: 'http://127.0.0.1:10001',
        apiKeyEnv: 'MY_TTS_KEY',
        env: { TOKEN: '{env:MY_TTS_KEY}' },
      }).success,
    ).toBe(true);
  });

  it('音色语言必须落在 languages 内', () => {
    expect(
      commandTtsConfigSchema.safeParse({
        ...base,
        voices: [{ ...thaiVoice, language: 'zh' }],
      }).success,
    ).toBe(false);
  });

  it('按语言默认音色必须存在且语言匹配', () => {
    expect(
      commandTtsConfigSchema.safeParse({
        ...base,
        defaultVoiceByLanguage: { th: 'not-exist' },
      }).success,
    ).toBe(false);
  });

  it('文件级 Schema 忽略示例用的 disabledProviders 等未知键', () => {
    const parsed = ttsProvidersFileSchema.parse({
      note: '说明',
      providers: [base],
      disabledProviders: [{ ...base, id: 'edge-tts-zh', languages: ['zh'] }],
    });
    expect(parsed.providers).toHaveLength(1);
    expect(Object.keys(parsed)).toEqual(['providers']);
  });
});
