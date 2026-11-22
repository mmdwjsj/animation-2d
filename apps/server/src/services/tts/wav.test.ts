import { describe, expect, it } from 'vitest';
import { decodeWavPcm, encodeWav, readWavDurationMs } from './wav';

function appendJunkChunk(wav: Buffer): Buffer {
  const junk = Buffer.from('JUNK', 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(3, 0);
  const payload = Buffer.from([1, 2, 3, 0]); // 奇数长度 + 1 字节对齐
  const head = wav.subarray(0, 12);
  const rest = wav.subarray(12);
  const merged = Buffer.concat([head, junk, size, payload, rest]);
  merged.writeUInt32LE(merged.length - 8, 4); // RIFF size
  return merged;
}

describe('decodeWavPcm', () => {
  it('encodeWav → decodeWavPcm 往返，样本与元数据完全一致', () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768, 500]);
    const encoded = encodeWav(samples, 8000, 1);
    const decoded = decodeWavPcm(encoded.buffer);
    expect(decoded.sampleRate).toBe(8000);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.samples)).toEqual(Array.from(samples));
    expect(readWavDurationMs(encoded.buffer)).toBeCloseTo(encoded.durationMs, 6);
  });

  it('跳过 fmt 之前的额外 JUNK chunk 仍能找到 data', () => {
    const encoded = encodeWav(new Int16Array([1, 2, 3, 4]), 16000, 1);
    const withJunk = appendJunkChunk(encoded.buffer);
    const decoded = decodeWavPcm(withJunk);
    expect(Array.from(decoded.samples)).toEqual([1, 2, 3, 4]);
    expect(decoded.sampleRate).toBe(16000);
  });

  it('非 PCM、缺 data、空 data 与截断文件都明确报错', () => {
    const encoded = encodeWav(new Int16Array([1, 2, 3]), 16000, 1);
    const float = Buffer.from(encoded.buffer);
    float.writeUInt16LE(3, 20); // IEEE float
    expect(() => decodeWavPcm(float)).toThrow(/PCM 16-bit/);

    const noData = Buffer.from(encoded.buffer);
    noData.write('LIST', 36, 'ascii');
    expect(() => decodeWavPcm(noData)).toThrow(/data 块/);

    const empty = Buffer.from(encoded.buffer.subarray(0, 44));
    empty.writeUInt32LE(0, 40);
    expect(() => decodeWavPcm(empty)).toThrow(/为空/);

    expect(() => decodeWavPcm(Buffer.from('not a wav'))).toThrow(/RIFF\/WAVE/);
  });
});
