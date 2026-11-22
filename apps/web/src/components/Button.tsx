import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'border border-line bg-subtle text-ink hover:opacity-80',
  ghost: 'bg-transparent text-muted hover:bg-subtle hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
};

export default function Button({
  variant = 'secondary',
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3.5 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-45 ${variantClass[variant]} ${className}`}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
