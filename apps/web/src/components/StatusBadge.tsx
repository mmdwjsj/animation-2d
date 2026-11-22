import type { SaveStatus } from '../stores/editorStore';

const statusConfig: Record<SaveStatus, { label: string; color: string }> = {
  saved: { label: '已保存', color: 'var(--color-success)' },
  dirty: { label: '未保存', color: 'var(--color-warning)' },
  saving: { label: '保存中…', color: 'var(--color-accent)' },
  error: { label: '保存失败', color: 'var(--color-error)' },
};

export default function StatusBadge({ status }: { status: SaveStatus }) {
  const config = statusConfig[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === 'saving' ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: config.color }}
      />
      {config.label}
    </span>
  );
}
