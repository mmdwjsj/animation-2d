import {
  RENDER_FPS_OPTIONS,
  RENDER_QUALITIES,
  RENDER_RESOLUTIONS,
  RENDER_SCOPE_LABELS,
  RENDER_SCOPES,
  RENDER_STAGE_LABELS,
  type RenderJob,
  type RenderQualityId,
  type RenderResolutionId,
  type RenderScope,
  type RenderValidation,
} from '@animation/shared';
import { useEffect, useMemo, useState } from 'react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { getErrorMessage, renderApi } from '../../lib/api';

/**
 * 导出视频弹窗（PRD 7.2 / 14）。
 *
 * 严格按 PRD 14 的导出步骤呈现：先做只读检查（步骤 1-5），再创建任务；
 * 任务状态由服务端真实阶段驱动（准备中 / 渲染中 / 音频合成中 / 完成 / 失败），
 * 进度只在拿到 Remotion 真实 onProgress 时显示百分比，否则显示「进行中」，
 * 绝不伪造进度条（AGENTS 第 10 节）。
 */
interface ExportDialogProps {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  /** 导出成功后通知工作台（用于提示或后续统计）。 */
  onCompleted?: (job: RenderJob) => void;
}

const FILE_NAME_PATTERN = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,60}$/;
const jobStorageKey = (projectId: string) => `animation-render-job:${projectId}`;

