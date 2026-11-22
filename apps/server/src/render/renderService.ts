import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import {
  qualityById,
  renderConfigSchema,
  renderJobErrorSchema,
  type RenderConfig,
  type RenderJob,
  type RenderJobStage,
  type RenderRequest,
  type RenderScope,
  type RenderValidation,
} from '@animation/shared';
import { appConfig } from '../config';
import { AppError, errors } from '../errors';
import type { AssetService } from '../services/assetService';
import type { StageService } from '../services/stageService';
import { resolveProjectDir } from '../utils/projectPaths';
import { buildCompositionProps } from './buildCompositionProps';
import { COMPOSITION_ID } from './composition/props';
import { muxAudio } from './muxAudio';
import { pickExportScenes } from './sceneSpans';
import { validateRenderInput } from './renderValidation';

/**
 * 渲染任务（架构 5.8 / PRD 14）。
 *
 * 状态机严格对应 PRD 14 的导出步骤：preparing → rendering → muxing → completed / failed。
 * 进度只在 Remotion 给出真实 `onProgress` 时写入，准备与音频合成阶段为 null，
 * 界面显示「进行中」而不是伪造百分比（AGENTS 第 10 节禁止伪造渲染进度）。
 */

interface RenderJobRow {
  id: string;
  project_id: string;
  stage: string;
  progress: number | null;
  frames_rendered: number;
  total_frames: number;
  message: string;
  config: string;
  output_file: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RenderServiceDeps {
  db: DatabaseSync;
  projectsDir: string;
  assets: AssetService;
  stage: StageService;
  /** Remotion 入口；测试可覆盖。 */
  entryPoint?: string;
  browserExecutable?: string | null;
  ffmpegPath?: string;
}

/** 依次探测显式配置、Chrome、Edge；找不到时返回 null 交由 Remotion 自行处理。 */
export function findBrowserExecutable(): string | null {
  const candidates = [
    process.env.ANIMATION_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter((item): item is string => Boolean(item));
  return candidates.find((item) => existsSync(item)) ?? null;
}

export class RenderService {
  private readonly db: DatabaseSync;
  private readonly projectsDir: string;
  private readonly entryPoint: string;
  private readonly browserExecutable: string | null;
  private readonly ffmpegPath?: string;
  /** bundle 只依赖静态 composition，进程内复用，避免每次导出重复打包。 */
  private bundlePromise: Promise<string> | null = null;

  constructor(
    private readonly deps: RenderServiceDeps,
  ) {
    this.db = deps.db;
    this.projectsDir = path.resolve(deps.projectsDir);
    this.entryPoint =
      deps.entryPoint ?? path.join(appConfig.repoRoot, 'apps', 'server', 'src', 'render', 'composition', 'index.tsx');
    this.browserExecutable =
      deps.browserExecutable === undefined ? findBrowserExecutable() : deps.browserExecutable;
    this.ffmpegPath = deps.ffmpegPath;

    // 服务重启后，上次未完成的任务已不可能继续，如实标记为失败而不是永远「渲染中」。
    this.db
      .prepare(
        `UPDATE render_jobs
            SET stage = 'failed',
                progress = NULL,
                message = ?,
                error = ?,
                updated_at = ?
          WHERE stage IN ('preparing', 'rendering', 'muxing')`,
      )
      .run(
        '服务重启导致导出中断，请重新导出。',
        JSON.stringify({ code: 'RENDER_FAILED', message: '服务重启导致导出中断，请重新导出。' }),
        new Date().toISOString(),
      );
  }

  /** PRD 14 步骤 1-5 的只读检查，不写盘、不改动项目数据。 */
  validate(projectId: string, exportFps?: number, scope?: RenderScope): RenderValidation {
    return validateRenderInput(projectId, {
      projectsDir: this.projectsDir,
      assets: this.deps.assets,
      ...(exportFps ? { exportFps } : {}),
      ...(scope ? { scope } : {}),
    });
  }

  createJob(request: RenderRequest): RenderJob {
    const config = renderConfigSchema.parse(request.config);
    const running = this.db
      .prepare(
        `SELECT id FROM render_jobs
          WHERE project_id = ? AND stage IN ('preparing', 'rendering', 'muxing')
          LIMIT 1`,
      )
      .get(request.projectId);
    if (running) {
      throw errors.validation('该项目已有导出任务正在进行，请等待完成后再试。');
    }

    const validation = this.validate(request.projectId, config.fps, config.scope);
    if (!validation.canRender) {
      const failed = validation.checks.filter((item) => item.blocking && !item.ok);
      throw errors.validation(
        `无法导出：${failed.map((item) => `${item.label}（${item.detail}）`).join('；')}`,
      );
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO render_jobs
          (id, project_id, stage, progress, frames_rendered, total_frames, message, config, output_file, error, created_at, updated_at)
         VALUES (?, ?, 'preparing', NULL, 0, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        request.projectId,
        validation.totalFrames,
        '已加入导出队列。',
        JSON.stringify(config),
        now,
        now,
      );

    // 后台执行，不阻塞 HTTP 请求；失败在 run 内部落库，不静默回退。
    void this.run(id, request.projectId, config, validation).catch((cause: unknown) => {
      console.error('[animation-video] 导出任务异常：', cause);
    });

    return this.getJob(id);
  }

  getJob(id: string): RenderJob {
    const row = this.db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(id) as
      | RenderJobRow
      | undefined;
    if (!row) throw errors.notFound('导出任务不存在或已被删除。');
    return this.toJob(row);
  }

  /** 已完成的导出文件；路径严格限制在项目目录内，拒绝路径穿越。 */
  getJobFile(id: string): { absolutePath: string; fileName: string } {
    const job = this.getJob(id);
    if (job.stage !== 'completed' || !job.outputFile) {
      throw errors.validation('导出尚未完成，暂无可下载的文件。');
    }
    const dir = resolveProjectDir(this.projectsDir, job.projectId);
    const absolute = path.resolve(dir, job.outputFile);
    if (!absolute.startsWith(path.resolve(dir) + path.sep)) {
      throw errors.validation('非法的导出文件路径。');
    }
    if (!existsSync(absolute)) {
      throw errors.notFound('导出文件不存在，可能已被移动或删除。');
    }
    return { absolutePath: absolute, fileName: path.basename(absolute) };
  }

  private async run(
    id: string,
    projectId: string,
    config: RenderConfig,
    validation: RenderValidation,
  ): Promise<void> {
    const dir = resolveProjectDir(this.projectsDir, projectId);
    const outputFile = `${config.outputDir}/${config.fileName}.mp4`;
    const outputPath = path.join(dir, config.outputDir, `${config.fileName}.mp4`);
    const silentPath = path.join(dir, config.outputDir, `.silent-${id}.mp4`);

    try {
      this.patch(id, { stage: 'preparing', message: '正在读取项目与素材…', progress: null, framesRendered: 0 });
      const stage = this.deps.stage.getStage(projectId);
      const scenes = pickExportScenes(stage, config.scope);
      if (scenes.length === 0) throw errors.render('没有可导出的场景，请先导入剧本草稿。');
      // 时间轴与帧数必须同源：若校验后场景被改动，如实失败而不是渲染出不一致的视频。
      const spans = validation.sceneSpans;
      if (
        spans.length !== scenes.length ||
        spans.some((span, index) => span.sceneId !== scenes[index]?.id)
      ) {
        throw errors.render('导出场景已变化，请重新打开导出弹窗后再导出。');
      }

      const { props, audioTracks, frameChunkCount, propsBytes } = buildCompositionProps({
        projectDir: dir,
        assets: this.deps.assets,
        scenes,
        spans,
        config,
        totalFrames: validation.totalFrames,
      });
      // 真实测量值，仅用于运行日志；UI 进度仍只取 Remotion onProgress。
      console.info(
        `[animation-video] 导出画面编译：${frameChunkCount} 个帧块 / ${validation.totalFrames} 帧，inputProps ${(propsBytes / 1024).toFixed(1)} KB`,
      );
      mkdirSync(path.join(dir, config.outputDir), { recursive: true });

      this.patch(id, { stage: 'rendering', message: '正在准备渲染环境…', progress: null });
      const serveUrl = await this.getBundle();
      const inputProps = props as unknown as Record<string, unknown>;
      const browserOptions = this.browserExecutable
        ? { browserExecutable: this.browserExecutable, chromeMode: 'chrome-for-testing' as const }
        : {};

      const compositions = await getCompositions(serveUrl, { inputProps, ...browserOptions });
      const composition = compositions.find((item) => item.id === COMPOSITION_ID);
      if (!composition) throw errors.render('未找到导出画面配置，渲染已终止。');

      this.patch(id, {
        stage: 'rendering',
        message: `正在逐帧渲染 0/${validation.totalFrames}…`,
        progress: 0,
      });

      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: silentPath,
        inputProps,
        crf: qualityById(config.quality).crf,
        muted: true,
        overwrite: true,
        concurrency: Math.max(1, Math.min(4, cpus().length)),
        timeoutInMilliseconds: 120_000,
        onProgress: ({ progress, renderedFrames }) => {
          this.patch(id, {
            stage: 'rendering',
            progress: Math.min(1, Math.max(0, progress)),
            framesRendered: renderedFrames,
            message: `正在逐帧渲染 ${renderedFrames}/${validation.totalFrames}…`,
          });
        },
        ...browserOptions,
      });

      this.patch(id, {
        stage: 'muxing',
        message: audioTracks.length > 0 ? '正在合成音频…' : '正在封装视频（无音频）…',
        progress: null,
        framesRendered: validation.totalFrames,
      });

      await muxAudio({
        silentVideo: silentPath,
        outputFile: outputPath,
        audioTracks,
        durationSeconds: validation.totalFrames / config.fps,
        ...(this.ffmpegPath ? { ffmpegPath: this.ffmpegPath } : {}),
      });

      rmSync(silentPath, { force: true });
      const size = statSync(outputPath).size;
      if (size <= 0) throw errors.render('导出文件为空，渲染已终止。');

      this.patch(id, {
        stage: 'completed',
        progress: 1,
        framesRendered: validation.totalFrames,
        message: `导出完成，文件大小 ${(size / 1024 / 1024).toFixed(1)} MB。`,
        outputFile,
        error: null,
      });
    } catch (cause) {
      rmSync(silentPath, { force: true });
      const appError =
        cause instanceof AppError
          ? cause
          : errors.render(cause instanceof Error ? cause.message : '导出失败，请重试。', cause);
      console.error('[animation-video] 导出失败：', cause);
      this.patch(id, {
        stage: 'failed',
        progress: null,
        message: appError.message,
        error: { code: appError.code, message: appError.message },
      });
    }
  }

  private getBundle(): Promise<string> {
    if (!this.bundlePromise) {
      this.bundlePromise = bundle({ entryPoint: this.entryPoint }).catch((cause: unknown) => {
        // 打包失败后允许下次重试，不缓存失败结果。
        this.bundlePromise = null;
        throw errors.render('渲染环境打包失败，请检查 Remotion 依赖是否完整。', cause);
      });
    }
    return this.bundlePromise;
  }

  private patch(
    id: string,
    patch: {
      stage?: RenderJobStage;
      progress?: number | null;
      framesRendered?: number;
      message?: string;
      outputFile?: string | null;
      error?: { code: string; message: string } | null;
    },
  ): void {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    if (patch.stage !== undefined) {
      sets.push('stage = ?');
      values.push(patch.stage);
    }
    if (patch.progress !== undefined) {
      sets.push('progress = ?');
      values.push(patch.progress);
    }
    if (patch.framesRendered !== undefined) {
      sets.push('frames_rendered = ?');
      values.push(patch.framesRendered);
    }
    if (patch.message !== undefined) {
      sets.push('message = ?');
      values.push(patch.message);
    }
    if (patch.outputFile !== undefined) {
      sets.push('output_file = ?');
      values.push(patch.outputFile);
    }
    if (patch.error !== undefined) {
      sets.push('error = ?');
      values.push(patch.error ? JSON.stringify(patch.error) : null);
    }
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE render_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  private toJob(row: RenderJobRow): RenderJob {
    return {
      id: row.id,
      projectId: row.project_id,
      stage: row.stage as RenderJobStage,
      progress: row.progress,
      framesRendered: row.frames_rendered,
      totalFrames: row.total_frames,
      message: row.message,
      config: renderConfigSchema.parse(JSON.parse(row.config) as unknown),
      outputFile: row.output_file,
      error: row.error
        ? renderJobErrorSchema.parse(JSON.parse(row.error) as unknown)
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
