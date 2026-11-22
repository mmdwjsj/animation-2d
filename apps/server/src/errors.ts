import type { ApiErrorCode } from '@animation/shared';

/** 统一业务错误。message 面向用户，detail 仅用于服务端日志。 */
export class AppError extends Error {
  readonly detail: unknown;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly statusCode: number,
    detail?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.detail = detail;
  }
}

export const errors = {
  validation: (message: string): AppError => new AppError('VALIDATION_ERROR', message, 400),
  scriptParse: (message: string): AppError => new AppError('SCRIPT_PARSE_ERROR', message, 400),
  notFound: (message: string): AppError => new AppError('PROJECT_NOT_FOUND', message, 404),
  assetNotFound: (message: string): AppError => new AppError('ASSET_NOT_FOUND', message, 404),
  tts: (message: string): AppError => new AppError('TTS_FAILED', message, 502),
  render: (message: string, detail?: unknown): AppError =>
    new AppError('RENDER_FAILED', message, 500, detail),
  io: (message: string, detail?: unknown): AppError =>
    new AppError('PROJECT_IO_ERROR', message, 500, detail),
};
