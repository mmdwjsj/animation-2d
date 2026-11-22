import { describe, expect, it } from 'vitest';
import { buildMuxArgs } from './muxAudio';

/**
 * FFmpeg 合成命令的确定性拼装（PRD 14 步骤 7）。
 * 只测参数结构，不启动 FFmpeg；真实合成在端到端验证脚本里执行。
 */
describe('阶段 8：FFmpeg 音视频合成命令', () => {
  const silent = '/tmp/silent.mp4';
  const output = '/tmp/out.mp4';

  it('多句音频按真实起始毫秒加延迟，并混音为与视频等长的 AAC', () => {
    const args = buildMuxArgs({
      silentVideo: silent,
      outputFile: output,
      durationSeconds: 12.133,
      audioTracks: [
        { file: '/tmp/a1.wav', startMs: 0, durationMs: 1181 },
        { file: '/tmp/a2.wav', startMs: 1250.4, durationMs: 1446 },
      ],
    });

    expect(args[0]).toBe('-y');
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');

    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('adelay=0:all=1');
    // 小数毫秒四舍五入为整数，避免 FFmpeg 参数非法。
    expect(filter).toContain('adelay=1250:all=1');
    expect(filter).toContain('amix=inputs=2');
    expect(filter).toContain('atrim=0:12.133');
    expect(filter).toContain('apad=whole_dur=12.133');
    expect(filter).toContain('aresample=48000');
    // 音轨已按视频时长补齐；-shortest 会让 AAC priming 提前截断视频尾部帧。
    expect(args).not.toContain('-shortest');

    expect(args[args.length - 1]).toBe(output);
  });

  it('无音频时仍产出无声 MP4，不添加伪造音轨', () => {
    const args = buildMuxArgs({
      silentVideo: silent,
      outputFile: output,
      durationSeconds: 5,
      audioTracks: [],
    });
    expect(args).toContain('-an');
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-c:a');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
  });

  it('负的起始时间被夹到 0，避免 adelay 报错', () => {
    const args = buildMuxArgs({
      silentVideo: silent,
      outputFile: output,
      durationSeconds: 3,
      audioTracks: [{ file: '/tmp/a.wav', startMs: -50, durationMs: 900 }],
    });
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('adelay=0:all=1');
  });
});
