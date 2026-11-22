import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_LANGUAGE_LABELS, type TtsProvider as TtsProviderDescriptor } from '@animation/shared';
import { errors } from '../../errors';
import type { TtsSynthesisProvider, TtsSynthesisRequest, TtsSynthesisResult } from './provider';
import { computeAmplitudeEnvelope, decodeWavPcm, type DecodedWav } from './wav';
import type { CommandTtsConfig } from './commandConfig';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;

/** 命令模板变量替换；不经过 shell，避免台词里的特殊字符造成注入。 */
function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{(text|voice|speed|language|output)\}/g, (_match, key: string) =>
    variables[key] ?? '',
  );
}

/** {env:NAME} 只在环境变量存在时展开；缺失返回空串，不把占位符写进请求。 */
function resolveEnvValue(value: string): string {
  const match = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim());
  return match ? (process.env[match[1]] ?? '') : value;
}

/**
 * 配置驱动的外部 TTS Provider。
 *
 * 输出链路：子进程 / HTTP 拿到音频字节 → ffmpeg 统一转 PCM16 单声道 WAV
 * → 现有 decodeWavPcm / computeAmplitudeEnvelope 复用「真实时长 + 嘴型包络」。
 * 任何一步失败都明确报错并给出可操作信息，绝不静默回退到假人声（AGENTS 10）。
 */
export class CommandTtsProvider implements TtsSynthesisProvider {
  readonly descriptor: TtsProviderDescriptor;

  constructor(private readonly config: CommandTtsConfig) {
    this.descriptor = {
      id: config.id,
      name: config.name,
      description: config.description,
      languages: config.languages,
      voices: config.voices,
      defaultVoiceId: config.defaultVoiceByLanguage?.[config.languages[0]] ?? config.voices[0].id,
      ...(config.defaultVoiceByLanguage ? { defaultVoiceByLanguage: config.defaultVoiceByLanguage } : {}),
      minSpeed: config.minSpeed,
      maxSpeed: config.maxSpeed,
      defaultSpeed: config.defaultSpeed,
    };
  }

