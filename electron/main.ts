import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import initSqlJs from 'sql.js'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let SQL: any = null
let db: any = null

// 数据库初始化
async function initDatabase() {
  if (!SQL) {
    SQL = await initSqlJs({})
  }
  
  const userDataPath = app.getPath('userData')
  const dbDir = path.join(userDataPath, 'data')
  const dbPath = path.join(dbDir, 'labflow.db')
  
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
  
  return db
}

function saveDatabase() {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    const dbPath = path.join(app.getPath('userData'), 'data', 'labflow.db')
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
      tags TEXT
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
      end_state_tubes TEXT
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
}

function queryAll(sql: string, params: any[] = []): any[] {
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
  } catch (e) {
    console.error('Database init failed:', e)
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
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
  return queryAll('SELECT * FROM tubes WHERE status != ? ORDER BY created_at DESC', ['discarded'])
})

ipcMain.handle('db:getTube', async (_, id: string) => {
  return queryOne('SELECT * FROM tubes WHERE id = ?', [id])
})

ipcMain.handle('db:addTube', async (_, tube: any) => {
  try {
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
  db.run(
    `UPDATE tubes SET name = ?, total_volume = ?, total_volume_unit = ?, remaining_volume = ?, remaining_volume_unit = ?, substances = ?, updated_at = ?, status = ?, storage_location = ?, storage_condition = ?, notes = ?, tags = ? WHERE id = ?`,
    [tube.name, tube.totalVolume, tube.totalVolumeUnit, tube.remainingVolume, tube.remainingVolumeUnit, JSON.stringify(tube.substances), tube.updatedAt, tube.status, tube.storageLocation || null, tube.storageCondition || null, tube.notes || null, JSON.stringify(tube.tags || []), tube.id]
  )
  saveDatabase()
  return tube
})

ipcMain.handle('db:deleteTube', async (_, id: string) => {
  db.run('UPDATE tubes SET status = ? WHERE id = ?', ['discarded', id])
  saveDatabase()
  return { success: true }
})

// 实验操作
ipcMain.handle('db:getExperiments', async () => {
  return queryAll('SELECT * FROM experiments ORDER BY created_at DESC')
})

ipcMain.handle('db:getExperiment', async (_, id: string) => {
  return queryOne('SELECT * FROM experiments WHERE id = ?', [id])
})

ipcMain.handle('db:saveExperiment', async (_, exp: any) => {
  const existing = queryOne('SELECT id FROM experiments WHERE id = ?', [exp.id])
  
  if (existing) {
    db.run(
      `UPDATE experiments SET name = ?, description = ?, updated_at = ?, completed_at = ?, status = ?, tubes = ?, tube_positions = ?, connections = ?, warehouse_snapshot = ?, initial_state_tubes = ?, end_state_tubes = ? WHERE id = ?`,
      [exp.name, exp.description || null, exp.updated_at, exp.completed_at || null, exp.status, 
       JSON.stringify(exp.tubes), JSON.stringify(exp.tube_positions || []), JSON.stringify(exp.connections), 
       exp.warehouse_snapshot || null, exp.initial_state_tubes || null, exp.end_state_tubes || null, exp.id]
    )
  } else {
    db.run(
      `INSERT INTO experiments (id, name, description, created_at, updated_at, completed_at, status, tubes, tube_positions, connections, warehouse_snapshot, initial_state_tubes, end_state_tubes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [exp.id, exp.name, exp.description || null, exp.created_at, exp.updated_at, exp.completed_at || null, exp.status, 
       JSON.stringify(exp.tubes), JSON.stringify(exp.tube_positions || []), JSON.stringify(exp.connections),
       exp.warehouse_snapshot || null, exp.initial_state_tubes || null, exp.end_state_tubes || null]
    )
  }
  saveDatabase()
  return exp
})

ipcMain.handle('db:deleteExperiment', async (_, id: string) => {
  db.run('DELETE FROM tube_usage_records WHERE experiment_id = ?', [id])
  db.run('DELETE FROM experiments WHERE id = ?', [id])
  saveDatabase()
  return { success: true }
})

// 试管使用记录
ipcMain.handle('db:getTubeUsage', async (_, tubeId: string) => {
  return queryAll('SELECT * FROM tube_usage_records WHERE tube_id = ? ORDER BY timestamp DESC', [tubeId])
})

ipcMain.handle('db:addTubeUsage', async (_, record: any) => {
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
    db.run('DELETE FROM tube_usage_records')
    db.run('DELETE FROM experiments')
    db.run('DELETE FROM tubes')
    saveDatabase()
    return { success: true }
  } catch (error) {
    console.error('Failed to clear database:', error)
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
  stats: { tubes: number; experiments: number; histories: number; groups: number }
}

interface Manifest {
  snapshots: SnapshotInfo[]
}

// 自动备份定时器
let autoBackupTimer: ReturnType<typeof setInterval> | null = null
let autoBackupIntervalMs: number = 30 * 60 * 1000 // 默认 30 分钟

function getBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

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

function calculateDbStats(): { tubes: number; experiments: number; histories: number; groups: number } {
  try {
    const tubes = queryAll('SELECT COUNT(*) as count FROM tubes').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM tubes')[0].count : 0
    const experiments = queryAll('SELECT COUNT(*) as count FROM experiments').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM experiments')[0].count : 0
    const histories = queryAll('SELECT COUNT(*) as count FROM tube_usage_records').length > 0
      ? queryAll('SELECT COUNT(*) as count FROM tube_usage_records')[0].count : 0
    return { tubes, experiments, histories, groups: 0 }
  } catch {
    return { tubes: 0, experiments: 0, histories: 0, groups: 0 }
  }
}

// 执行快照创建（主进程内部调用）
async function performSnapshot(localStorageData?: Record<string, string | null>): Promise<SnapshotInfo | null> {
  try {
    const backupDir = getBackupDir()
    const now = new Date()
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `snapshot-${dateStr}.db`
    const snapshotId = crypto.randomUUID()

    // 复制数据库文件
    const dbPath = path.join(app.getPath('userData'), 'data', 'labflow.db')
    if (!fs.existsSync(dbPath)) {
      console.error('[Backup] Database file not found:', dbPath)
      return null
    }
    fs.copyFileSync(dbPath, path.join(backupDir, filename))

    // 统计信息（包含 groups 从 localStorage）
    const stats = calculateDbStats()
    if (localStorageData?.labflow_groups) {
      try {
        const groups = JSON.parse(localStorageData.labflow_groups)
        stats.groups = Array.isArray(groups) ? groups.length : 0
      } catch { /* ignore */ }
    }

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
  return path.join(app.getPath('userData'), 'data', 'labflow.db')
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
    const dbPath = path.join(app.getPath('userData'), 'data', 'labflow.db')
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
    const dbPath = path.join(app.getPath('userData'), 'data', 'labflow.db')
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
    const dbPath = path.join(app.getPath('userData'), 'data', 'labflow.db')
    fs.copyFileSync(snapshotPath, dbPath)

    // 重新加载数据库
    if (db) {
      db.close()
    }
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)

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
