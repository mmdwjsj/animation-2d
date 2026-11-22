import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite 只保存项目索引和元数据（架构 10 节）。
 * 项目 JSON、剧本、动画数据、音频都落在文件系统。
 */
export function openDatabase(databasePath: string): DatabaseSync {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      path        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS render_jobs (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      stage           TEXT NOT NULL,
      progress        REAL,
      frames_rendered INTEGER NOT NULL DEFAULT 0,
      total_frames    INTEGER NOT NULL DEFAULT 0,
      message         TEXT NOT NULL DEFAULT '',
      config          TEXT NOT NULL,
      output_file     TEXT,
      error           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_render_jobs_project ON render_jobs (project_id);
  `);
  return db;
}