  async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    const { config } = this;
    if (!config.languages.includes(request.language)) {
      throw errors.tts(
        `TTS 引擎「${config.name}」不支持${PROJECT_LANGUAGE_LABELS[request.language]}。`,
      );
    }
    const voice = config.voices.find((item) => item.id === request.voiceId);
    if (!voice) throw errors.tts(`声音「${request.voiceId}」不属于引擎「${config.name}」。`);
    if (voice.language !== request.language) {
      throw errors.tts(`声音「${voice.name}」与当前对白语言不匹配。`);
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), 'animation-tts-'));
    const variables = {
      text: request.text,
      voice: request.voiceId,
      speed: String(request.speed),
      language: request.language,
      output: path.join(tempDir, `speech${config.outputExtension}`),
    };

    try {
      const raw = config.kind === 'http'
        ? await this.synthesizeHttp(variables)
        : await this.synthesizeCommand(variables);
      if (raw.length === 0) {
        throw errors.tts(`引擎「${config.name}」返回了空音频，请检查命令或服务的输出。`);
      }

      // 优先直接使用 PCM16 WAV（本机 Kokoro 就是这种），避免无谓转码；
      // 其它格式（mp3 / 浮点 WAV / 多声道）再交给 ffmpeg 统一成 PCM16 单声道。
      let wav = raw;
      let decoded: DecodedWav | null = this.tryDecode(raw);
      if (!decoded) {
        const inputPath = path.join(tempDir, `source${config.outputExtension}`);
        const wavPath = path.join(tempDir, 'speech.pcm.wav');
        writeFileSync(inputPath, raw);
        await this.transcode(inputPath, wavPath);
        wav = readFileSync(wavPath);
        decoded = decodeWavPcm(wav);
      }
      const durationMs =
        (decoded.samples.length / (decoded.sampleRate * decoded.channels)) * 1000;
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw errors.tts(`引擎「${config.name}」产出的音频时长无效。`);
      }
      const fps = Number.isFinite(request.fps) && request.fps > 0 ? Math.floor(request.fps) : 30;
      const textHash = createHash('sha256')
        .update(
          `${config.id}|${request.language}|${request.voiceId}|${request.speed.toFixed(3)}|${request.text}`,
        )
        .digest('hex')
        .slice(0, 16);

      return {
        audio: wav,
        durationMs: Math.round(durationMs * 1000) / 1000,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        format: 'wav',
        envelope: computeAmplitudeEnvelope(decoded.samples, decoded.sampleRate, fps),
        envelopeFps: fps,
        textHash,
      };
    } finally {
      // 只清理本次自建的临时目录，不触碰任何用户项目文件。
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // 清理失败不影响主结果
      }
    }
  }

  private tryDecode(buffer: Buffer): DecodedWav | null {
    try {
      return decodeWavPcm(buffer);
    } catch {
      return null;
    }
  }

  private async synthesizeCommand(variables: Record<string, string>): Promise<Buffer> {
    const { config } = this;
    const args = config.args.map((arg) => renderTemplate(arg, variables));
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env ?? {})) {
      env[key] = resolveEnvValue(value);
    }
    try {
      await execFileAsync(config.command!, args, {
        ...(config.cwd ? { cwd: config.cwd } : {}),
        env: { ...process.env, ...env },
        timeout: config.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const code = (cause as NodeJS.ErrnoException)?.code;
      const hint =
        code === 'ENOENT'
          ? '命令不存在，请检查 command 是否为绝对路径或已在 PATH 中。'
          : /ETIMEDOUT|timed out/i.test(detail)
            ? `命令超时（${config.timeoutMs} ms），可增大 timeoutMs 或检查引擎是否卡住。`
            : '请检查命令参数、Python 解释器与模型路径，以及引擎的标准错误输出。';
      throw errors.tts(`引擎「${config.name}」调用失败：${hint} 详情：${detail.slice(0, 400)}`);
    }
    if (!existsSync(variables.output)) {
      throw errors.tts(
        `引擎「${config.name}」未产出音频文件（${variables.output}），请检查 {output} 模板变量。`,
      );
    }
    const buffer = readFileSync(variables.output);
    if (buffer.length > MAX_OUTPUT_BYTES) {
      throw errors.tts(`引擎「${config.name}」产出的音频过大（${buffer.length} 字节）。`);
    }
    return buffer;
  }

  private async synthesizeHttp(variables: Record<string, string>): Promise<Buffer> {
    const { config } = this;
    const url = `${config.baseUrl!.replace(/\/$/, '')}/v1/audio/speech`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKeyEnv && process.env[config.apiKeyEnv]) {
      headers.Authorization = `Bearer ${process.env[config.apiKeyEnv]}`;
    }
    const body: Record<string, unknown> = {
      model: config.model ?? config.voices[0].id,
      input: variables.text,
      voice: variables.voice,
      speed: Number(variables.speed),
      ...(config.body ?? {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = (await response.text()).slice(0, 300);
        throw errors.tts(
          `引擎「${config.name}」HTTP ${response.status}：${text || '无响应体'}。请检查 baseUrl / model / 密钥环境变量。`,
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_OUTPUT_BYTES) {
        throw errors.tts(`引擎「${config.name}」返回的音频过大。`);
      }
      return buffer;
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'statusCode' in cause) throw cause;
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw errors.tts(`引擎「${config.name}」请求失败（可能未启动或超时）：${detail.slice(0, 300)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async transcode(inputPath: string, outputPath: string): Promise<void> {
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          inputPath,
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          outputPath,
        ],
        { timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw errors.tts(
        `音频转码失败（需要系统 ffmpeg，且引擎产物必须是可解码音频）：${detail.slice(0, 300)}`,
      );
    }
    if (!existsSync(outputPath)) throw errors.tts('音频转码未产出 WAV 文件。');
  }
}
