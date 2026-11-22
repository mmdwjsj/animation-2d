const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '—';
  return dateTimeFormatter.format(new Date(time));
}

export function formatRelativeTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDateTime(iso);
}
