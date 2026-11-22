import { classifyStoreEvent, createWriteTracker, type StoreChangePayload } from './storeWatcher'
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// 导出设置的默认值与校验规则只有一份，直接在渲染进程/测试用的 core 里取
// （只引 settings.ts，避免把 js-yaml 带进主进程启动路径）
import { normalizeExportSettings, type ExportSettings } from '../src/core/exporters/settings'
import { LOCK_FILENAME, parseAgentLock, type ParsedAgentLock } from '../src/core/lock'
// 数据正本目录（第 1 步：正本是 yml，数据库降为缓存）
import {
  DEFAULT_DATA_ROOT,
  ensureDataRoot,
  exportDir,
  listProjectFiles,
  projectDir,
  readProjectFile,
  readTextFile,
  resolveProjectPath,
  statFile,
  WAREHOUSE_FILENAME,
  warehousePath,
  writeDerivedFiles,
  writeFileAtomic,
  type FileStat
} from './dataRoot'
// `labflow://` 深链接（从笔记里点链接直接打开工程）
import {
  deliverDeepLink,
  flushPendingDeepLink,
  initialDeepLink,
  registerDeepLinkProtocol,
  setupDeepLinkHandlers
} from './deepLink'

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
  // 工程导出设置（讲述者页的「导出」用；第 1 步新增）
  exportDir?: string            // 默认导出目录；空 = 每次都弹选择框
  exportFileNameTemplate?: string  // 文件名模板，支持 <日期> <工程名>
  exportAutoSubfolder?: boolean    // 是否按工程名自动建子文件夹
  exportScaleX?: number            // 画布横向比例（0.5–4.0，步长 0.1），默认 1.6
  exportScaleY?: number            // 画布纵向比例（0.5–4.0，步长 0.1），默认 1.6
  // 三个开关（2026-11-22 新增）
  exportAutoExportOnSave?: boolean // 实验模拟页保存后自动重新导出，默认开
  exportExportCanvasFile?: boolean // 导出是否写 .canvas，默认开
  exportExportImage?: boolean      // 导出是否额外画 <工程名>.png，默认开
  exportExportDataFile?: boolean   // 导出目录里是否再放一份工程 .yml（只当备份，默认关）
  // 数据正本目录（默认 D:\学习\labflow）；工程/ 仓库/ 导出 都在它下面
  dataRoot?: string
  // 老配置的一次性迁移标记：白板开关默认值从「开」改成「关」
  exportDefaultsV2Migrated?: boolean
  // @deprecated 旧版像素净空，只在读取老配置时折算成比例
  exportSpacingX?: number
  exportSpacingY?: number
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

// 防抖保存 - 避免频繁写入磁盘
let saveTimer: NodeJS.Timeout | null = null
let isSaving = false
let pendingSave = false // 标记是否有待执行的保存

function saveDatabase() {
  if (!db) return

  // 如果正在保存中，标记需要再次保存（不丢弃）
  if (isSaving) {
    pendingSave = true
    return
  }

  // 清除之前的定时器
  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  // 使用防抖，100ms 内的多次保存只执行一次
  saveTimer = setTimeout(() => {
    executeSave()
  }, 100)
}

function executeSave() {
  if (!db) return
  isSaving = true
  pendingSave = false

  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    const dbPath = getDbPath()
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    // 使用异步写入，不阻塞主线程
    fs.writeFile(dbPath, buffer, (err) => {
      if (err) {
        console.error('[saveDatabase] Failed to write:', err)
      }
      isSaving = false
      // 如果保存期间有新的保存请求，立即执行
      if (pendingSave) {
        pendingSave = false
        executeSave()
      }
    })
  } catch (e) {
    console.error('[saveDatabase] Failed to export:', e)
    isSaving = false
    // 如果保存期间有新的保存请求，立即执行
    if (pendingSave) {
      pendingSave = false
      executeSave()
    }
  }
}

