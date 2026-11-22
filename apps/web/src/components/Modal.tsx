import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeOnOverlayClick?: boolean;
  /** 宽弹窗用于信息量较大的配置（如配音影响预览）。 */
  widthClass?: string;
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  closeOnOverlayClick = true,
  widthClass = 'w-[440px]',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${widthClass} rounded-lg border border-line bg-panel shadow-2xl`}
      >
        <header className="flex h-12 items-center justify-between border-b border-line px-5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="flex h-7 w-7 items-center justify-center rounded text-xl leading-none text-muted hover:bg-subtle hover:text-ink"
          >
            ×
          </button>
        </header>
        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}
