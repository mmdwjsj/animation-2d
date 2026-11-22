import type { Config } from 'tailwindcss';

/** 所有颜色统一取自 CSS Variables（PRD 5.3 建议色值）。 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--color-bg-page)',
        panel: 'var(--color-bg-panel)',
        subtle: 'var(--color-bg-subtle)',
        elevated: 'var(--color-bg-elevated)',
        hovered: 'var(--color-bg-hovered)',
        line: 'var(--color-border)',
        ink: 'var(--color-text-primary)',
        muted: 'var(--color-text-secondary)',
        accent: 'var(--color-accent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-error)',
      },
      fontFamily: {
        sans: ['"Microsoft YaHei"', '"PingFang SC"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
