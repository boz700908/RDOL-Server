/**
 * SQLite 适配层（替代原 db/mysql.ts）
 *
 * 对外仍然导出 `query<T>(sql, params): Promise<T>`，与 mysql2 版本签名一致
 * （原版返回 `Promise<T>` 而非 `Promise<T[]>`，调用方写的是 `query<User[]>` / `query<User>`，必须保持），
 * 业务代码（auth.service.ts）无需改动。
 *
 * 与 MySQL 的差异处理：
 *  - `?` 占位符：SQLite 原生支持，无需转换
 *  - `NOW()`：SQLite 无此函数，统一改写为 `datetime('now')`
 *    （MySQL 的 NOW() 也是本地时区，两者行为一致）
 *  - 返回行对象：node:sqlite 返回 null 原型对象，这里转成普通对象，避免
 *    JSON.stringify / 属性检查上的意外差异
 *  - UPDATE / DELETE 返回空数组，与 mysql2 对非 SELECT 的行为接近（业务不依赖返回值）
 *
 * 数据库文件路径由环境变量 DB_FILE 指定，默认 ./data/rdonline.db
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbFile = resolve(process.env.DB_FILE?.trim() || './data/rdonline.db');

mkdirSync(dirname(dbFile), { recursive: true });

export const db = new DatabaseSync(dbFile);

// WAL 提升并发读性能；busy_timeout 避免瞬时锁冲突直接报错
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');

/**
 * 参数值转换：mysql2 能接受 Date / boolean，node:sqlite 只接受
 * null | number | bigint | string | Uint8Array，这里统一归一化。
 *
 * Date 统一转成 UTC 的 'YYYY-MM-DD HH:MM:SS'，与 datetime('now')（UTC）
 * 的取值格式一致，保证字符串比较式的过期判断正确。
 */
function toSqliteParam(value: any): any {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

/** 把 MySQL 方言改写成 SQLite 方言 */
function translate(sql: string): string {
  return sql.replace(/\bNOW\(\)/gi, "datetime('now')");
}

/**
 * 执行查询。SELECT 返回行数组；其它语句返回空数组。
 *
 * 注意：mysql2 的 `execute` 只支持预处理语句，而 node:sqlite 的 prepare 同样如此，
 * 两者都不支持一次多条语句。建表等 DDL 请用 `exec()`。
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  const text = translate(sql);
  const stmt = db.prepare(text);

  // 以是否可能返回行来判断：SELECT / WITH / PRAGMA 走 all()。
  // INSERT/UPDATE/DELETE 带 RETURNING 时同样会返回行（SQLite 3.35+），
  // 也必须走 all()，否则 run() 把结果丢掉，调用方拿到的 id 是 undefined。
  const isRead = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(text) || /\bRETURNING\b/i.test(text);
  if (isRead) {
    const rows = stmt.all(...params.map(toSqliteParam)) as any[];
    return rows.map((r) => ({ ...r })) as unknown as T;
  }

  stmt.run(...params.map(toSqliteParam));
  return [] as unknown as T;
}

/** 批量执行 DDL / 多条语句（初始化建表用） */
export function exec(sql: string): void {
  db.exec(translate(sql));
}

export async function closeDb(): Promise<void> {
  db.close();
}

/** 构造函数会做一次连通性自检，失败时让启动过程立刻暴露问题 */
try {
  db.prepare('SELECT 1').get();
} catch (err) {
  console.error('[db] SQLite 初始化失败:', err);
  throw err;
}

console.log(`[db] SQLite 已就绪: ${dbFile}`);
