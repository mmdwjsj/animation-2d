import type { DatabaseSync } from 'node:sqlite';

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): ProjectRow[] {
    return this.db
      .prepare('SELECT id, name, path, created_at, updated_at FROM projects ORDER BY updated_at DESC')
      .all() as unknown as ProjectRow[];
  }

  findById(id: string): ProjectRow | undefined {
    const row = this.db
      .prepare('SELECT id, name, path, created_at, updated_at FROM projects WHERE id = ?')
      .get(id);
    return (row ?? undefined) as unknown as ProjectRow | undefined;
  }

  insert(row: ProjectRow): void {
    this.db
      .prepare('INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.path, row.created_at, row.updated_at);
  }

  update(id: string, name: string, updatedAt: string): void {
    this.db
      .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, updatedAt, id);
  }

  /**
   * 删除项目索引，同时清理该项目在 SQLite 里的渲染任务元数据，
   * 避免项目删除后 render_jobs 留下无法访问的孤儿记录（架构 10 节）。
   */
  remove(id: string): void {
    this.db.prepare('DELETE FROM render_jobs WHERE project_id = ?').run(id);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
}
