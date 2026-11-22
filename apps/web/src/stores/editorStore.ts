import type { Project } from '@animation/shared';
import { create } from 'zustand';
import { getErrorMessage, projectsApi } from '../lib/api';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

interface EditorState {
  project: Project | null;
  draftName: string;
  saveStatus: SaveStatus;
  saveError: string | null;
  loadError: string | null;
  loading: boolean;
  loadProject: (id: string) => Promise<void>;
  setDraftName: (name: string) => void;
  saveNow: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  project: null as Project | null,
  draftName: '',
  saveStatus: 'saved' as SaveStatus,
  saveError: null as string | null,
  loadError: null as string | null,
  loading: false,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initialState,

  loadProject: async (id) => {
    set({ ...initialState, loading: true });
    try {
      const project = await projectsApi.get(id);
      set({
        project,
        draftName: project.name,
        saveStatus: 'saved',
        saveError: null,
        loadError: null,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, loadError: getErrorMessage(error) });
    }
  },

  setDraftName: (name) => set({ draftName: name, saveStatus: 'dirty', saveError: null }),

  saveNow: async () => {
    const { project, draftName, saveStatus } = get();
    if (!project || saveStatus === 'saving') return;

    const trimmed = draftName.trim();
    // 没有实际改动时不写盘，避免手动保存或 Ctrl+S 造成无意义的版本递增。
    if (saveStatus === 'saved' && trimmed === project.name) return;
    if (!trimmed) {
      set({ saveStatus: 'error', saveError: '项目名称不能为空，请修改后重试。' });
      return;
    }

    set({ saveStatus: 'saving', saveError: null });
    try {
      const saved = await projectsApi.save({ ...project, name: trimmed });
      set({ project: saved, draftName: saved.name, saveStatus: 'saved', saveError: null });
    } catch (error) {
      // 保存失败时保持 error 状态，绝不显示"已保存"。
      set({ saveStatus: 'error', saveError: getErrorMessage(error) });
    }
  },

  reset: () => set(initialState),
}));
