/**
 * WAV（PCM 16-bit）编码与振幅包络计算。
 * 不依赖任何第三方音频库；时长与包络都从真实 PCM 样本数推导，
 * 因此「真实时长」不是估算值，可与 WAV 头里的 data 长度互相校验。
 */
import { TTS_AUDIO } from '@animation/shared';

export interface WavEncoding {
  buffer: Buffer;
  durationMs: number;
  sampleRate: number;
  channels: number;
}

/** 标准 44 字节 RIFF/WAVE 头 + PCM 数据。 */
export function encodeWav(
  samples: Int16Array,
  sampleRate: number = TTS_AUDIO.sampleRate,
  channels: number = TTS_AUDIO.channels,
): WavEncoding {
  const bits = TTS_AUDIO.bitsPerSample;
  const blockAlign = channels * (bits / 8);
  const dataSize = samples.length * (bits / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }

  return {
    buffer,
    durationMs: (samples.length / (sampleRate * channels)) * 1000,
    sampleRate,
    channels,
  };
}

/**
 * 按项目帧率把 PCM 切成整数帧，计算每帧归一化 RMS 振幅。
 * 结果作为缓存数据写入音频资产；渲染时只读数组，不重新分析音频（架构 7.4）。
 */
export function computeAmplitudeEnvelope(
  samples: Int16Array,
  sampleRate: number,
  fps: number,
): number[] {
  const safeFps = Math.max(1, Math.floor(fps));
  const samplesPerFrame = sampleRate / safeFps;
  const frameCount = Math.max(1, Math.ceil(samples.length / samplesPerFrame));
  const rms = new Array<number>(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = Math.floor(frame * samplesPerFrame);
    const end = Math.min(samples.length, Math.floor((frame + 1) * samplesPerFrame));
    if (end <= start) {
      rms[frame] = 0;
      continue;
    }
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const amplitude = samples[i] / 32768;
      sum += amplitude * amplitude;
    }
    rms[frame] = Math.sqrt(sum / (end - start));
  }

  const peak = rms.reduce((max, value) => Math.max(max, value), 0);
  if (peak <= 0) return rms.map(() => 0);
  return rms.map((value) => Math.min(1, Math.round((value / peak) * 10000) / 10000));
}

/** 从 WAV Buffer 读取 data 块长度并换算时长，供测试交叉校验元数据。 */
export function readWavDurationMs(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('不是有效的 WAV 文件。');
  }
  const dataSize = buffer.readUInt32LE(40);
  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22);
  const bits = buffer.readUInt16LE(34);
  return (dataSize / (channels * (bits / 8)) / sampleRate) * 1000;
}

export interface DecodedWav {
  /** 交错 PCM16 样本；多声道时按帧交错，包络计算按全部样本求 RMS。 */
  samples: Int16Array;
  sampleRate: number;
  channels: number;
}

/**
 * 解码标准 PCM 16-bit WAV（支持 fmt 块之外的额外 chunk）。
 * 供外部 TTS 引擎产出的 WAV 复用同一套「真实时长 + 振幅包络」计算，
 * 非 PCM / 缺 data 块 / 截断文件一律明确报错，不静默返回空音频。
 */
export function decodeWavPcm(buffer: Buffer): DecodedWav {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('不是有效的 RIFF/WAVE 文件。');
  }
  let offset = 12;
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && fmtOffset < 0) fmtOffset = body;
    if (id === 'data') {
      dataOffset = body;
      dataSize = size;
      break;
    }
    // chunk 按偶数字节对齐。
    offset = body + size + (size % 2);
  }
  if (fmtOffset < 0 || fmtOffset + 16 > buffer.length) {
    throw new Error('WAV 缺少有效的 fmt 块。');
  }
  const format = buffer.readUInt16LE(fmtOffset);
  const channels = buffer.readUInt16LE(fmtOffset + 2);
  const sampleRate = buffer.readUInt32LE(fmtOffset + 4);
  const bits = buffer.readUInt16LE(fmtOffset + 14);
  if (format !== 1 || bits !== 16) {
    throw new Error(`只支持 PCM 16-bit WAV，实际 format=${format}、bits=${bits}。`);
  }
  if (channels < 1 || sampleRate <= 0) {
    throw new Error('WAV 头里的声道数或采样率不合法。');
  }
  if (dataOffset < 0 || dataOffset > buffer.length) {
    throw new Error('WAV 缺少 data 块。');
  }

  const usable = Math.max(0, Math.min(dataSize, buffer.length - dataOffset));
  const count = Math.floor(usable / 2);
  if (count === 0) throw new Error('WAV 的 data 块为空。');
  const samples = new Int16Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = buffer.readInt16LE(dataOffset + index * 2);
  }
  return { samples, sampleRate, channels };
}
