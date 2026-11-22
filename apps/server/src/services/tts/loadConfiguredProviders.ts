import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appConfig } from '../../config';
import { ttsProvidersFileSchema } from './commandConfig';
import { CommandTtsProvider } from './commandTtsProvider';
import type { TtsSynthesisProvider } from './provider';

/**
 * 配置驱动的外部 TTS 引擎加载器。
 *
 * 只有显式设置 ANIMATION_TTS_PROVIDERS_FILE 才会注册（默认返回空数组），
 * 因此项目默认是纯离线的，不会在用户不知情时把台词发到公网（AGENTS 10）。
 * 配置校验失败会明确抛错，绝不静默跳过或降级成假人声。
 */
export function loadConfiguredTtsProviders(): TtsSynthesisProvider[] {
  const raw = process.env.ANIMATION_TTS_PROVIDERS_FILE;
  if (!raw || !raw.trim()) return [];
  const file = path.isAbsolute(raw) ? raw : path.join(appConfig.repoRoot, raw);
  if (!existsSync(file)) {
    console.warn(`[animation-video] TTS 引擎配置文件不存在，已跳过外部引擎：${file}`);
    return [];
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    throw new Error(`TTS 引擎配置不是合法 JSON：${file}`);
  }
  const parsed = ttsProvidersFileSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`TTS 引擎配置校验失败（${file}）：${detail}`);
  }

  const providers = parsed.data.providers.map((config) => new CommandTtsProvider(config));
  console.log(
    `[animation-video] 已加载 ${providers.length} 个外部 TTS 引擎：${providers
      .map((provider) => `${provider.descriptor.id}[${provider.descriptor.languages.join('/')}]`)
      .join(', ')}`,
  );
  return providers;
}
