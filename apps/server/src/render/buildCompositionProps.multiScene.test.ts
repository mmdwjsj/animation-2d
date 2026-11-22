import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_RENDER_CONFIG,
  PROJECT_DEFAULTS,
  resampleFrames,
  stageDataSchema,
  type StageData,
} from '@animation/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { AssetService } from '../services/assetService';
import { buildCompositionProps } from './buildCompositionProps';
import { frameAtFrame } from './composition/props';
import { buildSceneSpans, totalProjectFrames } from './sceneSpans';

const apps: FastifyInstance[] = [];
const roots: string[] = [];

const TWO_SCENE_SCRIPT = [
  '# 场景：客厅',
  '# 角色：老王、小李',
  '老王（坐着）：你回来了？',
  '小李（站着）：我的蛋糕呢？',
  '',
  '# 场景：厨房',
  '# 角色：老王、小李',
  '老王：我在这儿。',
  '小李：原来如此。',
].join('\n');

async function createFixture(): Promise<{ stage: StageData; projectDir: string; assets: AssetService }> {
  const root = mkdtempSync(path.join(tmpdir(), 'animation-props-multi-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const app = await buildApp({
    dataDir,
    renderEntryPoint: path.join(root, 'missing-entry.tsx'),
    renderBrowserExecutable: null,
  });
  apps.push(app);

  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: '拼接画面编译验收' },
  });
  const projectId = created.json().data.id as string;

  const parsed = await app.inject({
    method: 'POST',
    url: '/api/scripts/parse',
    payload: { text: TWO_SCENE_SCRIPT },
  });
  const draft = parsed.json().data.draft;
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/draft/import`,
    payload: { draft, confirmed: true },
  });
  await app.inject({
    method: 'POST',
    url: '/api/tts/generate',
    payload: { projectId, providerId: 'local-tone', confirmed: true },
  });

  const projectDir = path.join(dataDir, 'projects', projectId);
  const stage = stageDataSchema.parse(
    JSON.parse(readFileSync(path.join(projectDir, 'animation', 'animation.json'), 'utf8')) as unknown,
  );
  return { stage, projectDir, assets: new AssetService() };
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('多场景拼接 · Remotion 画面指令编译', () => {
  it('逐帧切换背景、字幕，音频按全局时间轴偏移', async () => {
    const { stage, projectDir, assets } = await createFixture();
    expect(stage.scenes).toHaveLength(2);
    const spans = buildSceneSpans(stage.scenes);
    const totalFrames = resampleFrames(totalProjectFrames(spans), DEFAULT_RENDER_CONFIG.fps);
    const switchFrame = spans[1].startFrame;

    const { props, audioTracks } = buildCompositionProps({
      projectDir,
      assets,
      scenes: stage.scenes,
      spans,
      config: DEFAULT_RENDER_CONFIG,
      totalFrames,
    });

    /** 帧块按当前帧还原出的画面，等价于旧的逐帧数组。 */
    const at = (frame: number) => {
      const value = frameAtFrame(props, frame);
      if (!value) throw new Error(`帧 ${frame} 没有可用的画面指令`);
      return value;
    };

    expect(props.durationInFrames).toBe(totalFrames);
    expect(props.width).toBe(1080);
    expect(props.height).toBe(1920);

    // 两个场景的背景都内联进 assets，且逐帧在切换点换图。
    expect(props.assets['scene-living-room']).toBeTruthy();
    expect(props.assets['scene-kitchen']).toBeTruthy();
    expect(at(0).background).toBe('scene-living-room');
    expect(at(switchFrame - 1).background).toBe('scene-living-room');
    expect(at(switchFrame).background).toBe('scene-kitchen');
    expect(at(totalFrames - 1).background).toBe('scene-kitchen');

    // 切换后第一帧应显示第二场景第一句的字幕，而不是沿用上一场景。
    expect(at(switchFrame).subtitle?.text).toBe('我在这儿。');
    expect(at(switchFrame - 1).subtitle?.text).not.toBe('我在这儿。');

    // 4 句音频全部登记，且第二场景的音频落在全局偏移之后。
    expect(audioTracks).toHaveLength(4);
    expect(audioTracks.every((track) => existsSync(track.file))).toBe(true);
    expect(audioTracks[0].startMs).toBeCloseTo(0, 6);
    const secondSceneAudio = audioTracks.slice(2);
    expect(secondSceneAudio[0].startMs).toBeCloseTo(
      (switchFrame / PROJECT_DEFAULTS.fps) * 1000,
      6,
    );
    for (let i = 1; i < audioTracks.length; i += 1) {
      expect(audioTracks[i].startMs).toBeGreaterThan(audioTracks[i - 1].startMs);
    }
  });

  it('scenes 与 spans 不一致时明确报错，不渲染错误画面', async () => {
    const { stage, projectDir, assets } = await createFixture();
    expect(() =>
      buildCompositionProps({
        projectDir,
        assets,
        scenes: stage.scenes,
        spans: buildSceneSpans(stage.scenes).slice(0, 1),
        config: DEFAULT_RENDER_CONFIG,
        totalFrames: 10,
      }),
    ).toThrow(/时间轴不一致/);
  });

  it('帧块合并连续相同画面，inputProps 体积明显小于逐帧方案', async () => {
    const { stage, projectDir, assets } = await createFixture();
    const spans = buildSceneSpans(stage.scenes);
    const totalFrames = resampleFrames(totalProjectFrames(spans), DEFAULT_RENDER_CONFIG.fps);
    const { props, frameChunkCount, propsBytes } = buildCompositionProps({
      projectDir,
      assets,
      scenes: stage.scenes,
      spans,
      config: DEFAULT_RENDER_CONFIG,
      totalFrames,
    });

    expect(frameChunkCount).toBe(props.frameChunks.length);
    expect(frameChunkCount).toBeLessThan(totalFrames);
    expect(propsBytes).toBeGreaterThan(0);
    expect(props.frameChunks[0].fromFrame).toBe(0);
    expect(props.frameChunks.at(-1)?.toFrame).toBe(totalFrames);
    for (let index = 1; index < props.frameChunks.length; index += 1) {
      expect(props.frameChunks[index].fromFrame).toBe(props.frameChunks[index - 1].toFrame);
    }
    for (const chunk of props.frameChunks) {
      expect(chunk.toFrame).toBeGreaterThan(chunk.fromFrame);
      expect(frameAtFrame(props, chunk.fromFrame)).toBe(chunk.frame);
      expect(frameAtFrame(props, chunk.toFrame - 1)).toBe(chunk.frame);
    }

    // 真实体积对比：展开成逐帧数组后 JSON 明显更大，说明帧块确实压缩了 inputProps。
    const expanded = props.frameChunks.flatMap((chunk) =>
      Array.from({ length: chunk.toFrame - chunk.fromFrame }, () => chunk.frame),
    );
    expect(JSON.stringify(props.frameChunks).length).toBeLessThan(
      JSON.stringify(expanded).length,
    );
  });

  it('配置进入转场时边界前 N 帧叠加上一场景定格并线性淡入', async () => {
    const { stage, projectDir, assets } = await createFixture();
    const scenes = stage.scenes.map((scene, index) =>
      index === 1 ? { ...scene, transition: { type: 'fade' as const, durationFrames: 9 } } : scene,
    );
    const spans = buildSceneSpans(scenes);
    const totalFrames = resampleFrames(totalProjectFrames(spans), DEFAULT_RENDER_CONFIG.fps);
    const switchFrame = spans[1].startFrame;
    const { props } = buildCompositionProps({
      projectDir,
      assets,
      scenes,
      spans,
      config: DEFAULT_RENDER_CONFIG,
      totalFrames,
    });
    const at = (frame: number) => frameAtFrame(props, frame);

    expect(at(switchFrame - 1)?.transition).toBeFalsy();
    expect(at(switchFrame)?.background).toBe('scene-kitchen');
    expect(at(switchFrame)?.transition?.previous.background).toBe('scene-living-room');
    expect(at(switchFrame)?.transition?.opacity).toBeCloseTo(1 / 9, 6);
    expect(at(switchFrame + 1)?.transition?.opacity).toBeCloseTo(2 / 9, 6);
    expect(at(switchFrame + 8)?.transition?.opacity).toBe(1);
    expect(at(switchFrame + 9)?.transition).toBeFalsy();
    // 转场不插入额外帧，总时长与音频偏移保持不变。
    expect(props.durationInFrames).toBe(totalFrames);
    expect(switchFrame).toBe(buildSceneSpans(stage.scenes)[1].startFrame);
  });

  it('仅导出单场景时不产生任何转场帧', async () => {
    const { stage, projectDir, assets } = await createFixture();
    const scenes = [
      {
        ...stage.scenes[1],
        transition: { type: 'fade' as const, durationFrames: 9 },
      },
    ];
    const spans = buildSceneSpans(scenes);
    const totalFrames = resampleFrames(totalProjectFrames(spans), DEFAULT_RENDER_CONFIG.fps);
    const { props } = buildCompositionProps({
      projectDir,
      assets,
      scenes,
      spans,
      config: DEFAULT_RENDER_CONFIG,
      totalFrames,
    });
    expect(props.frameChunks.every((chunk) => !chunk.frame.transition)).toBe(true);
  });
});
