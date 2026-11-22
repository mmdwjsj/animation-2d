import { renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * 原子写入：先写同目录临时文件，再 rename 覆盖目标。
 * Windows 上 rename 覆盖已存在文件可用；失败时清理临时文件，不破坏原有数据。
 * 项目管理与舞台数据共用，避免各写一份。
 */
export function atomicWriteRaw(filePath: string, content: string): void {
  writeAtomically(filePath, () => writeFileSync(filePathTmp(filePath), content, 'utf8'));
}

/** 二进制（TTS 音频）原子写入，与文本写入共用同一套临时文件 + rename 语义。 */
export function atomicWriteBuffer(filePath: string, content: Buffer): void {
  writeAtomically(filePath, () => writeFileSync(filePathTmp(filePath), content));
}

function filePathTmp(filePath: string): string {
  return `${filePath}.${process.pid}.tmp`;
}

function writeAtomically(filePath: string, write: () => void): void {
  const tmpPath = filePathTmp(filePath);
  try {
    write();
    renameSync(tmpPath, filePath);
  } catch (cause) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // 临时文件清理失败不影响主错误上报
    }
    throw cause;
  }
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteRaw(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
