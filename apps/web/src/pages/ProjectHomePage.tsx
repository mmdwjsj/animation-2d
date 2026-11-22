import { PROJECT_DEFAULTS, PROJECTS_ROOT_DISPLAY } from '@animation/shared';
import type { Project } from '@animation/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { getErrorMessage } from '../lib/api';
import { formatRelativeTime } from '../lib/format';
import { selectVisibleProjects, useProjectsStore } from '../stores/projectsStore';

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; project: Project }
  | { kind: 'delete'; project: Project };

const NAME_MAX_LENGTH = 80;

export default function ProjectHomePage() {
  const navigate = useNavigate();
  const projects = useProjectsStore((state) => state.projects);
  const status = useProjectsStore((state) => state.status);
  const error = useProjectsStore((state) => state.error);
  const keyword = useProjectsStore((state) => state.keyword);
  const sortBy = useProjectsStore((state) => state.sortBy);
  const setKeyword = useProjectsStore((state) => state.setKeyword);
  const setSortBy = useProjectsStore((state) => state.setSortBy);
  const load = useProjectsStore((state) => state.load);
  const createProject = useProjectsStore((state) => state.createProject);
  const renameProject = useProjectsStore((state) => state.renameProject);
  const deleteProject = useProjectsStore((state) => state.deleteProject);

  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const visibleProjects = useMemo(
    () => selectVisibleProjects(projects, keyword, sortBy),
    [projects, keyword, sortBy],
  );

  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpenId]);

  const openCreate = () => {
    setFormName('');
    setFormError(null);
    setDialog({ kind: 'create' });
  };
  const openRename = (project: Project) => {
    setFormName(project.name);
    setFormError(null);
    setMenuOpenId(null);
    setDialog({ kind: 'rename', project });
  };
  const openDelete = (project: Project) => {
    setFormError(null);
    setMenuOpenId(null);
    setDialog({ kind: 'delete', project });
  };
  const closeDialog = () => {
    if (submitting) return;
    setDialog({ kind: 'none' });
    setFormError(null);
  };

  const submit = async (): Promise<void> => {
    if (submitting || dialog.kind === 'none') return;
    const trimmed = formName.trim();

    if (dialog.kind === 'create' || dialog.kind === 'rename') {
      if (!trimmed) {
        setFormError('项目名称不能为空');
        return;
      }
      if (trimmed.length > NAME_MAX_LENGTH) {
        setFormError(`项目名称不能超过 ${NAME_MAX_LENGTH} 个字符`);
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);
    try {
      if (dialog.kind === 'create') await createProject(trimmed);
      else if (dialog.kind === 'rename') await renameProject(dialog.project, trimmed);
      else await deleteProject(dialog.project.id);
      setDialog({ kind: 'none' });
    } catch (cause) {
      setFormError(getErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = status === 'idle' || status === 'loading';
  const dialogTitle =
    dialog.kind === 'create'
      ? '新建项目'
      : dialog.kind === 'rename'
        ? '重命名项目'
        : dialog.kind === 'delete'
          ? '删除项目'
          : '';

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-7">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">我的动画项目</h1>
          <p className="mt-1.5 text-sm text-muted">
            创建项目，按固定格式写剧本，再在动画工作台里完成制作。
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          ＋ 新建项目
        </Button>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <input
          className="field-input max-w-[320px]"
          placeholder="搜索项目名称"
          aria-label="搜索项目"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <select
          className="field-input max-w-[160px]"
          aria-label="排序方式"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value === 'name' ? 'name' : 'updated')}
        >
          <option value="updated">最近修改</option>
          <option value="name">名称</option>
        </select>
        <span className="text-xs text-muted">共 {visibleProjects.length} 个项目</span>
      </div>

      <div className="mt-6">
        {isLoading && (
          <div className="grid grid-cols-[repeat(auto-fill,240px)] gap-4">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-[180px] w-[240px] animate-pulse rounded-lg border border-line bg-panel"
              />
            ))}
          </div>
        )}

        {!isLoading && status === 'error' && (
          <div className="panel-surface rounded-lg p-8 text-center">
            <p className="text-sm text-ink">无法加载项目列表</p>
            <p className="mt-2 text-xs text-muted">{error ?? '请检查后端服务是否已启动。'}</p>
            <Button className="mt-4" onClick={() => void load()}>
              重试
            </Button>
          </div>
        )}

        {!isLoading && status !== 'error' && projects.length === 0 && (
          <div className="flex h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel">
            <p className="text-sm text-ink">还没有动画项目，创建一个项目开始制作。</p>
            <Button variant="primary" className="mt-4" onClick={openCreate}>
              新建项目
            </Button>
          </div>
        )}

        {!isLoading && status !== 'error' && projects.length > 0 && visibleProjects.length === 0 && (
          <div className="flex h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel">
            <p className="text-sm text-ink">没有找到匹配「{keyword}」的项目</p>
            <Button className="mt-4" onClick={() => setKeyword('')}>
              清除搜索
            </Button>
          </div>
        )}

        {!isLoading && status !== 'error' && visibleProjects.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,240px)] gap-4">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                menuOpen={menuOpenId === project.id}
                onOpen={() => navigate(`/projects/${project.id}`)}
                onToggleMenu={() => setMenuOpenId(menuOpenId === project.id ? null : project.id)}
                onRename={() => openRename(project)}
                onDelete={() => openDelete(project)}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={dialog.kind !== 'none'}
        title={dialogTitle}
        onClose={closeDialog}
        closeOnOverlayClick={dialog.kind !== 'delete'}
        footer={
          <>
            <Button onClick={closeDialog} disabled={submitting}>
              取消
            </Button>
            <Button
              variant={dialog.kind === 'delete' ? 'danger' : 'primary'}
              loading={submitting}
              onClick={() => void submit()}
            >
              {dialog.kind === 'create'
                ? '创建项目'
                : dialog.kind === 'rename'
                  ? '保存名称'
                  : '确认删除'}
            </Button>
          </>
        }
      >
        {dialog.kind === 'delete' ? (
          <div>
            <p className="text-sm leading-7 text-ink">
              将删除项目「{dialog.project.name}」。
            </p>
            <p className="mt-2 text-xs leading-6 text-muted">
              影响范围：该项目目录中的原始剧本、解析草稿、动画数据、音频与渲染输出，以及项目索引记录。此操作不可撤销。
            </p>
          </div>
        ) : (
          <div>
            <label className="field-label" htmlFor="project-name">
              项目名称（必填）
            </label>
            <input
              id="project-name"
              className="field-input"
              autoFocus
              maxLength={NAME_MAX_LENGTH}
              placeholder="例如：老王和小李"
              value={formName}
              onChange={(event) => {
                setFormName(event.target.value);
                setFormError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />

            {dialog.kind === 'create' && (
              <div className="mt-4 rounded border border-line bg-page p-3">
                <p className="section-title">项目默认配置（第一版固定）</p>
                <dl className="mt-2 grid grid-cols-2 gap-y-2 text-xs">
                  <dt className="text-muted">画面比例</dt>
                  <dd className="text-ink">{PROJECT_DEFAULTS.aspectRatio}</dd>
                  <dt className="text-muted">分辨率</dt>
                  <dd className="text-ink">
                    {PROJECT_DEFAULTS.width} × {PROJECT_DEFAULTS.height}
                  </dd>
                  <dt className="text-muted">帧率</dt>
                  <dd className="text-ink">{PROJECT_DEFAULTS.fps} FPS</dd>
                  <dt className="text-muted">保存位置</dt>
                  <dd className="font-mono text-ink">{PROJECTS_ROOT_DISPLAY}</dd>
                </dl>
              </div>
            )}
          </div>
        )}

        {formError && (
          <p className="mt-3 rounded border border-danger bg-panel px-3 py-2 text-xs text-danger">
            {formError}
          </p>
        )}
      </Modal>
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  menuOpen: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  menuOpen,
  onOpen,
  onToggleMenu,
  onRename,
  onDelete,
}: ProjectCardProps) {
  return (
    <div className="relative h-[180px] w-[240px] rounded-lg border border-line bg-panel transition-colors hover:border-accent">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`打开项目 ${project.name}`}
        className="flex h-full w-full flex-col p-4 text-left"
      >
        <div className="mb-3 flex h-[92px] items-center justify-center rounded bg-page">
          <div className="flex h-[76px] w-[44px] items-center justify-center rounded-sm border border-line bg-subtle">
            <span className="text-[9px] leading-none tracking-[0.2em] text-muted [writing-mode:vertical-rl]">
              暂无封面
            </span>
          </div>
        </div>
        <span className="truncate text-sm font-medium text-ink">{project.name}</span>
        <span className="mt-1 text-xs text-muted">
          最近修改 · {formatRelativeTime(project.updatedAt)}
        </span>
      </button>

      <div className="absolute right-2 top-2 z-10">
        <button
          type="button"
          aria-label={`${project.name} 的更多操作`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu();
          }}
          className="flex h-7 w-7 items-center justify-center rounded text-lg leading-none text-muted hover:bg-subtle hover:text-ink"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-20 w-28 overflow-hidden rounded border border-line bg-elevated py-1 shadow-2xl">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRename();
              }}
              className="block w-full whitespace-nowrap px-3 py-2 text-left text-xs text-ink hover:bg-hovered"
            >
              重命名
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="block w-full whitespace-nowrap px-3 py-2 text-left text-xs text-danger hover:bg-hovered"
            >
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
