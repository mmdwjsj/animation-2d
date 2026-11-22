/**
 * 音频振幅驱动的嘴型（架构 7.4 / PRD 10.3）。
 *
 * 振幅包络由 TTS Provider 在生成音频时一次性计算并缓存到音频资产元数据，
 * 这里只读数组、按整数帧索引，绝不在渲染时临时分析音频或读取时钟。
 * 因此任意跳帧都得到相同结果，与确定性循环嘴型完全等价可替换。
 *
 * 包内零依赖：不引用 shared、DOM、浏览器 API 或 Provider 实现。
 */
import type { MouthState } from '../character/transform';

/** 归一化振幅阈值（0..1）；由 animation-core 单一定义，shared 不再重复。 */
export const MOUTH_ENVELOPE_SMALL_THRESHOLD = 0.12;
export const MOUTH_ENVELOPE_LARGE_THRESHOLD = 0.42;

/** 把任意帧号归一化为非负整数，NaN / Infinity 视为 0。 */
function asFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.floor(frame));
}

/**
 * 按缓存包络取指定帧的嘴型。
 * localFrame 是「对白内的相对帧」（当前帧 − 对白起始帧），越界一律闭嘴，
 * 这样即使对白区间被拉长也不会出现音频结束后的张嘴残留。
 */
export function mouthStateFromEnvelope(
  envelope: readonly number[],
  localFrame: number,
): MouthState {
  if (!envelope || envelope.length === 0) return 'closed';
  const index = asFrame(localFrame);
  if (index >= envelope.length) return 'closed';
  const amplitude = envelope[index];
  if (!Number.isFinite(amplitude) || amplitude <= MOUTH_ENVELOPE_SMALL_THRESHOLD) {
    return 'closed';
  }
  if (amplitude < MOUTH_ENVELOPE_LARGE_THRESHOLD) return 'open_small';
  return 'open_large';
}

/** 嘴型来源，供界面诊断与走查断言，不影响画面计算。 */
export type MouthSource = 'audio' | 'cycle' | 'silent';
