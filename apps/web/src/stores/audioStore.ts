import type { AudioAssetFile, TtsProvider } from '@animation/shared';
import { create } from 'zustand';
import { getErrorMessage, ttsApi } from '../lib/api';

/**
 * TTS 音频资产与 Provider 描述（阶段 7）。
 * 音频文件本身不进前端状态，只保存索引与缓存振幅包络；
 * 试听通过 audioFileUrl() 直接请求服务端已登记的 wav。
 */
export interface AudioState {
  projectId: string | null;
  providers: TtsProvider[];
  audio: AudioAssetFile | null;
  loading: boolean;
  error: string | null;
  load: (projectId: string) => Promise<void>;
  setAudio: (file: AudioAssetFile) => void;
  reset: () => void;
}

const initialState = {
  projectId: null as string | null,
  providers: [] as TtsProvider[],
  audio: null as AudioAssetFile | null,
  loading: false,
  error: null as string | null,
};

export const useAudioStore = create<AudioState>((set) => ({
  ...initialState,

  load: async (projectId) => {
    set({ projectId, loading: true, error: null });
    try {
      const [providers, audio] = await Promise.all([
        ttsApi.providers(),
        ttsApi.audio(projectId),
      ]);
      set({ providers, audio, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: getErrorMessage(error), audio: null });
    }
  },

  setAudio: (file) => set({ audio: file, error: null }),
  reset: () => set(initialState),
}));

/** 只把 ready 资产的缓存包络交给 animation-core，按 audioAssetId 索引。 */
export function buildAudioEnvelopes(
  file: AudioAssetFile | null,
): Record<string, readonly number[]> {
  const result: Record<string, readonly number[]> = {};
  for (const asset of file?.assets ?? []) {
    if (asset.status === 'ready') result[asset.id] = asset.envelope;
  }
  return result;
}

export function buildReadyAudio(file: AudioAssetFile | null) {
  return (file?.assets ?? []).filter((asset) => asset.status === 'ready');
}