export default function ExportDialog({
  open,
  projectId,
  projectName,
  onClose,
  onCompleted,
}: ExportDialogProps) {
  const [fileName, setFileName] = useState(projectName || 'animation');
  const [resolution, setResolution] = useState<RenderResolutionId>('1080x1920');
  const [fps, setFps] = useState<(typeof RENDER_FPS_OPTIONS)[number]>(30);
  const [quality, setQuality] = useState<RenderQualityId>('standard');
  const [scope, setScope] = useState<RenderScope>('all');
  const [validation, setValidation] = useState<RenderValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileNameValid = FILE_NAME_PATTERN.test(fileName);
  const running = job !== null && ['preparing', 'rendering', 'muxing'].includes(job.stage);

  // 打开时：重置错误，并尝试恢复本项目上次的导出任务（关掉弹窗也不会丢进度）。
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFileName(projectName || 'animation');
    const stored = window.localStorage.getItem(jobStorageKey(projectId));
    if (!stored) {
      setJob(null);
      return;
    }
    let cancelled = false;
    void renderApi
      .get(stored)
      .then((restored) => {
        if (!cancelled) setJob(restored);
      })
      .catch(() => {
        window.localStorage.removeItem(jobStorageKey(projectId));
        if (!cancelled) setJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, projectName]);

  // 只读检查：配置变化时重新评估可导出性与总帧数（不写盘）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setValidating(true);
    void renderApi
      .validate(projectId, fps, scope)
      .then((result) => {
        if (!cancelled) setValidation(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(getErrorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, fps, scope]);

  // 轮询真实任务状态；完成后停止。
  useEffect(() => {
    const jobId = job?.id;
    if (!jobId || !running) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void renderApi
        .get(jobId)
        .then((next) => {
          if (cancelled) return;
          setJob(next);
          if (next.stage === 'completed') onCompleted?.(next);
        })
        .catch((cause) => {
          if (!cancelled) setError(getErrorMessage(cause));
        });
    }, 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.id, running, onCompleted]);

  const estimatedSeconds = useMemo(() => {
    if (!validation) return 0;
    return validation.totalFrames / fps;
  }, [validation, fps]);

  const resolutionLabel = useMemo(
    () => RENDER_RESOLUTIONS.find((item) => item.id === resolution)?.label ?? resolution,
    [resolution],
  );

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const next = await renderApi.create({
        projectId,
        config: { fileName, resolution, fps, quality, outputDir: 'renders', scope },
      });
      window.localStorage.setItem(jobStorageKey(projectId), next.id);
      setJob(next);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setStarting(false);
    }
  };

  const reset = () => {
    window.localStorage.removeItem(jobStorageKey(projectId));
    setJob(null);
    setError(null);
  };

  const canStart =
    fileNameValid && validation?.canRender === true && !starting && !running;

  return (
    <Modal
      open={open}
      title="导出视频"
      widthClass="w-[640px]"
      onClose={onClose}
      closeOnOverlayClick={!running}
      footer={
        <>
          {job && !running ? (
            <Button variant="ghost" onClick={reset}>
              再导出一次
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {running ? '后台继续并关闭' : '关闭'}
          </Button>
          {job?.stage === 'completed' ? (
            <a
              href={renderApi.fileUrl(job.id)}
              download
              className="inline-flex h-9 items-center justify-center rounded bg-accent px-3.5 text-sm font-medium text-white hover:opacity-90"
            >
              下载 MP4
            </a>
          ) : (
            <Button variant="primary" loading={starting} disabled={!canStart} onClick={start}>
              {job?.stage === 'failed' ? '重新导出' : '开始导出'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div className="rounded border border-danger px-3 py-2 text-xs text-danger">{error}</div>
        )}

        {/* 导出配置（PRD 14：文件名、分辨率、帧率、输出目录、视频质量） */}
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-muted">导出配置</h3>
          <label className="flex items-center gap-3 text-xs text-muted">
            <span className="w-16 shrink-0">文件名称</span>
            <input
              aria-label="导出文件名称"
              value={fileName}
              disabled={running}
              onChange={(event) => setFileName(event.target.value)}
              className={`h-8 flex-1 rounded border bg-page px-2 text-sm text-ink ${
                fileNameValid ? 'border-line' : 'border-danger'
              }`}
            />
            <span className="text-[11px] text-muted">.mp4</span>
          </label>
          {!fileNameValid && (
            <p className="-mt-1 pl-[76px] text-[11px] text-danger">
              只能包含中英文、数字、下划线和连字符，最多 60 个字符。
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="w-12 shrink-0">分辨率</span>
              <select
                aria-label="导出分辨率"
                value={resolution}
                disabled={running}
                onChange={(event) => setResolution(event.target.value as RenderResolutionId)}
                className="h-8 flex-1 rounded border border-line bg-page px-2 text-sm text-ink"
              >
                {RENDER_RESOLUTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="w-12 shrink-0">帧率</span>
              <select
                aria-label="导出帧率"
                value={fps}
                disabled={running}
                onChange={(event) =>
                  setFps(Number(event.target.value) as (typeof RENDER_FPS_OPTIONS)[number])
                }
                className="h-8 flex-1 rounded border border-line bg-page px-2 text-sm text-ink"
              >
                {RENDER_FPS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item} FPS
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="w-12 shrink-0">质量</span>
              <select
                aria-label="导出质量"
                value={quality}
                disabled={running}
                onChange={(event) => setQuality(event.target.value as RenderQualityId)}
                className="h-8 flex-1 rounded border border-line bg-page px-2 text-sm text-ink"
              >
                {RENDER_QUALITIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="w-12 shrink-0">范围</span>
              <select
                aria-label="导出范围"
                data-testid="export-scope"
                value={scope}
                disabled={running}
                onChange={(event) => setScope(event.target.value as RenderScope)}
                className="h-8 flex-1 rounded border border-line bg-page px-2 text-sm text-ink"
              >
                {RENDER_SCOPES.map((item) => (
                  <option key={item} value={item}>
                    {RENDER_SCOPE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <div className="col-span-2 flex items-center gap-2 text-xs text-muted">
              <span className="w-12 shrink-0">输出目录</span>
              <span
                className="truncate text-ink"
                title="导出文件保存在项目目录内，不写入系统其他位置"
              >
                data/projects/…/renders
              </span>
            </div>
          </div>
          <p className="text-[11px] text-muted">
            {resolutionLabel} · {fps} FPS · H.264 + AAC · 预计 {estimatedSeconds.toFixed(1)} 秒
            {validation ? `（${validation.totalFrames} 帧）` : ''}
          </p>
        </section>

        {/* PRD 14 步骤 1-5 检查结果 */}
        <section data-testid="export-checks" className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted">
            导出前检查 {validating ? '（检查中…）' : ''}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {(validation?.checks ?? []).map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 shrink-0 ${
                    item.ok ? 'text-emerald-400' : item.blocking ? 'text-danger' : 'text-amber-400'
                  }`}
                >
                  {item.ok ? '✓' : item.blocking ? '✕' : '!'}
                </span>
                <span className={item.ok ? 'text-muted' : 'text-ink'}>
                  <span className="text-ink">{item.label}</span>：{item.detail}
                </span>
              </li>
            ))}
          </ul>
          {validation?.warnings.length ? (
            <ul className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {validation.warnings.map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* 多场景拼接顺序：直接来自服务端只读校验的时间轴，不前端臆造 */}
        {validation && validation.sceneCount > 0 ? (
          <section data-testid="export-scene-spans" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted">
              场景拼接顺序（共 {validation.sceneCount} 个 · {validation.projectDurationFrames} 项目帧）
            </h3>
            <ol className="flex flex-col gap-1 rounded border border-line bg-page px-3 py-2">
              {validation.sceneSpans.map((span, index) => (
                <li
                  key={span.sceneId}
                  data-testid="export-scene-span"
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="truncate text-ink">
                    {index + 1}. {span.sceneName}
                  </span>
                  <span className="shrink-0 text-muted">
                    帧 {span.startFrame}–{span.endFrame - 1} · {span.durationFrames} 帧
                  </span>
                </li>
              ))}
            </ol>
            {validation.sceneTransitions.length > 0 ? (
              <ul
                data-testid="export-transitions"
                className="flex flex-col gap-1 rounded border border-line bg-page px-3 py-2 text-[11px]"
              >
                {validation.sceneTransitions.map((transition, index) => (
                  <li
                    key={`${transition.fromSceneName}-${transition.toSceneName}-${index}`}
                    data-testid="export-transition"
                  >
                    <span className="text-ink">
                      {transition.fromSceneName} → {transition.toSceneName}
                    </span>
                    <span className="text-muted">
                      {' '}· 交叉淡化 {transition.durationFrames} 项目帧（{transition.exportFrames} 导出帧）
                    </span>
                  </li>
                ))}
                <li className="text-muted">
                  转场叠加在场景边界，不增加视频时长；音频按原全局时间轴播放。
                </li>
              </ul>
            ) : validation.sceneCount > 1 ? (
              <p className="text-[11px] text-muted">
                按以上顺序无缝拼接，切换场景时自动换背景，配音按全局时间轴对齐。
              </p>
            ) : null}
          </section>
        ) : null}

        {/* 真实任务状态 */}
        {job && (
          <section className="flex flex-col gap-2 rounded border border-line bg-page px-3 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink">
                状态：{RENDER_STAGE_LABELS[job.stage]}
                {running && job.progress === null ? '（进行中…）' : ''}
              </span>
              <span className="text-muted" data-testid="render-progress">
                {job.progress !== null ? `${Math.round(job.progress * 100)}%` : '—'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-subtle">
              <div
                className={`h-full rounded bg-accent transition-[width] duration-300 ${
                  running && job.progress === null ? 'animate-pulse' : ''
                }`}
                style={{ width: `${job.progress !== null ? job.progress * 100 : running ? 30 : 0}%` }}
              />
            </div>
            <p className="text-[11px] text-muted">{job.message}</p>
            <p className="text-[11px] text-muted">
              帧 {job.framesRendered} / {job.totalFrames}
              {job.outputFile ? ` · ${job.outputFile}` : ''}
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}
