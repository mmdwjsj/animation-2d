import type { Project } from '@animation/shared';
import { create } from 'zustand';
import { getErrorMessage, projectsApi } from '../lib/api';

export type SortBy = 'updated' | 'name';
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ProjectsState {
  projects: Project[];
  status: LoadStatus;
  error: string | null;
  keyword: string;
  sortBy: SortBy;
  load: () => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  renameProject: (project: Project, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setKeyword: (keyword: string) => void;
  setSortBy: (sortBy: SortBy) => void;
}

const initialState = {
  projects: [] as Project[],
  status: 'idle' as LoadStatus,
  error: null as string | null,
  keyword: '',
  sortBy: 'updated' as SortBy,
};

export const useProjectsStore = create<ProjectsState>((set) => ({
  ...initialState,

  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const projects = await projectsApi.list();
      set({ projects, status: 'ready', error: null });
    } catch (error) {
      set({ status: 'error', error: getErrorMessage(error) });
    }
  },

  createProject: async (name) => {
    const project = await projectsApi.create(name);
    set((state) => ({ projects: [project, ...state.projects], status: 'ready', error: null }));
    return project;
  },

  renameProject: async (project, name) => {
    const saved = await projectsApi.save({ ...project, name });
    set((state) => ({
      projects: state.projects.map((item) => (item.id === saved.id ? saved : item)),
      status: 'ready',
      error: null,
    }));
  },

  deleteProject: async (id) => {
    await projectsApi.remove(id);
    set((state) => ({ projects: state.projects.filter((item) => item.id !== id) }));
  },

  setKeyword: (keyword) => set({ keyword }),
  setSortBy: (sortBy) => set({ sortBy }),
}));

/** 列表排序和筛选是纯展示逻辑，与接口数据分离。 */
export function selectVisibleProjects(
  projects: Project[],
  rawKeyword: string,
  sortBy: SortBy,
): Project[] {
  const keyword = rawKeyword.trim().toLowerCase();
  const filtered = keyword
    ? projects.filter((project) => project.name.toLowerCase().includes(keyword))
    : projects;

  return [...filtered].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
