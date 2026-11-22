import { TIMELINE_VIEW } from '@animation/shared';
import { create } from 'zustand';

/**
 * 时间轴 UI 状态（PRD 7.6）。
 * 播放头只决定「显示第几帧」；该帧的完整画面由 animation-core 的
 * getStateAtFrame 确定性计算，播放时钟不参与动画状态求值。
 */
export interface TimelineState {
  currentFrame: number;
  playing: boolean;
  pxPerFrame: number;
  selectedDialogueId: string | null;
  setCurrentFrame: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  zoom: (factor: number) => void;
  selectDialogue: (id: string | null) => void;
  reset: () => void;
}

const initialState = {
  currentFrame: 0,
  playing: false,
  pxPerFrame: TIMELINE_VIEW.defaultPxPerFrame,
  selectedDialogueId: null,
};

export const useTimelineStore = create<TimelineState>((set) => ({
  ...initialState,

  setCurrentFrame: (frame) =>
    set({ currentFrame: Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0 }),

  setPlaying: (playing) => set({ playing }),

  togglePlaying: () => set((state) => ({ playing: !state.playing })),

  zoom: (factor) =>
    set((state) => ({
      pxPerFrame: Math.round(
        Math.min(
          TIMELINE_VIEW.maxPxPerFrame,
          Math.max(TIMELINE_VIEW.minPxPerFrame, state.pxPerFrame * factor),
        ) * 100,
      ) / 100,
    })),

  selectDialogue: (id) => set({ selectedDialogueId: id }),

  reset: () => set(initialState),
}));
