import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// sql.js 是 CJS 模块，需要使用 require 导入
const initSqlJs = require('sql.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let SQL: any = null
let db: any = null
let dbInitPromise: Promise<any> | null = null

// ==================== 配置管理 ====================

interface LabFlowConfig {
  dbPath?: string       // 数据库文件完整路径
  backupDir?: string    // 备份目录完整路径
  version?: number
}

const CONFIG_FILENAME = 'labflow.config.json'

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME)
}

function loadConfig(): LabFlowConfig {
  const configPath = getConfigPath()
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {
      return {}
    }
  }
  return {}
}

function saveConfig(config: LabFlowConfig): void {
  config.version = 1
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

function getDbPath(): string {
  const config = loadConfig()
  if (config.dbPath) return config.dbPath
  return path.join(app.getPath('userData'), 'data', 'labflow.db')
}

function getBackupDir(): string {
  const config = loadConfig()
  const dir = config.backupDir || path.join(app.getPath('userData'), 'backups')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

// 数据库初始化
async function initDatabase() {
  if (!SQL) {
    SQL = await initSqlJs({})
  }

  const dbPath = getDbPath()
  const dbDir = path.dirname(dbPath)

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
    createTables()
    saveDatabase()
  }

  // 每次启动都执行迁移
  migrateDatabase()

  return db
}

// 数据库迁移
function migrateDatabase() {
  try {
    // 检查 tubes 表是否有 group_id 列
    const tubesColumns = queryAll("PRAGMA table_info(tubes)")
    const hasGroupId = tubesColumns.some((col: any) => col.name === 'group_id')
    if (!hasGroupId) {
      db.run('ALTER TABLE tubes ADD COLUMN group_id TEXT')
      console.log('[Migration] Added group_id column to tubes table')
    }

    // 检查 experiments 表是否有 is_waste 列
    const expColumns = queryAll("PRAGMA table_info(experiments)")
    const hasIsWaste = expColumns.some((col: any) => col.name === 'is_waste')
    if (!hasIsWaste) {
      db.run('ALTER TABLE experiments ADD COLUMN is_waste INTEGER DEFAULT 0')
      console.log('[Migration] Added is_waste column to experiments table')
    }

    saveDatabase()
  } catch (e) {
    console.error('[Migration] Failed:', e)
  }
}

// 确保数据库已初始化（IPC handler 调用前使用）
async function ensureDb() {
  if (db) return db

  // 如果有正在进行的初始化，等待它完成
  if (dbInitPromise) {
    try {
      return await dbInitPromise
    } catch (e) {
      // 初始化失败，清除 promise 以便重试
      dbInitPromise = null
      throw e
    }
  }

  // 开始新的初始化
  dbInitPromise = initDatabase()
  try {
    return await dbInitPromise
  } catch (e) {
    // 初始化失败，清除 promise 以便重试
    dbInitPromise = null
    throw e
  }
}

function saveDatabase() {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    const dbPath = getDbPath()
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    fs.writeFileSync(dbPath, buffer)
  }
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS tubes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      total_volume REAL NOT NULL,
      total_volume_unit TEXT NOT NULL,
      remaining_volume REAL NOT NULL,
      remaining_volume_unit TEXT NOT NULL,
      substances TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      storage_location TEXT,
      storage_condition TEXT,
      notes TEXT,
      tags TEXT,
      group_id TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      tubes TEXT NOT NULL,
      tube_positions TEXT,
      connections TEXT NOT NULL,
      warehouse_snapshot TEXT,
      initial_state_tubes TEXT,
      end_state_tubes TEXT,
      is_waste INTEGER DEFAULT 0
    )
  `)
  
  db.run(`
    CREATE TABLE IF NOT EXISTS tube_usage_records (
      id TEXT PRIMARY KEY,
      tube_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      action TEXT NOT NULL,
      volume_change REAL,
      timestamp TEXT NOT NULL,
      details TEXT
    )
  `)

  // 试管历史记录主表
  db.run(`
    CREATE TABLE IF NOT EXISTS tube_histories (
      tube_id TEXT PRIMARY KEY,
      tube_name TEXT NOT NULL,
      tube_type TEXT NOT NULL,
      current_volume REAL,
      current_volume_unit TEXT,
      current_substances TEXT DEFAULT '[]'
    )
  `)

  // 试管历史记录子表
  db.run(`
    CREATE TABLE IF NOT EXISTS tube_history_records (
      id TEXT PRIMARY KEY,
      tube_id TEXT NOT NULL,
      experiment_id TEXT,
      experiment_name TEXT,
      action TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      volume_before REAL,
      volume_after REAL,
      volume_unit TEXT,
      substances_before TEXT DEFAULT '[]',
      substances_after TEXT DEFAULT '[]',
      transfer_from TEXT,
      transfer_to TEXT,
      transfer_volume REAL,
      FOREIGN KEY (tube_id) REFERENCES tube_histories(tube_id) ON DELETE CASCADE
    )
  `)

  // 试管分组表
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      notes TEXT DEFAULT '',
      hidden INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `)

  // 物质颜色配置表
  db.run(`
    CREATE TABLE IF NOT EXISTS substance_colors (
      name TEXT PRIMARY KEY,
      color TEXT NOT NULL,
      bg_color TEXT NOT NULL
    )
  `)

  // 创建索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_history_records_tube_id ON tube_history_records(tube_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_history_records_experiment_id ON tube_history_records(experiment_id)`)
}

