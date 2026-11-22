import { useEffect, useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

/**
 * 数字输入是位置编辑的辅助方式（PRD 7.4）。
 * 输入过程中保留本地草稿，失焦或回车才提交，避免每敲一个字符就写数据。
 */
export default function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onCommit(next);
    setDraft(String(next));
  };

  return (
    <label className="block">
      <span className="field-label">{label}{suffix ? `（${suffix}）` : ''}</span>
      <input
        type="number"
        aria-label={label}
        className="field-input"
        value={draft}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