// 强制同步保存数据库到磁盘（用于备份导出前）
function forceSaveDatabaseSync() {
  if (!db) return

  // 清除防抖定时器
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  // 等待正在进行的异步保存完成
  // 由于 fs.writeFile 是异步的，我们需要直接同步写入
  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    const dbPath = getDbPath()
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    // 使用同步写入，确保数据立即写入磁盘
    fs.writeFileSync(dbPath, buffer)
    isSaving = false
    pendingSave = false
    console.log('[forceSaveDatabaseSync] Database saved synchronously')
  } catch (e) {
    console.error('[forceSaveDatabaseSync] Failed:', e)
    isSaving = false
    pendingSave = false
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
  // 第二实例绝不建窗口：它只负责把链接转交给主实例，然后立刻退出
  if (!primaryInstance) {
    console.log('[DeepLink] 非主实例，跳过创建窗口')
    return
  }

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
    if (app.isPackaged) return
    // 开发模式下最常见的失败是 vite 已经停了（点链接新起的实例会撞上这个），
    // 直接给一个人看得懂的提示，而不是留一个白窗口
    const retry = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: '开发服务器没连上',
      message: `打不开 http://localhost:5173（${errorCode} ${errorDescription}）`,
      detail: '多半是 vite 没起来或者已经退出了。请在项目目录重新执行 npm run electron:dev，然后点「重试」。',
      buttons: ['重试', '关闭'],
      defaultId: 0,
      cancelId: 1
    })
    if (retry === 0) mainWindow?.loadURL('http://localhost:5173')
  })

  // 页面加载完再补发「启动时就点着链接进来的那一次」，避免渲染进程错过事件
  mainWindow.webContents.on('did-finish-load', () => {
    flushPendingDeepLink()
    // 窗口加载好后把当前锁推一次，界面不用等下一次文件变化
    mainWindow?.webContents.send('lock:changed', readAgentLock())
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

// 单实例锁必须在 ready 之前抢：第二次点链接要唤起已有窗口，而不是开第二个实例
let primaryInstance = false

primaryInstance = setupDeepLinkHandlers()
if (!primaryInstance) {
  // 走到这里只有一个原因：`requestSingleInstanceLock()` 返回 false，即已经有 LabFlow 在跑。
  // 链接已经在那个实例的 `second-instance` 里转交过了；本实例不许做任何事：
  // 不能建窗口、不能碰注册表、不能起 dev 服务器。
  // 用 exit 而不是 quit：quit 是异步的，后面的 whenReady 还会跑、会再开出一个窗口。
  console.log('[DeepLink] 没抢到单实例锁（已有 LabFlow 在运行）→ 直接退出，不开窗口')
  app.exit(0)
}

if (primaryInstance) {
  app.whenReady().then(async () => {
    // 注册 labflow:// 协议（开发模式要带 electron 可执行文件 + 脚本路径，打包后不用带）
    registerDeepLinkProtocol()
    await createWindow()
    startLockWatch()

    // 首次启动时 argv 里就带着链接（Windows 下点链接会新起一个实例再转交）
    const launchLink = initialDeepLink()
    if (launchLink) deliverDeepLink(launchLink)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
}

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

  // 确保所有 JSON 字段都正确序列化
  const tubesJson = JSON.stringify(exp.tubes || [])
  const tubePositionsJson = JSON.stringify(exp.tube_positions || [])
  const connectionsJson = JSON.stringify(exp.connections || [])
  const warehouseSnapshotJson = exp.warehouse_snapshot ? JSON.stringify(exp.warehouse_snapshot) : null
  const initialStateTubesJson = exp.initial_state_tubes ? JSON.stringify(exp.initial_state_tubes) : null
  const endStateTubesJson = exp.end_state_tubes ? JSON.stringify(exp.end_state_tubes) : null

  if (existing) {
    db.run(
      `UPDATE experiments SET name = ?, description = ?, updated_at = ?, completed_at = ?, status = ?, tubes = ?, tube_positions = ?, connections = ?, warehouse_snapshot = ?, initial_state_tubes = ?, end_state_tubes = ?, is_waste = ? WHERE id = ?`,
      [exp.name, exp.description || null, exp.updated_at, exp.completed_at || null, exp.status,
       tubesJson, tubePositionsJson, connectionsJson,
       warehouseSnapshotJson, initialStateTubesJson, endStateTubesJson,
       exp.is_waste ? 1 : 0, exp.id]
    )
  } else {
    db.run(
      `INSERT INTO experiments (id, name, description, created_at, updated_at, completed_at, status, tubes, tube_positions, connections, warehouse_snapshot, initial_state_tubes, end_state_tubes, is_waste) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [exp.id, exp.name, exp.description || null, exp.created_at, exp.updated_at, exp.completed_at || null, exp.status,
       tubesJson, tubePositionsJson, connectionsJson,
       warehouseSnapshotJson, initialStateTubesJson, endStateTubesJson,
       exp.is_waste ? 1 : 0]
    )
  }
  saveDatabase()
  return exp
})

ipcMain.handle('db:deleteExperiment', async (_, id: string) => {
  await ensureDb()
  try {
    db.run('BEGIN TRANSACTION')
    db.run('DELETE FROM tube_usage_records WHERE experiment_id = ?', [id])
    db.run('DELETE FROM experiments WHERE id = ?', [id])
    db.run('COMMIT')
    saveDatabase()
    return { success: true }
  } catch (error) {
    try {
      db.run('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db:deleteExperiment] Rollback failed:', rollbackError)
    }
    console.error('[db:deleteExperiment] Failed:', error)
    throw error
  }
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
    db.run('BEGIN TRANSACTION')
    db.run('DELETE FROM tube_history_records')
    db.run('DELETE FROM tube_histories')
    db.run('DELETE FROM tube_usage_records')
    db.run('DELETE FROM experiments')
    db.run('DELETE FROM tubes')
    db.run('DELETE FROM groups')
    db.run('DELETE FROM substance_colors')
    db.run('COMMIT')
    saveDatabase()
    return { success: true }
  } catch (error) {
    try {
      db.run('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db:clearAllData] Rollback failed:', rollbackError)
    }
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
    // 使用事务确保原子性
    db.run('BEGIN TRANSACTION')

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

    db.run('COMMIT')
    saveDatabase()
    return { success: true }
  } catch (error) {
    try {
      db.run('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db:saveTubeHistory] Rollback failed:', rollbackError)
    }
    console.error('[db:saveTubeHistory] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('db:deleteTubeHistory', async (_, tubeId: string) => {
  await ensureDb()
  try {
    db.run('BEGIN TRANSACTION')
    db.run('DELETE FROM tube_history_records WHERE tube_id = ?', [tubeId])
    db.run('DELETE FROM tube_histories WHERE tube_id = ?', [tubeId])
    db.run('COMMIT')
    saveDatabase()
    return { success: true }
  } catch (error) {
    try {
      db.run('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db:deleteTubeHistory] Rollback failed:', rollbackError)
    }
    console.error('[db:deleteTubeHistory] Failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 批量保存历史记录（用于完整同步）
ipcMain.handle('db:saveTubeHistories', async (_, histories: any[]) => {
  await ensureDb()
  try {
    // 使用事务确保原子性：要么全部成功，要么全部回滚
    db.run('BEGIN TRANSACTION')

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

    db.run('COMMIT')
    saveDatabase()
    return { success: true }
  } catch (error) {
    // 回滚事务，恢复到操作前的状态
    try {
      db.run('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db:saveTubeHistories] Rollback failed:', rollbackError)
    }
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
    db.run('BEGIN TRANSACTION')
    db.run('DELETE FROM groups')
    for (const group of groups) {
      db.run(
        `INSERT INTO groups (id, name, color, notes, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [group.id, group.name, group.color, group.notes || '', group.hidden ? 1 : 0, group.createdAt]
      )
    }
    db.run('COMMIT')
    saveDatabase()
    return { success: true }
  } catch (error) {
    try {
      db.run('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db:saveGroups] Rollback failed:', rollbackError)
    }
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
    db.run('BEGIN TRANSACTION')
    db.run('DELETE FROM substance_colors')
    for (const color of colors) {
      db.run(
        `INSERT INTO substance_colors (name, color, bg_color) VALUES (?, ?, ?)`,
        [color.name, color.color, color.bgColor]
      )
    }
    db.run('COMMIT')
    saveDatabase()
    return { success: true }
  } catch (error) {
    db.run('ROLLBACK')
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

    // 强制保存数据库到磁盘（防抖可能导致数据未写入）
    forceSaveDatabaseSync()

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

    // 强制保存数据库到磁盘（防抖可能导致数据未写入）
    forceSaveDatabaseSync()

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

// ==================== 工程导出（.yml / .canvas / SOP）====================

// 读取导出设置（缺字段用默认值补齐）
ipcMain.handle('config:get-export-settings', () => {
  const config = loadConfig()
  return normalizeExportSettings({
    directory: config.exportDir,
    fileNameTemplate: config.exportFileNameTemplate,
    autoSubfolder: config.exportAutoSubfolder,
    scaleX: config.exportScaleX,
    scaleY: config.exportScaleY,
    autoExportOnSave: config.exportAutoExportOnSave,
    exportCanvasFile: config.exportExportCanvasFile,
    exportImage: config.exportExportImage,
    exportDataFile: config.exportExportDataFile,
    // 旧版存的是像素净空，normalizeExportSettings 里会折算成倍数
    spacingX: config.exportSpacingX,
    spacingY: config.exportSpacingY
  })
})

// 保存导出设置（默认目录 / 文件名模板 / 自动建子文件夹）
ipcMain.handle('config:set-export-settings', async (_, settings: Partial<ExportSettings>) => {
  try {
    const config = loadConfig()
    const merged = normalizeExportSettings({
      directory: settings?.directory !== undefined ? settings.directory : config.exportDir,
      fileNameTemplate:
        settings?.fileNameTemplate !== undefined ? settings.fileNameTemplate : config.exportFileNameTemplate,
      autoSubfolder:
        settings?.autoSubfolder !== undefined ? settings.autoSubfolder : config.exportAutoSubfolder,
      scaleX: settings?.scaleX !== undefined ? settings.scaleX : config.exportScaleX,
      scaleY: settings?.scaleY !== undefined ? settings.scaleY : config.exportScaleY,
      autoExportOnSave:
        settings?.autoExportOnSave !== undefined ? settings.autoExportOnSave : config.exportAutoExportOnSave,
      exportCanvasFile:
        settings?.exportCanvasFile !== undefined ? settings.exportCanvasFile : config.exportExportCanvasFile,
      exportImage: settings?.exportImage !== undefined ? settings.exportImage : config.exportExportImage,
      exportDataFile:
        settings?.exportDataFile !== undefined ? settings.exportDataFile : config.exportExportDataFile,
      spacingX: (settings as { spacingX?: number })?.spacingX,
      spacingY: (settings as { spacingY?: number })?.spacingY
    })

    if (merged.directory) {
      if (!path.isAbsolute(merged.directory)) {
        return { success: false, error: '目录必须是绝对路径' }
      }
      if (!fs.existsSync(merged.directory)) {
        fs.mkdirSync(merged.directory, { recursive: true })
      }
      // 目录可写性测试，避免导出时才发现写不进去
      const testFile = path.join(merged.directory, '.labflow_write_test')
      try {
        fs.writeFileSync(testFile, '')
        fs.unlinkSync(testFile)
      } catch {
        return { success: false, error: '目录不可写，请选择其他位置' }
      }
    }

    config.exportDir = merged.directory
    config.exportFileNameTemplate = merged.fileNameTemplate
    config.exportAutoSubfolder = merged.autoSubfolder
    config.exportScaleX = merged.scaleX
    config.exportScaleY = merged.scaleY
    config.exportAutoExportOnSave = merged.autoExportOnSave
    config.exportExportCanvasFile = merged.exportCanvasFile
    config.exportExportImage = merged.exportImage
    config.exportExportDataFile = merged.exportDataFile
    // 旧字段不再写，避免两套值打架
    delete config.exportSpacingX
    delete config.exportSpacingY
    saveConfig(config)

    return { success: true, settings: merged }
  } catch (error) {
    console.error('[Export] Save settings failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 看板截图：对实验模拟页的画布区域做一次真实截图，返回 PNG 的 base64
// rect 用 CSS 像素（=webContents 的 DIP 坐标），由渲染进程量好画布容器再传上来
ipcMain.handle('export:capture-board', async (_, rect: { x: number; y: number; width: number; height: number }) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const width = Math.max(1, Math.round(rect?.width || 0))
    const height = Math.max(1, Math.round(rect?.height || 0))
    if (width < 40 || height < 40) return null
    const image = await mainWindow.webContents.capturePage({
      x: Math.round(rect?.x || 0),
      y: Math.round(rect?.y || 0),
      width,
      height
    })
    if (image.isEmpty()) return null
    return image.toPNG().toString('base64')
  } catch (error) {
    console.error('[Export] 看板截图失败：', error)
    return null
  }
})

// 一次写出一整个工程的三份文件（一个目录 + 三个文件名）
// 目录为空时弹选择框；开了自动建子文件夹就写在 <目录>/<工程名>/ 下
ipcMain.handle(
  'export:project',
  async (
    _,
    payload: {
      directory?: string
      subfolder?: string
      files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]
    }
  ) => {
    try {
      const files = Array.isArray(payload?.files) ? payload.files : []
      if (files.length === 0) {
        return { success: false, error: '没有要写出的文件' }
      }

      let targetDir = (payload?.directory || '').trim()
      if (!targetDir) {
        const picked = await dialog.showOpenDialog(mainWindow!, {
          title: '选择导出目录',
          properties: ['openDirectory', 'createDirectory']
        })
        if (picked.canceled || picked.filePaths.length === 0) {
          return { success: false, canceled: true }
        }
        targetDir = picked.filePaths[0]
      }

      // 文件名只允许纯文件名，防止 ../ 之类写到别处
      const safeName = (name: unknown) => path.basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '-')

      const subfolderRaw = payload?.subfolder ? safeName(payload.subfolder) : ''
      const subfolder = subfolderRaw && subfolderRaw !== '.' && subfolderRaw !== '..' ? subfolderRaw : ''
      const dir = subfolder ? path.join(targetDir, subfolder) : targetDir
      fs.mkdirSync(dir, { recursive: true })

      const written: string[] = []
      for (const file of files) {
        const name = safeName(file?.name)
        if (!name || name === '.' || name === '..' || name.startsWith('..')) {
          return { success: false, error: `文件名不合法：${String(file?.name ?? '')}` }
        }
        const filePath = path.join(dir, name)
        // 图片按 base64 解成二进制写，文本按 utf8 写
        if (file?.encoding === 'base64') {
          fs.writeFileSync(filePath, Buffer.from(String(file?.content ?? ''), 'base64'))
        } else {
          fs.writeFileSync(filePath, String(file?.content ?? ''), 'utf-8')
        }
        written.push(filePath)
      }

      return { success: true, directory: dir, files: written }
    } catch (error) {
      console.error('[Export] Project export failed:', error)
      return { success: false, error: (error as Error).message }
    }
  }
)

// ==================== 数据正本目录（工程/ 仓库/ 导出） ====================

function getDataRoot(): string {
  const config = loadConfig()
  const root = config.dataRoot && config.dataRoot.trim() ? config.dataRoot : DEFAULT_DATA_ROOT
  return root
}

/** 老配置一次性迁移：白板开关的默认值从「开」改成「关」（正本迁移后笔记里看 PNG 就够） */
function migrateExportDefaultsOnce(): void {
  const config = loadConfig()
  if (config.exportDefaultsV2Migrated) return
  config.exportExportCanvasFile = false
  if (config.exportExportDataFile === undefined) config.exportExportDataFile = false
  config.exportDefaultsV2Migrated = true
  saveConfig(config)
  console.log('[Config] 导出默认值已迁移到第 1 步版本：白板关、截图开、数据关')
}

// ==================== Agent 锁（第 2 步） ====================

function lockFilePath(): string {
  return path.join(getDataRoot(), LOCK_FILENAME)
}

/** 读一次锁文件，坏内容也返回（不抛） */
function readAgentLock(): ParsedAgentLock {
  try {
    const file = lockFilePath()
    if (!fs.existsSync(file)) return null
    return parseAgentLock(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    console.warn('[Lock] 读锁失败：', (error as Error).message)
    return { broken: true, raw: '', reason: '读取失败' }
  }
}

function broadcastAgentLock(): void {
  const payload = readAgentLock()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('lock:changed', payload)
  }
}

const storeWriteTracker = createWriteTracker()
let storeWatchTimer: ReturnType<typeof setTimeout> | null = null
let pendingStoreChange: StoreChangePayload | null = null
const storeWatchers: fs.FSWatcher[] = []

/**
 * 扫一遍正本目录，找出「不是我们刚写的」那些文件（内容哈希变了才算变）。
 * 每个判定都打日志，方便判断卡在哪一层。
 */
function collectStoreChanges(root: string, options: { quiet?: boolean } = {}): StoreChangePayload {
  const quiet = options.quiet === true
  const payload: StoreChangePayload = { warehouse: false, projects: [] }

  const whFile = warehousePath(root)
  const whContent = readTextFile(whFile)
  if (storeWriteTracker.shouldBroadcast(whFile, whContent)) {
    payload.warehouse = true
    if (!quiet) console.log('[Store] 变更：', WAREHOUSE_FILENAME)
  } else if (!quiet && whContent !== null) {
    console.log('[Store] 忽略自写：', WAREHOUSE_FILENAME)
  }

  const dir = projectDir(root)
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.yml') && !name.includes('.tmp'))
  } catch {
    files = []
  }
  for (const name of files) {
    const file = path.join(dir, name)
    if (storeWriteTracker.shouldBroadcast(file, readTextFile(file))) {
      payload.projects.push(name)
      if (!quiet) console.log('[Store] 变更：', name)
    } else if (!quiet) {
      console.log('[Store] 忽略自写：', name)
    }
  }
  return payload
}

function flushStoreChange(): void {
  storeWatchTimer = null
  const payload = pendingStoreChange
  pendingStoreChange = null
  if (!payload) return
  if (!payload.warehouse && payload.projects.length === 0) return

  const windows = BrowserWindow.getAllWindows()
  console.log('[Store] 广播外部改动：warehouse=' + payload.warehouse + ' projects=' + JSON.stringify(payload.projects) + ' 窗口数=' + windows.length)
  for (const win of windows) {
    win.webContents.send('store:filesChanged', payload)
  }
}

/** 事件攒 150ms 再扫（一次保存会连着来好几个 fs 事件） */
function scheduleStoreScan(reason: string): void {
  if (storeWatchTimer) return
  storeWatchTimer = setTimeout(() => {
    try {
      const next = collectStoreChanges(getDataRoot())
      if (next.warehouse || next.projects.length > 0) {
        pendingStoreChange = pendingStoreChange
          ? { warehouse: pendingStoreChange.warehouse || next.warehouse, projects: [...new Set([...pendingStoreChange.projects, ...next.projects])] }
          : next
      }
      if (!pendingStoreChange) console.log('[Store] 扫描完成（无外部改动）：', reason)
      flushStoreChange()
    } catch (error) {
      console.warn('[Store] 扫描正本目录失败：', (error as Error).message)
    }
  }, 150)
}

function watchDir(dir: string, label: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const watcher = fs.watch(dir, (_event, filename) => {
      const name = filename ? String(filename) : ''
      console.log('[Store] fs 事件：', label + (name ? '/' + name : '（无文件名）'))
      const kind = classifyStoreEvent(name)
      if (kind.kind === 'lock') {
        broadcastAgentLock()
        return
      }
      scheduleStoreScan(label + (name ? '/' + name : ''))
    })
    watcher.on('error', error => {
      console.warn('[Store] 监听中断（' + label + '）：', (error as Error).message)
    })
    storeWatchers.push(watcher)
    console.log('[Store] 正在监听：', dir)
  } catch (error) {
    console.warn('[Store] 无法监听 ' + dir + '：', (error as Error).message)
  }
}

/**
 * 监听正本目录。
 * fs.watch 默认不递归：工程/ 是子目录，只 watch 根目录会漏掉 工程/xxx.yml 的所有变化，
 * 必须把根目录和 工程/ 分别 watch（这就是上一版热加载没生效的原因）。
 */
function startLockWatch(): void {
  if (storeWatchers.length > 0) return
  const root = getDataRoot()
  try {
    ensureDataRoot(root)
    // 先拍一次快照（quiet），避免启动瞬间把现有文件当成「刚被改」
    collectStoreChanges(root, { quiet: true })
    watchDir(root, '根目录')
    watchDir(projectDir(root), '工程')
  } catch (error) {
    console.warn('[Lock] 无法启动正本监听：', (error as Error).message)
  }
}

ipcMain.handle('lock:get', () => readAgentLock())

ipcMain.handle('lock:forceRelease', () => {
  try {
    const file = lockFilePath()
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
})

ipcMain.handle('data:get-info', () => {
  const root = getDataRoot()
  const ok = ensureDataRoot(root)
  return {
    root,
    projectDir: projectDir(root),
    exportDir: exportDir(root),
    warehousePath: warehousePath(root),
    ok,
    projects: listProjectFiles(root).map(file => ({ name: file.name, fileName: file.fileName, stat: file.stat }))
  }
})

ipcMain.handle('data:set-root', async (_, nextRoot: string) => {
  try {
    if (!nextRoot || !path.isAbsolute(nextRoot)) return { success: false, error: '路径必须是绝对路径' }
    const ok = ensureDataRoot(nextRoot)
    if (!ok) return { success: false, error: '目录不可用（盘符不存在或无权限）' }
    const testFile = path.join(nextRoot, '.labflow_write_test')
    try {
      fs.writeFileSync(testFile, '')
      fs.unlinkSync(testFile)
    } catch {
      return { success: false, error: '目录不可写，请换一个位置' }
    }
    const config = loadConfig()
    config.dataRoot = nextRoot
    saveConfig(config)
    return { success: true, root: nextRoot }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('data:list-projects', () => listProjectFiles(getDataRoot()))

ipcMain.handle('data:read-project', (_, fileNameOrName: string) => {
  const root = getDataRoot()
  const found = readProjectFile(root, fileNameOrName)
  if (!found) return { ok: false, reason: 'not-found' as const }
  return { ok: true, path: found.path, content: found.content, stat: found.stat }
})

ipcMain.handle('data:stat-project', (_, fileNameOrName: string) => {
  const root = getDataRoot()
  const found = readProjectFile(root, fileNameOrName)
  return found ? found.stat : null
})

/**
 * 写工程正本。
 * `expect` 是上次读/写时的 {mtimeMs,size}；文件被人手改过就对不上 → 不覆盖，返回 conflict。
 */
ipcMain.handle(
  'data:write-project',
  (_, payload: { id?: string; name: string; content: string; expect?: FileStat | null }) => {
    try {
      const root = getDataRoot()
      ensureDataRoot(root)
      const target = resolveProjectPath(root, payload.id, payload.name)
      const current = statFile(target)

      if (payload.expect && current) {
        const changed = Math.abs(current.mtimeMs - payload.expect.mtimeMs) > 1 || current.size !== payload.expect.size
        if (changed) {
          return { ok: false, conflict: true as const, path: target, stat: current }
        }
      }

      const stat = writeFileAtomic(target, payload.content)
      storeWriteTracker.noteWritten(target, payload.content)
      console.log('[Store] 写工程正本：', target)
      return { ok: true as const, path: target, fileName: path.basename(target), stat }
    } catch (error) {
      console.error('[Store] 写工程正本失败：', error)
      return { ok: false as const, error: (error as Error).message }
    }
  }
)

ipcMain.handle('data:read-warehouse', () => {
  const root = getDataRoot()
  const target = warehousePath(root)
  const content = readTextFile(target)
  if (content === null) return { ok: false as const, reason: 'not-found' as const }
  return { ok: true as const, path: target, content, stat: statFile(target) }
})

ipcMain.handle('data:write-warehouse', (_, payload: { content: string; expect?: FileStat | null }) => {
  try {
    const root = getDataRoot()
    ensureDataRoot(root)
    const target = warehousePath(root)
    const current = statFile(target)
    if (payload.expect && current) {
      const changed = Math.abs(current.mtimeMs - payload.expect.mtimeMs) > 1 || current.size !== payload.expect.size
      if (changed) return { ok: false as const, conflict: true as const, stat: current }
    }
    const stat = writeFileAtomic(target, payload.content)
    storeWriteTracker.noteWritten(target, payload.content)
    console.log('[Store] 写仓库正本：', target)
    return { ok: true as const, path: target, stat }
  } catch (error) {
    return { ok: false as const, error: (error as Error).message }
  }
})

ipcMain.handle(
  'data:write-derived',
  (_, files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]) => {
    try {
      const root = getDataRoot()
      ensureDataRoot(root)
      return { ok: true as const, ...writeDerivedFiles(root, files || []) }
    } catch (error) {
      return { ok: false as const, error: (error as Error).message }
    }
  }
)

/** 保存时撞上外部修改：弹原生对话框，默认按钮是「重新载入」 */
ipcMain.handle('data:ask-conflict', async (_, payload: { projectName: string; fileName?: string }) => {
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    title: '工程文件已被外部修改',
    message: `「${payload.projectName}」的工程文件在 LabFlow 之外被改过。`,
    detail: `${payload.fileName || '工程文件'}\n\n如果选「重新载入」，界面会用文件里的内容覆盖当前未保存的改动；选「用界面覆盖」则把界面上的内容写回文件。`,
    buttons: ['重新载入', '用界面覆盖', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return result.response === 0 ? 'reload' : result.response === 1 ? 'overwrite' : 'cancel'
})

app.whenReady().then(() => {
  migrateExportDefaultsOnce()
})
