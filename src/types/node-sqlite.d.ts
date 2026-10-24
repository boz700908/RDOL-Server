/**
 * node:sqlite 类型声明（当前 @types/node 未包含该内置模块）
 * 只声明本项目用到的部分，接口形状取自 Node 官方文档。
 */
declare module 'node:sqlite' {
  export interface StatementResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...params: any[]): unknown[];
    get(...params: any[]): unknown;
    run(...params: any[]): StatementResult;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
