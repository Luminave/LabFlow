/**
 * 数据库初始化和操作模块
 * 使用 sql.js (纯 JavaScript SQLite 实现)
 */

import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

let SQL: SqlJsStatic | null = null
let db: SqlJsDatabase | null = null

export async function initDatabase(): Promise<SqlJsDatabase> {
  if (!SQL) {
    SQL = await initSqlJs({
      // sql.js 需要 wasm 文件，在 electron 中自动处理
    })
  }
  
  const dbPath = getDatabasePath()
  
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
    createTables()
    saveDatabase()
  }
  
  return db
}

export function getDatabasePath(): string {
  const userDataPath = app.getPath('userData')
  const dbDir = path.join(userDataPath, 'data')
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  
  return path.join(dbDir, 'labflow.db')
}

export function saveDatabase() {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(getDatabasePath(), buffer)
  }
}

function createTables() {
  if (!db) throw new Error('Database not initialized')
  
  // 试管表
  db.run(`
    CREATE TABLE IF NOT EXISTS tubes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('source', 'intermediate')),
      total_volume REAL NOT NULL,
      total_volume_unit TEXT NOT NULL,
      remaining_volume REAL NOT NULL,
      remaining_volume_unit TEXT NOT NULL,
      substances TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'depleted', 'discarded')),
      storage_location TEXT,
      storage_condition TEXT,
      notes TEXT,
      tags TEXT
    )
  `)
  
  // 实验表
  db.run(`
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'completed', 'reverted')),
      tubes TEXT NOT NULL,
      connections TEXT NOT NULL,
      warehouse_snapshot TEXT
    )
  `)
  
  // 试管使用记录表
  db.run(`
    CREATE TABLE IF NOT EXISTS tube_usage_records (
      id TEXT PRIMARY KEY,
      tube_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created', 'used_as_source', 'used_as_target')),
      volume_change REAL,
      timestamp TEXT NOT NULL,
      details TEXT,
      FOREIGN KEY (tube_id) REFERENCES tubes(id) ON DELETE CASCADE,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
    )
  `)
  
  // 创建索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_tubes_status ON tubes(status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tubes_type ON tubes(type)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_usage_tube_id ON tube_usage_records(tube_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_usage_experiment_id ON tube_usage_records(experiment_id)`)
  
  // 迁移：添加新字段（如果不存在）
  try {
    // 检查 experiments 表是否有 is_waste 字段
    const columns = db.exec("PRAGMA table_info(experiments)")
    if (columns.length > 0) {
      const columnNames = columns[0].values.map((col: any) => col[1])
      if (!columnNames.includes('is_waste')) {
        db.run(`ALTER TABLE experiments ADD COLUMN is_waste INTEGER DEFAULT 0`)
      }
      if (!columnNames.includes('tube_positions')) {
        db.run(`ALTER TABLE experiments ADD COLUMN tube_positions TEXT DEFAULT '[]'`)
      }
      if (!columnNames.includes('initial_state_tubes')) {
        db.run(`ALTER TABLE experiments ADD COLUMN initial_state_tubes TEXT`)
      }
      if (!columnNames.includes('end_state_tubes')) {
        db.run(`ALTER TABLE experiments ADD COLUMN end_state_tubes TEXT`)
      }
    }
  } catch (e) {
    console.log('Migration check failed:', e)
  }
}

export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function closeDatabase() {
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }
}

// 辅助函数：执行查询并返回结果
export function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params)
  
  const results: any[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push(row)
  }
  stmt.free()
  
  return results
}

export function queryOne(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params)
  return results.length > 0 ? results[0] : null
}

export function run(sql: string, params: any[] = []): { changes: number } {
  getDb().run(sql, params)
  saveDatabase()
  return { changes: getDb().getRowsModified() }
}
