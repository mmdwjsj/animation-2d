import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { errors } from '../errors';
import type { AudioTrack } from './buildCompositionProps';

const execFileAsync = promisify(execFile);

/** 系统 FFmpeg；允许通过环境变量覆盖可执行文件位置。 */
export const FFMPEG_PATH = process.env.ANIMATION_FFMPEG_PATH ?? 'ffmpeg';

export interface MuxOptions {
  silentVideo: string;
  outputFile: string;
  audioTracks: readonly AudioTrack[];
  /** 视频总时长（秒），用于把音轨补齐到与画面等长。 */
  durationSeconds: number;
  ffmpegPath?: string;
}

/**
 * 拼装 FFmpeg 音视频合成命令（PRD 14 步骤 7）。
 *
 * 每句 WAV 按对白起始帧换算成毫秒延迟，混合为一条与视频等长的立体声 AAC 音轨；
 * 视频流直接 copy，不二次编码，保证 Remotion 的 H.264 画质不受损。
 * 无音频时仍走 FFmpeg 做无损封装，明确产出无声 MP4，而不是伪造音轨。
 *
 * 不使用 -shortest：音轨已由 atrim + apad=whole_dur 精确补齐到视频时长，
 * 而 AAC 编码自带 priming/padding 会让「最短流」比视频早结束几十毫秒，
 * 实测会截断视频尾部若干帧（403 帧只输出 400 帧）。改为以视频流为准。
 */
export function buildMuxArgs(options: MuxOptions): string[] {
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error', '-i', options.silentVideo];
  const duration = Math.max(0.1, options.durationSeconds);

  if (options.audioTracks.length === 0) {
    return [
      ...args,
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      '-movflags',
      '+faststart',
      options.outputFile,
    ];
  }

  for (const track of options.audioTracks) args.push('-i', track.file);

  const filters: string[] = [];
  const labels: string[] = [];
  options.audioTracks.forEach((track, index) => {
    const label = `a${index}`;
    labels.push(`[${label}]`);
    const delay = Math.max(0, Math.round(track.startMs));
    filters.push(
      `[${index + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}:all=1[${label}]`,
    );
  });
  filters.push(
    `${labels.join('')}amix=inputs=${options.audioTracks.length}:duration=longest:normalize=0,` +
      `atrim=0:${duration.toFixed(3)},apad=whole_dur=${duration.toFixed(3)},` +
      `aresample=48000,aformat=channel_layouts=stereo[aout]`,
  );

  return [
    ...args,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    options.outputFile,
  ];
}

/** 执行合成。失败时抛出可定位错误，绝不静默回退成「已完成」。 */
export async function muxAudio(options: MuxOptions): Promise<void> {
  mkdirSync(path.dirname(options.outputFile), { recursive: true });
  const ffmpeg = options.ffmpegPath ?? FFMPEG_PATH;
  try {
    await execFileAsync(ffmpeg, buildMuxArgs(options), {
      timeout: 15 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw errors.render(`音频合成失败：${message}`, cause);
  }
}

/** 探测 FFmpeg 是否可用，供启动自检与测试使用。 */
export async function probeFfmpeg(ffmpegPath: string = FFMPEG_PATH): Promise<string> {
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-version'], { windowsHide: true });
    return stdout.split('\n')[0] ?? 'ffmpeg';
  } catch (cause) {
    throw errors.render('未找到可用的 FFmpeg，请先安装并加入 PATH。', cause);
  }
}
