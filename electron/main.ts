import { app, BrowserWindow, ipcMain } from 'electron'
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
  await initDatabase()
  
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
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
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
  db.run(
    `INSERT INTO tubes (id, name, type, total_volume, total_volume_unit, remaining_volume, remaining_volume_unit, substances, created_at, updated_at, status, storage_location, storage_condition, notes, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tube.id, tube.name, tube.type, tube.totalVolume, tube.totalVolumeUnit, tube.remainingVolume, tube.remainingVolumeUnit, JSON.stringify(tube.substances), tube.createdAt, tube.updatedAt, tube.status || 'active', tube.storageLocation || null, tube.storageCondition || null, tube.notes || null, JSON.stringify(tube.tags || [])]
  )
  saveDatabase()
  return tube
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
