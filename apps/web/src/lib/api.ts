import type {
  Asset,
  AssetStatus,
  AudioAssetFile,
  CharacterAsset,
  DraftImpact,
  DraftMatch,
  Project,
  RenderJob,
  RenderRequest,
  RenderScope,
  RenderValidation,
  ScriptDraft,
  ScriptFile,
  Settings,
  StageData,
  TtsGenerateResult,
  TtsPlan,
  TtsProvider,
} from '@animation/shared';

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return '发生未知错误，请稍后重试。';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', '无法连接服务，请确认后端服务已启动。', 0);
  }

  if (!response.ok) {
    let message = '请求失败，请稍后重试。';
    let code = 'UNKNOWN_ERROR';
    try {
      const payload = (await response.json()) as { error?: ApiErrorPayload };
      if (payload.error?.message) message = payload.error.message;
      if (payload.error?.code) code = payload.error.code;
    } catch {
      // 非 JSON 错误响应使用通用提示
    }
    throw new ApiClientError(code, message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const projectsApi = {
  list: async (): Promise<Project[]> => {
    const result = await request<{ data: Project[] }>('/api/projects');
    return result.data;
  },
  get: async (id: string): Promise<Project> => {
    const result = await request<{ data: Project }>(`/api/projects/${encodeURIComponent(id)}`);
    return result.data;
  },
  create: async (name: string): Promise<Project> => {
    const result = await request<{ data: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return result.data;
  },
  save: async (project: Project): Promise<Project> => {
    const result = await request<{ data: Project }>(
      `/api/projects/${encodeURIComponent(project.id)}`,
      { method: 'PUT', body: JSON.stringify(project) },
    );
    return result.data;
  },
  remove: async (id: string): Promise<void> => {
    await request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

export const settingsApi = {
  get: async (): Promise<Settings> => {
    const result = await request<{ data: Settings }>('/api/settings');
    return result.data;
  },
};

/** 带 .svg 后缀，确保 PixiJS 按 SVG 解析纹理。 */
export function assetFileUrl(assetId: string): string {
  return `/api/assets/files/${encodeURIComponent(assetId)}.svg`;
}

/** 人物分层文件 URL：layerFile 已含 .svg，按段编码但保留路径分隔符。 */
export function characterLayerUrl(characterId: string, layerFile: string): string {
  const encoded = layerFile.split('/').map(encodeURIComponent).join('/');
  return `/api/assets/layers/${encodeURIComponent(characterId)}/${encoded}`;
}

export const assetsApi = {
  list: async (): Promise<Asset[]> => {
    const result = await request<{ data: Asset[] }>('/api/assets');
    return result.data;
  },
  status: async (): Promise<AssetStatus> => {
    const result = await request<{ data: AssetStatus }>('/api/assets/status');
    return result.data;
  },
};

export const charactersApi = {
  list: async (): Promise<CharacterAsset[]> => {
    const result = await request<{ data: CharacterAsset[] }>('/api/assets/characters');
    return result.data;
  },
};

export const stageApi = {
  get: async (projectId: string): Promise<StageData> => {
    const result = await request<{ data: StageData }>(
      `/api/projects/${encodeURIComponent(projectId)}/stage`,
    );
    return result.data;
  },
  save: async (stage: StageData): Promise<StageData> => {
    const result = await request<{ data: StageData }>(
      `/api/projects/${encodeURIComponent(stage.projectId)}/stage`,
      { method: 'PUT', body: JSON.stringify(stage) },
    );
    return result.data;
  },
};

/** 试听地址：assetId 已在服务端资产索引中登记，路径不暴露系统绝对路径。 */
export function audioFileUrl(projectId: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/audio/${encodeURIComponent(assetId)}`;
}

/** 阶段 7 TTS 统一 Provider、影响预览、生成与音频资产。 */
export const ttsApi = {
  providers: async (): Promise<TtsProvider[]> => {
    const result = await request<{ data: { providers: TtsProvider[] } }>('/api/tts/providers');
    return result.data.providers;
  },
  audio: async (projectId: string): Promise<AudioAssetFile> => {
    const result = await request<{ data: AudioAssetFile }>(
      `/api/projects/${encodeURIComponent(projectId)}/audio`,
    );
    return result.data;
  },
  plan: async (
    projectId: string,
    params: { providerId: string; voiceId?: string; speed?: number; dialogueIds?: string[] },
  ): Promise<TtsPlan> => {
    const result = await request<{ data: TtsPlan }>(
      `/api/projects/${encodeURIComponent(projectId)}/tts/plan`,
      { method: 'POST', body: JSON.stringify(params) },
    );
    return result.data;
  },
  generate: async (params: {
    projectId: string;
    providerId: string;
    voiceId?: string;
    speed?: number;
    dialogueIds?: string[];
  }): Promise<TtsGenerateResult> => {
    const result = await request<{ data: TtsGenerateResult }>('/api/tts/generate', {
      method: 'POST',
      body: JSON.stringify({ ...params, confirmed: true }),
    });
    return result.data;
  },
};

/** 剧本解析与动画草稿导入（架构 11、12 节）。 */
export const scriptsApi = {
  parse: async (text: string): Promise<{ draft: ScriptDraft; match: DraftMatch }> => {
    const result = await request<{ data: { draft: ScriptDraft; match: DraftMatch } }>(
      '/api/scripts/parse',
      { method: 'POST', body: JSON.stringify({ text }) },
    );
    return result.data;
  },
  get: async (projectId: string): Promise<ScriptFile> => {
    const result = await request<{ data: ScriptFile }>(
      `/api/projects/${encodeURIComponent(projectId)}/script`,
    );
    return result.data;
  },
  save: async (projectId: string, file: ScriptFile): Promise<ScriptFile> => {
    const result = await request<{ data: ScriptFile }>(
      `/api/projects/${encodeURIComponent(projectId)}/script`,
      { method: 'PUT', body: JSON.stringify(file) },
    );
    return result.data;
  },
  preview: async (projectId: string, draft: ScriptDraft): Promise<DraftImpact> => {
    const result = await request<{ data: DraftImpact }>(
      `/api/projects/${encodeURIComponent(projectId)}/draft/preview`,
      { method: 'POST', body: JSON.stringify({ draft }) },
    );
    return result.data;
  },
  importDraft: async (projectId: string, draft: ScriptDraft): Promise<StageData> => {
    const result = await request<{ data: StageData }>(
      `/api/projects/${encodeURIComponent(projectId)}/draft/import`,
      { method: 'POST', body: JSON.stringify({ draft, confirmed: true }) },
    );
    return result.data;
  },
};

/** 视频导出（架构 12 节 / PRD 14）。任务状态与进度均由服务端真实渲染过程提供。 */
export const renderApi = {
  validate: async (
    projectId: string,
    fps: number,
    scope: RenderScope = 'all',
  ): Promise<RenderValidation> => {
    const result = await request<{ data: RenderValidation }>(
      `/api/projects/${encodeURIComponent(projectId)}/render/validate?fps=${fps}&scope=${encodeURIComponent(scope)}`,
    );
    return result.data;
  },
  create: async (payload: RenderRequest): Promise<RenderJob> => {
    const result = await request<{ data: RenderJob }>('/api/render', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result.data;
  },
  get: async (jobId: string): Promise<RenderJob> => {
    const result = await request<{ data: RenderJob }>(`/api/render/${encodeURIComponent(jobId)}`);
    return result.data;
  },
  fileUrl: (jobId: string): string => `/api/render/${encodeURIComponent(jobId)}/file`,
};
