import { describe, expect, it } from 'vitest';
import { commandTtsConfigSchema } from './commandConfig';
import { CommandTtsProvider } from './commandTtsProvider';

/** 用 Node 自身生成一个 100ms / 8kHz 的 PCM16 WAV，模拟外部引擎产物。 */
const FAKE_ENGINE_SCRIPT = [
  "const fs=require('fs');",
  "const out=process.argv[1];",
  "const rate=8000,n=800;",
  "const b=Buffer.alloc(44+n*2);",
  "b.write('RIFF',0,'ascii');b.writeUInt32LE(36+n*2,4);b.write('WAVE',8,'ascii');",
  "b.write('fmt ',12,'ascii');b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);",
  "b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);",
  "b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36,'ascii');",
  "b.writeUInt32LE(n*2,40);",
  "for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i/10)*10000),44+i*2);",
  "fs.writeFileSync(out,b);",
].join('');

function makeProvider(overrides: Record<string, unknown> = {}) {
  const config = commandTtsConfigSchema.parse({
    id: 'fake-thai',
    name: '模拟泰语引擎',
    description: '测试用本地命令模板',
    languages: ['th'],
    kind: 'command',
    command: process.execPath,
    args: ['-e', FAKE_ENGINE_SCRIPT, '{output}'],
    outputExtension: '.wav',
    voices: [{ id: 'spk-1', name: '音色 1', description: '', language: 'th' }],
    defaultVoiceByLanguage: { th: 'spk-1' },
    ...overrides,
  });
  return new CommandTtsProvider(config);
}

const request = {
  text: 'สวัสดีครับ',
  voiceId: 'spk-1',
  speed: 1,
  fps: 30,
  language: 'th' as const,
};

describe('CommandTtsProvider：命令模板真实链路', () => {
  it('描述符只暴露通用字段，按语言给出默认音色', () => {
    const descriptor = makeProvider().descriptor;
    expect(descriptor.id).toBe('fake-thai');
    expect(descriptor.languages).toEqual(['th']);
    expect(descriptor.defaultVoiceId).toBe('spk-1');
  });

  it('真实执行命令 → 解码 WAV → 真实时长与嘴型包络', async () => {
    const result = await makeProvider().synthesize(request);
    expect(result.audio.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result.format).toBe('wav');
    expect(result.sampleRate).toBe(8000);
    expect(result.channels).toBe(1);
    expect(result.durationMs).toBeCloseTo(100, 3);
    expect(result.envelopeFps).toBe(30);
    expect(result.envelope.length).toBe(Math.ceil((result.durationMs / 1000) * 30));
    expect(result.envelope.some((value) => value > 0)).toBe(true);
    expect(result.textHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('文本 + 语言 + 音色参与摘要，同输入稳定、换语言必变', async () => {
    const provider = makeProvider({
      languages: ['zh', 'th'],
      voices: [
        { id: 'spk-1', name: '音色 1', description: '', language: 'th' },
        { id: 'spk-zh', name: '中文音色', description: '', language: 'zh' },
      ],
      defaultVoiceByLanguage: { th: 'spk-1', zh: 'spk-zh' },
    });
    const first = await provider.synthesize(request);
    const second = await provider.synthesize(request);
    expect(first.textHash).toBe(second.textHash);
    const zh = await provider.synthesize({ ...request, voiceId: 'spk-zh', language: 'zh' });
    expect(zh.textHash).not.toBe(first.textHash);
    const otherText = await provider.synthesize({ ...request, text: 'คุณกลับมาแล้วเหรอ' });
    expect(otherText.textHash).not.toBe(first.textHash);
  });

  it('不支持的语言、不存在的音色明确报错，不伪造人声', async () => {
    await expect(makeProvider().synthesize({ ...request, language: 'zh' })).rejects.toThrow(/不支持中文/);
    await expect(makeProvider().synthesize({ ...request, voiceId: 'nope' })).rejects.toThrow(/不属于/);
  });

  it('命令不存在 / 未产出文件时给出可操作错误', async () => {
    await expect(
      makeProvider({ command: 'definitely-not-a-real-tts-binary' }).synthesize(request),
    ).rejects.toThrow(/命令不存在|调用失败/);
    await expect(
      makeProvider({ args: ['-e', 'void 0', '{output}'] }).synthesize(request),
    ).rejects.toThrow(/未产出音频文件/);
  });
});
