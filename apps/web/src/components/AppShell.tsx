import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useProjectsStore } from '../stores/projectsStore';

const navItemClass = ({ isActive }: { isActive: boolean }): string =>
  `flex h-10 items-center rounded px-3 text-sm transition-colors ${
    isActive ? 'bg-subtle text-ink' : 'text-muted hover:bg-subtle hover:text-ink'
  }`;

export default function AppShell() {
  const projects = useProjectsStore((state) => state.projects);
  const load = useProjectsStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const latestProject = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel px-5">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-semibold tracking-wide text-ink">animation-video</span>
          <span className="text-xs text-muted">2D 段子动画制作</span>
        </div>
        <div className="flex items-center gap-5 text-xs text-muted">
          <span>
            当前项目：<span className="text-ink">{latestProject?.name ?? '未打开项目'}</span>
          </span>
          <span>保存状态：<span className="text-ink">就绪</span></span>
          <NavLink to="/settings" className="hover:text-ink">
            设置
          </NavLink>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-line bg-panel p-3">
          <p className="px-3 pb-2 section-title">工作区</p>
          <NavLink to="/" end className={navItemClass}>
            项目首页
          </NavLink>
          {latestProject ? (
            <>
              <NavLink to={`/projects/${latestProject.id}`} className={navItemClass}>
                动画工作台
              </NavLink>
              <NavLink to={`/projects/${latestProject.id}/script`} className={navItemClass}>
                剧本编辑
              </NavLink>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled
                title="请先在首页创建或打开项目"
                className="flex h-10 cursor-not-allowed items-center rounded px-3 text-left text-sm text-muted opacity-45"
              >
                动画工作台
              </button>
              <button
                type="button"
                disabled
                title="请先在首页创建或打开项目"
                className="flex h-10 cursor-not-allowed items-center rounded px-3 text-left text-sm text-muted opacity-45"
              >
                剧本编辑
              </button>
            </>
          )}
          <NavLink to="/assets" className={navItemClass}>
            素材管理
          </NavLink>
          <NavLink to="/settings" className={navItemClass}>
            设置
          </NavLink>
          <div className="mt-auto px-3 pb-1 text-xs leading-5 text-muted">
            <div>阶段 5</div>
            <div>剧本与草稿导入</div>
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-auto bg-page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
