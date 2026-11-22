import { useEffect, useState } from 'react';
import type { Settings } from '@animation/shared';
import Button from '../components/Button';
import { getErrorMessage, settingsApi } from '../lib/api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; settings: Settings }
  | { kind: 'error'; message: string };

export default function SettingsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', settings: await settingsApi.get() });
    } catch (error) {
      setState({ kind: 'error', message: getErrorMessage(error) });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-[880px] px-8 py-8">
      <h1 className="text-xl font-semibold text-ink">设置</h1>
      <p className="mt-2 text-sm text-muted">第一版配置固定，以下信息来自当前运行的服务。</p>

      {state.kind === 'loading' && <p className="mt-8 text-sm text-muted">正在读取配置…</p>}

      {state.kind === 'error' && (
        <div className="mt-8 rounded-lg border border-line bg-panel p-5">
          <p className="text-sm text-danger">读取配置失败</p>
          <p className="mt-1 text-xs text-muted">{state.message}</p>
          <Button className="mt-4" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}

      {state.kind === 'ready' && (
        <dl className="mt-7 panel-surface divide-y divide-line rounded-lg">
          <SettingRow label="项目根目录" value={state.settings.projectsRoot} />
          <SettingRow label="项目索引数据库" value={state.settings.databaseFile} />
          <SettingRow
            label="默认分辨率"
            value={`${state.settings.width} × ${state.settings.height}`}
          />
          <SettingRow label="默认帧率" value={`${state.settings.fps} FPS`} />
          <SettingRow label="画面比例" value={state.settings.aspectRatio} />
          <SettingRow label="应用版本" value={state.settings.appVersion} />
          <SettingRow label="Node 运行时" value={state.settings.nodeVersion} />
        </dl>
      )}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-sm text-ink">{value}</dd>
    </div>
  );
}
