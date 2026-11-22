import { describe, expect, it } from 'vitest';
import { frameAtFrame, type CompositionProps, type RenderFrameChunk } from './props';

function makeFrame(tag: string) {
  return { background: tag, layers: [], subtitle: null };
}

function makeProps(chunks: RenderFrameChunk[]): CompositionProps {
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: chunks.at(-1)?.toFrame ?? 0,
    logicalWidth: 1080,
    logicalHeight: 1920,
    assets: {},
    frameChunks: chunks,
  };
}

const chunks: RenderFrameChunk[] = [
  { fromFrame: 0, toFrame: 10, frame: makeFrame('a') },
  { fromFrame: 10, toFrame: 11, frame: makeFrame('b') },
  { fromFrame: 11, toFrame: 40, frame: makeFrame('c') },
];

describe('导出帧块 · 按帧定位画面', () => {
  it('空帧块返回 null', () => {
    expect(frameAtFrame(makeProps([]), 0)).toBeNull();
  });

  it('块内任意帧都返回该块画面，边界含头不含尾', () => {
    const props = makeProps(chunks);
    expect(frameAtFrame(props, 0)?.background).toBe('a');
    expect(frameAtFrame(props, 9)?.background).toBe('a');
    expect(frameAtFrame(props, 10)?.background).toBe('b');
    expect(frameAtFrame(props, 11)?.background).toBe('c');
    expect(frameAtFrame(props, 39)?.background).toBe('c');
  });

  it('越界帧钳到首 / 末画面，保证任意导出帧都有确定状态', () => {
    const props = makeProps(chunks);
    expect(frameAtFrame(props, -5)?.background).toBe('a');
    expect(frameAtFrame(props, 0)?.background).toBe('a');
    expect(frameAtFrame(props, 40)?.background).toBe('c');
    expect(frameAtFrame(props, 9999)?.background).toBe('c');
    expect(frameAtFrame(props, Number.NaN)?.background).toBe('a');
  });

  it('帧块之间有空隙时取最接近的前一个块，不返回 null', () => {
    const props = makeProps([
      { fromFrame: 0, toFrame: 5, frame: makeFrame('a') },
      { fromFrame: 8, toFrame: 12, frame: makeFrame('b') },
    ]);
    expect(frameAtFrame(props, 6)?.background).toBe('a');
    expect(frameAtFrame(props, 7)?.background).toBe('a');
    expect(frameAtFrame(props, 8)?.background).toBe('b');
  });
});