function queryAll(sql: string, params: any[] = []): any[] {
  if (!db) {
    console.error('[queryAll] Database not initialized')
    return []
  }
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

function queryOne(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params)
  return results.length > 0 ? results[0] : null
}

async function createWindow() {
  try {
    await initDatabase()
    console.log('Database initialized successfully')
  } catch (e) {
    console.error('Database init failed:', e)
    // 显示错误对话框，不要静默失败
    dialog.showErrorBox('数据库初始化失败', `数据库无法启动，应用将退出。\n错误: ${e}`)
    app.quit()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: path.join(__dirname, 'build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'default',
    show: true
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    console.log('Loading index.html from:', indexPath)
    mainWindow.loadFile(indexPath)
  }
}

app.whenReady().then(async () => {
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ==================== IPC Handlers ====================

ipcMain.handle('get-app-path', () => app.getPath('userData'))

// 试管操作
ipcMain.handle('db:getTubes', async () => {
  await ensureDb()
  return queryAll('SELECT * FROM tubes WHERE status != ? ORDER BY created_at DESC', ['discarded'])
})

ipcMain.handle('db:getTube', async (_, id: string) => {
  await ensureDb()
  return queryOne('SELECT * FROM tubes WHERE id = ?', [id])
})

ipcMain.handle('db:addTube', async (_, tube: any) => {
  try {
    await ensureDb()
    console.log('Adding tube:', tube)
    db.run(
      `INSERT INTO tubes (id, name, type, total_volume, total_volume_unit, remaining_volume, remaining_volume_unit, substances, created_at, updated_at, status, storage_location, storage_condition, notes, tags, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tube.id, tube.name, tube.type, tube.totalVolume, tube.totalVolumeUnit, tube.remainingVolume, tube.remainingVolumeUnit, JSON.stringify(tube.substances), tube.createdAt, tube.updatedAt, tube.status || 'active', tube.storageLocation || null, tube.storageCondition || null, tube.notes || null, JSON.stringify(tube.tags || []), tube.groupId || null]
    )
    saveDatabase()
    return tube
  } catch (error) {
    console.error('Error adding tube:', error)
    throw error
  }
})

ipcMain.handle('db:updateTube', async (_, tube: any) => {
  await ensureDb()
  db.run(
    `UPDATE tubes SET name = ?, type = ?, total_volume = ?, total_volume_unit = ?, remaining_volume = ?, remaining_volume_unit = ?, substances = ?, updated_at = ?, status = ?, storage_location = ?, storage_condition = ?, notes = ?, tags = ?, group_id = ? WHERE id = ?`,
    [tube.name, tube.type, tube.totalVolume, tube.totalVolumeUnit, tube.remainingVolume, tube.remainingVolumeUnit, JSON.stringify(tube.substances), tube.updatedAt, tube.status, tube.storageLocation || null, tube.storageCondition || null, tube.notes || null, JSON.stringify(tube.tags || []), tube.groupId || null, tube.id]
  )
  saveDatabase()
  return tube
})

ipcMain.handle('db:deleteTube', async (_, id: string) => {
  await ensureDb()
  db.run('UPDATE tubes SET status = ? WHERE id = ?', ['discarded', id])
  saveDatabase()
  return { success: true }
})

// 实验操作
ipcMain.handle('db:getExperiments', async () => {
  await ensureDb()
  return queryAll('SELECT * FROM experiments ORDER BY created_at DESC')
})

ipcMain.handle('db:getExperiment', async (_, id: string) => {
  await ensureDb()
  return queryOne('SELECT * FROM experiments WHERE id = ?', [id])
})

ipcMain.handle('db:saveExperiment', async (_, exp: any) => {
  await ensureDb()
  const existing = queryOne('SELECT id FROM experiments WHERE id = ?', [exp.id])

  if (existing) {
    db.run(
      `UPDATE experiments SET name = ?, description = ?, updated_at = ?, completed_at = ?, status = ?, tubes = ?, tube_positions = ?, connections = ?, warehouse_snapshot = ?, initial_state_tubes = ?, end_state_tubes = ?, is_waste = ? WHERE id = ?`,
      [exp.name, exp.description || null, exp.updated_at, exp.completed_at || null, exp.status,
       JSON.stringify(exp.tubes), JSON.stringify(exp.tube_positions || []), JSON.stringify(exp.connections),
       exp.warehouse_snapshot || null, exp.initial_state_tubes || null, exp.end_state_tubes || null,
       exp.is_waste ? 1 : 0, exp.id]
    )
  } else {
    db.run(
      `INSERT INTO experiments (id, name, description, created_at, updated_at, completed_at, status, tubes, tube_positions, connections, warehouse_snapshot, initial_state_tubes, end_state_tubes, is_waste) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [exp.id, exp.name, exp.description || null, exp.created_at, exp.updated_at, exp.completed_at || null, exp.status,
       JSON.stringify(exp.tubes), JSON.stringify(exp.tube_positions || []), JSON.stringify(exp.connections),
       exp.warehouse_snapshot || null, exp.initial_state_tubes || null, exp.end_state_tubes || null,
       exp.is_waste ? 1 : 0]
    )
  }
  saveDatabase()
  return exp
})

ipcMain.handle('db:deleteExperiment', async (_, id: string) => {
  await ensureDb()
  db.run('DELETE FROM tube_usage_records WHERE experiment_id = ?', [id])
  db.run('DELETE FROM experiments WHERE id = ?', [id])
  saveDatabase()
  return { success: true }
})

// 试管使用记录
ipcMain.handle('db:getTubeUsage', async (_, tubeId: string) => {
  await ensureDb()
  return queryAll('SELECT * FROM tube_usage_records WHERE tube_id = ? ORDER BY timestamp DESC', [tubeId])
})

ipcMain.handle('db:addTubeUsage', async (_, record: any) => {
  await ensureDb()
  db.run(
    `INSERT INTO tube_usage_records (id, tube_id, experiment_id, action, volume_change, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [record.id || crypto.randomUUID(), record.tubeId, record.experimentId, record.action, record.volumeChange || null, record.timestamp, record.details ? JSON.stringify(record.details) : null]
  )
  saveDatabase()
  return record
})

// 清除所有数据库数据
ipcMain.handle('db:clearAllData', async () => {
  try {
    await ensureDb()
    db.run('DELETE FROM tube_history_records')
    db.run('DELETE FROM tube_histories')
    db.run('DELETE FROM tube_usage_records')
    db.run('DELETE FROM experiments')
    db.run('DELETE FROM tubes')
    db.run('DELETE FROM groups')
    db.run('DELETE FROM substance_colors')
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('Failed to clear database:', error)
    return { success: false, error: (error as Error).message }
  }
})

// ==================== 试管历史记录操作 ====================

ipcMain.handle('db:getTubeHistories', async () => {
  await ensureDb()
  const histories = queryAll('SELECT * FROM tube_histories')
  const records = queryAll('SELECT * FROM tube_history_records ORDER BY timestamp ASC')

  // 组装数据：将 records 按 tube_id 分组
  const recordsByTubeId = new Map<string, any[]>()
  for (const record of records) {
    const tubeId = record.tube_id
    if (!recordsByTubeId.has(tubeId)) {
      recordsByTubeId.set(tubeId, [])
    }
    recordsByTubeId.get(tubeId)!.push(record)
  }

  return histories.map(h => ({
    tubeId: h.tube_id,
    tubeName: h.tube_name,
    tubeType: h.tube_type,
    currentVolume: h.current_volume,
    currentVolumeUnit: h.current_volume_unit,
    currentSubstances: JSON.parse(h.current_substances || '[]'),
    records: (recordsByTubeId.get(h.tube_id) || []).map(r => ({
      id: r.id,
      tubeId: r.tube_id,
      experimentId: r.experiment_id,
      experimentName: r.experiment_name,
      action: r.action,
      timestamp: r.timestamp,
      volumeBefore: r.volume_before,
      volumeAfter: r.volume_after,
      volumeUnit: r.volume_unit,
      substancesBefore: JSON.parse(r.substances_before || '[]'),
      substancesAfter: JSON.parse(r.substances_after || '[]'),
      transferFrom: r.transfer_from,
      transferTo: r.transfer_to,
      transferVolume: r.transfer_volume
    }))
  }))
})

ipcMain.handle('db:saveTubeHistory', async (_, history: any) => {
  await ensureDb()
  try {
    // 保存主记录
    db.run(
      `INSERT OR REPLACE INTO tube_histories (tube_id, tube_name, tube_type, current_volume, current_volume_unit, current_substances) VALUES (?, ?, ?, ?, ?, ?)`,
      [history.tubeId, history.tubeName, history.tubeType, history.currentVolume, history.currentVolumeUnit, JSON.stringify(history.currentSubstances)]
    )

    // 删除旧的 records
    db.run('DELETE FROM tube_history_records WHERE tube_id = ?', [history.tubeId])

    // 插入新的 records
    for (const record of history.records) {
      db.run(
        `INSERT INTO tube_history_records (id, tube_id, experiment_id, experiment_name, action, timestamp, volume_before, volume_after, volume_unit, substances_before, substances_after, transfer_from, transfer_to, transfer_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, history.tubeId, record.experimentId, record.experimentName, record.action, record.timestamp, record.volumeBefore, record.volumeAfter, record.volumeUnit, JSON.stringify(record.substancesBefore), JSON.stringify(record.substancesAfter), record.transferFrom, record.transferTo, record.transferVolume]
      )
    }

    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:saveTubeHistory] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('db:deleteTubeHistory', async (_, tubeId: string) => {
  await ensureDb()
  try {
    db.run('DELETE FROM tube_history_records WHERE tube_id = ?', [tubeId])
    db.run('DELETE FROM tube_histories WHERE tube_id = ?', [tubeId])
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:deleteTubeHistory] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 批量保存历史记录（用于完整同步）
ipcMain.handle('db:saveTubeHistories', async (_, histories: any[]) => {
  await ensureDb()
  try {
    // 清空旧数据
    db.run('DELETE FROM tube_history_records')
    db.run('DELETE FROM tube_histories')

    // 批量插入
    for (const history of histories) {
      db.run(
        `INSERT INTO tube_histories (tube_id, tube_name, tube_type, current_volume, current_volume_unit, current_substances) VALUES (?, ?, ?, ?, ?, ?)`,
        [history.tubeId, history.tubeName, history.tubeType, history.currentVolume, history.currentVolumeUnit, JSON.stringify(history.currentSubstances)]
      )

      for (const record of history.records) {
        db.run(
          `INSERT INTO tube_history_records (id, tube_id, experiment_id, experiment_name, action, timestamp, volume_before, volume_after, volume_unit, substances_before, substances_after, transfer_from, transfer_to, transfer_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [record.id, history.tubeId, record.experimentId, record.experimentName, record.action, record.timestamp, record.volumeBefore, record.volumeAfter, record.volumeUnit, JSON.stringify(record.substancesBefore), JSON.stringify(record.substancesAfter), record.transferFrom, record.transferTo, record.transferVolume]
        )
      }
    }

    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:saveTubeHistories] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// ==================== 试管分组操作 ====================

ipcMain.handle('db:getGroups', async () => {
  await ensureDb()
  return queryAll('SELECT * FROM groups ORDER BY created_at DESC')
})

ipcMain.handle('db:saveGroup', async (_, group: any) => {
  await ensureDb()
  try {
    db.run(
      `INSERT OR REPLACE INTO groups (id, name, color, notes, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [group.id, group.name, group.color, group.notes || '', group.hidden ? 1 : 0, group.createdAt]
    )
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:saveGroup] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('db:deleteGroup', async (_, id: string) => {
  await ensureDb()
  try {
    db.run('DELETE FROM groups WHERE id = ?', [id])
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:deleteGroup] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 批量保存分组（用于完整同步）
ipcMain.handle('db:saveGroups', async (_, groups: any[]) => {
  await ensureDb()
  try {
    db.run('DELETE FROM groups')
    for (const group of groups) {
      db.run(
        `INSERT INTO groups (id, name, color, notes, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [group.id, group.name, group.color, group.notes || '', group.hidden ? 1 : 0, group.createdAt]
      )
    }
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:saveGroups] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// ==================== 物质颜色配置操作 ====================

ipcMain.handle('db:getSubstanceColors', async () => {
  await ensureDb()
  return queryAll('SELECT * FROM substance_colors')
})

ipcMain.handle('db:saveSubstanceColor', async (_, color: any) => {
  await ensureDb()
  try {
    db.run(
      `INSERT OR REPLACE INTO substance_colors (name, color, bg_color) VALUES (?, ?, ?)`,
      [color.name, color.color, color.bgColor]
    )
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:saveSubstanceColor] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('db:deleteSubstanceColor', async (_, name: string) => {
  await ensureDb()
  try {
    db.run('DELETE FROM substance_colors WHERE name = ?', [name])
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:deleteSubstanceColor] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 批量保存颜色配置（用于完整同步）
ipcMain.handle('db:saveSubstanceColors', async (_, colors: any[]) => {
  await ensureDb()
  try {
    db.run('DELETE FROM substance_colors')
    for (const color of colors) {
      db.run(
        `INSERT INTO substance_colors (name, color, bg_color) VALUES (?, ?, ?)`,
        [color.name, color.color, color.bgColor]
      )
    }
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('[db:saveSubstanceColors] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// ==================== 备份系统 ====================

const BACKUP_VERSION = '2.0.0'
const MAX_SNAPSHOTS = 50
const MANIFEST_FILENAME = 'manifest.json'

interface SnapshotInfo {
  id: string
  timestamp: string
  filename: string
  localStorage: Record<string, string | null>
  stats: { tubes: number; experiments: number; histories: number; groups: number; tubeHistories: number; substanceColors: number }
}

interface Manifest {
  snapshots: SnapshotInfo[]
}

// 自动备份定时器
let autoBackupTimer: ReturnType<typeof setInterval> | null = null
let autoBackupIntervalMs: number = 30 * 60 * 1000 // 默认 30 分钟

function readManifest(): Manifest {
  const manifestPath = path.join(getBackupDir(), MANIFEST_FILENAME)
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch {
      return { snapshots: [] }
    }
  }
  return { snapshots: [] }
}

function writeManifest(manifest: Manifest) {
  const manifestPath = path.join(getBackupDir(), MANIFEST_FILENAME)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

function calculateDbStats(): { tubes: number; experiments: number; histories: number; groups: number; tubeHistories: number; substanceColors: number } {
  try {
    const tubes = queryAll('SELECT COUNT(*) as count FROM tubes').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM tubes')[0].count : 0
    const experiments = queryAll('SELECT COUNT(*) as count FROM experiments').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM experiments')[0].count : 0
    const histories = queryAll('SELECT COUNT(*) as count FROM tube_usage_records').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM tube_usage_records')[0].count : 0
    const groups = queryAll('SELECT COUNT(*) as count FROM groups').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM groups')[0].count : 0
    const tubeHistories = queryAll('SELECT COUNT(*) as count FROM tube_histories').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM tube_histories')[0].count : 0
    const substanceColors = queryAll('SELECT COUNT(*) as count FROM substance_colors').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM substance_colors')[0].count : 0
    return { tubes, experiments, histories, groups, tubeHistories, substanceColors }
  } catch {
    return { tubes: 0, experiments: 0, histories: 0, groups: 0, tubeHistories: 0, substanceColors: 0 }
  }
}

// 执行快照创建（主进程内部调用）
async function performSnapshot(localStorageData?: Record<string, string | null>): Promise<SnapshotInfo | null> {
  try {
    await ensureDb()
    const backupDir = getBackupDir()
    const now = new Date()
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `snapshot-${dateStr}.db`
    const snapshotId = crypto.randomUUID()

    // 复制数据库文件
    const dbPath = getDbPath()
    if (!fs.existsSync(dbPath)) {
      console.error('[Backup] Database file not found:', dbPath)
      return null
    }
    fs.copyFileSync(dbPath, path.join(backupDir, filename))

    // 统计信息（现在全部从 SQLite 获取）
    const stats = calculateDbStats()

    const snapshot: SnapshotInfo = {
      id: snapshotId,
      timestamp: now.toISOString(),
      filename,
      localStorage: localStorageData || {},
      stats
    }

    // 更新 manifest
    const manifest = readManifest()
    manifest.snapshots.unshift(snapshot)
    // 限制数量
    while (manifest.snapshots.length > MAX_SNAPSHOTS) {
      const removed = manifest.snapshots.pop()
      if (removed) {
        const oldPath = path.join(backupDir, removed.filename)
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
      }
    }
    writeManifest(manifest)

    console.log('[Backup] Snapshot created:', filename)
    return snapshot
  } catch (error) {
    console.error('[Backup] Snapshot creation failed:', error)
    return null
  }
}

// 启动自动备份
function startAutoBackup(intervalMs: number, localStorageData?: Record<string, string | null>) {
  stopAutoBackup()
  autoBackupIntervalMs = intervalMs
  autoBackupTimer = setInterval(() => {
    console.log('[AutoBackup] Creating snapshot...')
    // 注意：自动备份时无法实时获取 localStorage 数据，使用上次传入的数据
    // 这是可接受的，因为 DB 数据是最关键的
    performSnapshot(localStorageData)
  }, intervalMs)
  console.log('[AutoBackup] Started with interval:', Math.round(intervalMs / 1000), 'seconds')
}

// 停止自动备份
function stopAutoBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer)
    autoBackupTimer = null
    console.log('[AutoBackup] Stopped')
  }
}

// ==================== 备份 IPC Handlers ====================

// 获取数据库路径
ipcMain.handle('backup:get-db-path', () => {
  return getDbPath()
})

// 获取备份目录
ipcMain.handle('backup:get-backup-dir', () => {
  return getBackupDir()
})

// 显示保存对话框
ipcMain.handle('backup:show-save-dialog', async () => {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
  const defaultName = `LabFlow-备份-${dateStr}-${timeStr}.labflow`

  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出备份',
    defaultPath: defaultName,
    filters: [
      { name: 'LabFlow 备份', extensions: ['labflow'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  return result
})

// 显示打开对话框
ipcMain.handle('backup:show-open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '导入备份',
    filters: [
      { name: 'LabFlow 备份', extensions: ['labflow'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  return result
})

// 导出备份
ipcMain.handle('backup:export', async (_, localStorageData: Record<string, string | null>) => {
  try {
    // 显示保存对话框
    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
    const defaultName = `LabFlow-备份-${dateStr}-${timeStr}.labflow`

    const dialogResult = await dialog.showSaveDialog(mainWindow!, {
      title: '导出备份',
      defaultPath: defaultName,
      filters: [
        { name: 'LabFlow 备份', extensions: ['labflow'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, canceled: true }
    }

    // 读取数据库文件
    const dbPath = getDbPath()
    if (!fs.existsSync(dbPath)) {
      return { success: false, error: '数据库文件不存在' }
    }
    const dbBuffer = fs.readFileSync(dbPath)
    const dbBase64 = dbBuffer.toString('base64')

    // 构建备份数据
    const backupData = {
      version: BACKUP_VERSION,
      timestamp: now.toISOString(),
      appVersion: app.getVersion(),
      db: dbBase64,
      localStorage: localStorageData
    }

    // 写入文件
    fs.writeFileSync(dialogResult.filePath, JSON.stringify(backupData), 'utf-8')

    return { success: true, filePath: dialogResult.filePath }
  } catch (error) {
    console.error('[Backup] Export failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 导入备份
ipcMain.handle('backup:import', async () => {
  try {
    // 显示打开对话框
    const dialogResult = await dialog.showOpenDialog(mainWindow!, {
      title: '导入备份',
      filters: [
        { name: 'LabFlow 备份', extensions: ['labflow'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const filePath = dialogResult.filePaths[0]
    const content = fs.readFileSync(filePath, 'utf-8')
    const backupData = JSON.parse(content)

    // 兼容 v1.x 格式（纯 JSON localStorage 数据）
    if (backupData.version && backupData.version.startsWith('1.')) {
      if (!backupData.data) {
        return { success: false, error: '无效的备份文件格式' }
      }
      // v1.x 格式没有 db 字段，只恢复 localStorage
      return {
        success: true,
        legacy: true,
        localStorage: backupData.data,
        version: backupData.version
      }
    }

    // v2.x 格式（包含数据库）
    if (!backupData.db) {
      return { success: false, error: '无效的备份文件格式：缺少数据库数据' }
    }

    // 恢复数据库
    const dbPath = getDbPath()
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    const dbBuffer = Buffer.from(backupData.db, 'base64')
    fs.writeFileSync(dbPath, dbBuffer)

    // 重新加载数据库
    if (db) {
      db.close()
    }
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)

    // 执行迁移（旧备份可能缺少新列）
    migrateDatabase()

    return {
      success: true,
      localStorage: backupData.localStorage || {},
      version: backupData.version
    }
  } catch (error) {
    console.error('[Backup] Import failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 创建快照
ipcMain.handle('backup:create-snapshot', async (_, localStorageData: Record<string, string | null>) => {
  const snapshot = await performSnapshot(localStorageData)
  return snapshot ? { success: true, snapshot } : { success: false, error: '快照创建失败' }
})

// 列出快照
ipcMain.handle('backup:list-snapshots', async () => {
  const manifest = readManifest()
  return manifest.snapshots
})

// 恢复快照
ipcMain.handle('backup:restore-snapshot', async (_, snapshotId: string) => {
  try {
    const manifest = readManifest()
    const snapshot = manifest.snapshots.find(s => s.id === snapshotId)
    if (!snapshot) {
      return { success: false, error: '快照不存在' }
    }

    const backupDir = getBackupDir()
    const snapshotPath = path.join(backupDir, snapshot.filename)
    if (!fs.existsSync(snapshotPath)) {
      return { success: false, error: '快照文件不存在' }
    }

    // 恢复数据库
    const dbPath = getDbPath()
    fs.copyFileSync(snapshotPath, dbPath)

    // 重新加载数据库
    if (db) {
      db.close()
    }
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)

    // 执行迁移（旧快照可能缺少新列）
    migrateDatabase()

    return { success: true, localStorage: snapshot.localStorage }
  } catch (error) {
    console.error('[Backup] Restore failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 删除快照
ipcMain.handle('backup:delete-snapshot', async (_, snapshotId: string) => {
  try {
    const manifest = readManifest()
    const index = manifest.snapshots.findIndex(s => s.id === snapshotId)
    if (index === -1) {
      return { success: false, error: '快照不存在' }
    }

    const snapshot = manifest.snapshots[index]
    const backupDir = getBackupDir()
    const snapshotPath = path.join(backupDir, snapshot.filename)
    if (fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath)
    }

    manifest.snapshots.splice(index, 1)
    writeManifest(manifest)

    return { success: true }
  } catch (error) {
    console.error('[Backup] Delete failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 在资源管理器中打开备份目录
ipcMain.handle('backup:open-folder', async () => {
  const dir = getBackupDir()
  shell.openPath(dir)
})

// 启动自动备份
ipcMain.handle('backup:start-auto-backup', async (_, intervalMinutes: number, localStorageData: Record<string, string | null>) => {
  startAutoBackup(intervalMinutes * 60 * 1000, localStorageData)
  return { success: true }
})

// 停止自动备份
ipcMain.handle('backup:stop-auto-backup', async () => {
  stopAutoBackup()
  return { success: true }
})

// ==================== 存储路径配置 IPC Handlers ====================

// 获取当前存储配置
ipcMain.handle('config:get-storage', () => {
  const config = loadConfig()
  return {
    dbPath: getDbPath(),
    backupDir: getBackupDir(),
    isCustomDbPath: !!config.dbPath,
    isCustomBackupDir: !!config.backupDir,
  }
})

// 弹出文件夹选择对话框
ipcMain.handle('config:show-folder-dialog', async (_, options: { title: string; defaultPath?: string }) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: ['openDirectory', 'createDirectory']
  })
  return result
})

// 设置数据库路径（需要重启）
ipcMain.handle('config:set-db-path', async (_, newPath: string) => {
  try {
    if (!path.isAbsolute(newPath)) {
      return { success: false, error: '路径必须是绝对路径' }
    }

    // 如果传入的是目录，自动拼接文件名
    if (!path.extname(newPath).toLowerCase().endsWith('.db')) {
      newPath = path.join(newPath, 'labflow.db')
    }

    const dbDir = path.dirname(newPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    // 测试目录可写性
    const testFile = path.join(dbDir, '.labflow_write_test')
    try {
      fs.writeFileSync(testFile, '')
      fs.unlinkSync(testFile)
    } catch {
      return { success: false, error: '目录不可写，请选择其他位置' }
    }

    const currentDbPath = getDbPath()

    // 路径未变更
    if (path.resolve(newPath) === path.resolve(currentDbPath)) {
      return { success: true, changed: false }
    }

    // 目标位置已存在文件（且不是当前数据库）
    if (fs.existsSync(newPath) && path.resolve(newPath) !== path.resolve(currentDbPath)) {
      return { success: false, error: '目标位置已存在数据库文件，请先手动处理冲突' }
    }

    // 先将内存中的数据库保存到旧路径
    saveDatabase()

    // 复制数据库文件到新位置
    if (fs.existsSync(currentDbPath)) {
      fs.copyFileSync(currentDbPath, newPath)
    }

    // 保存配置
    const config = loadConfig()
    config.dbPath = newPath
    saveConfig(config)

    return { success: true, changed: true, needsRestart: true }
  } catch (error) {
    console.error('[Config] Set db path failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 设置备份目录
ipcMain.handle('config:set-backup-dir', async (_, newDir: string) => {
  try {
    if (!path.isAbsolute(newDir)) {
      return { success: false, error: '路径必须是绝对路径' }
    }

    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true })
    }

    // 测试目录可写性
    const testFile = path.join(newDir, '.labflow_write_test')
    try {
      fs.writeFileSync(testFile, '')
      fs.unlinkSync(testFile)
    } catch {
      return { success: false, error: '目录不可写，请选择其他位置' }
    }

    const currentBackupDir = getBackupDir()

    // 路径未变更
    if (path.resolve(newDir) === path.resolve(currentBackupDir)) {
      return { success: true, changed: false }
    }

    // 保存配置
    const config = loadConfig()
    config.backupDir = newDir
    saveConfig(config)

    return { success: true, changed: true }
  } catch (error) {
    console.error('[Config] Set backup dir failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 重置为默认路径
ipcMain.handle('config:reset-paths', async () => {
  try {
    const config = loadConfig()
    delete config.dbPath
    delete config.backupDir
    saveConfig(config)
    return { success: true, needsRestart: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

// 重启应用
ipcMain.handle('config:restart-app', () => {
  app.relaunch()
  app.exit(0)
})
