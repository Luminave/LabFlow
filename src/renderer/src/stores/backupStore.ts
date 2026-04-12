/**
 * 定时备份状态管理
 * 使用 localStorage 存储快照数据
 */

import { create } from 'zustand'

// 快照数据结构
export interface Snapshot {
  id: string
  timestamp: string
  data: {
    labflow_tubes: string | null
    labflow_current_experiment: string | null
    labflow_experiments: string | null
    labflow_tube_histories: string | null
    substance_colors: string | null
    labflow_groups: string | null
  }
  stats: {
    tubes: number
    experiments: number
    histories: number
    colors: number
    groups: number
  }
  hash: string // 用于检测数据变化
}

// 备份设置
export interface BackupSettings {
  enabled: boolean
  intervalMinutes: number
  skipIfUnchanged: boolean
}

interface BackupState {
  snapshots: Snapshot[]
  settings: BackupSettings
  lastBackupTime: string | null
  timerId: ReturnType<typeof setInterval> | null
  
  // 操作
  loadSnapshots: () => void
  saveSnapshot: (skipIfUnchanged?: boolean) => boolean
  deleteSnapshot: (id: string) => void
  restoreSnapshot: (id: string) => boolean
  updateSettings: (settings: Partial<BackupSettings>) => void
  startAutoBackup: () => void
  stopAutoBackup: () => void
  getDataHash: () => string
}

const SNAPSHOTS_KEY = 'labflow_snapshots'
const SETTINGS_KEY = 'labflow_backup_settings'

// 计算数据哈希（用于检测变化）
function calculateHash(data: Record<string, string | null>): string {
  const str = JSON.stringify(data)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // 转换为32位整数
  }
  return hash.toString(16)
}

// 收集当前数据
function collectCurrentData() {
  return {
    labflow_tubes: localStorage.getItem('labflow_tubes'),
    labflow_current_experiment: localStorage.getItem('labflow_current_experiment'),
    labflow_experiments: localStorage.getItem('labflow_experiments'),
    labflow_tube_histories: localStorage.getItem('labflow_tube_histories'),
    substance_colors: localStorage.getItem('substance_colors'),
    labflow_groups: localStorage.getItem('labflow_groups')
  }
}

// 计算统计数据
function calculateStats(data: Record<string, string | null>) {
  const parse = (str: string | null) => {
    if (!str) return 0
    try {
      const arr = JSON.parse(str)
      return Array.isArray(arr) ? arr.length : 0
    } catch {
      return 0
    }
  }

  return {
    tubes: parse(data.labflow_tubes),
    experiments: parse(data.labflow_experiments),
    histories: parse(data.labflow_tube_histories),
    colors: parse(data.substance_colors),
    groups: parse(data.labflow_groups)
  }
}

export const useBackupStore = create<BackupState>((set, get) => ({
  snapshots: [],
  settings: {
    enabled: false,
    intervalMinutes: 30,
    skipIfUnchanged: true
  },
  lastBackupTime: null,
  timerId: null,

  loadSnapshots: () => {
    try {
      const snapshotsStr = localStorage.getItem(SNAPSHOTS_KEY)
      const snapshots = snapshotsStr ? JSON.parse(snapshotsStr) : []
      
      const settingsStr = localStorage.getItem(SETTINGS_KEY)
      const settings = settingsStr ? JSON.parse(settingsStr) : {
        enabled: false,
        intervalMinutes: 30,
        skipIfUnchanged: true
      }
      
      set({ snapshots, settings })
      
      // 如果设置中启用了自动备份，启动定时器
      if (settings.enabled) {
        get().startAutoBackup()
      }
    } catch (e) {
      console.error('Failed to load snapshots:', e)
    }
  },

  saveSnapshot: (skipIfUnchanged = true) => {
    try {
      const data = collectCurrentData()
      const hash = calculateHash(data)
      
      // 检查是否有变化
      if (skipIfUnchanged) {
        const { snapshots } = get()
        if (snapshots.length > 0 && snapshots[0].hash === hash) {
          console.log('[Backup] No changes detected, skipping snapshot')
          return false
        }
      }
      
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        data,
        stats: calculateStats(data),
        hash
      }
      
      const newSnapshots = [snapshot, ...get().snapshots].slice(0, 100) // 最多保留100个快照
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(newSnapshots))
      
      set({ 
        snapshots: newSnapshots,
        lastBackupTime: snapshot.timestamp
      })
      
      console.log('[Backup] Snapshot saved:', snapshot.id)
      return true
    } catch (e) {
      console.error('Failed to save snapshot:', e)
      return false
    }
  },

  deleteSnapshot: (id) => {
    const newSnapshots = get().snapshots.filter(s => s.id !== id)
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(newSnapshots))
    set({ snapshots: newSnapshots })
  },

  restoreSnapshot: (id) => {
    try {
      const snapshot = get().snapshots.find(s => s.id === id)
      if (!snapshot) {
        console.error('Snapshot not found:', id)
        return false
      }
      
      // 恢复数据到 localStorage
      const keys = [
        'labflow_tubes',
        'labflow_current_experiment',
        'labflow_experiments',
        'labflow_tube_histories',
        'substance_colors',
        'labflow_groups'
      ] as const
      
      for (const key of keys) {
        const value = snapshot.data[key]
        if (value !== null) {
          localStorage.setItem(key, value)
        } else {
          localStorage.removeItem(key)
        }
      }
      
      console.log('[Backup] Restored to snapshot:', id)
      return true
    } catch (e) {
      console.error('Failed to restore snapshot:', e)
      return false
    }
  },

  updateSettings: (newSettings) => {
    const settings = { ...get().settings, ...newSettings }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    set({ settings })
    
    // 重启自动备份
    get().stopAutoBackup()
    if (settings.enabled) {
      get().startAutoBackup()
    }
  },

  startAutoBackup: () => {
    const { settings, timerId } = get()
    
    // 先停止现有的定时器
    if (timerId) {
      clearInterval(timerId)
    }
    
    if (!settings.enabled || settings.intervalMinutes <= 0) {
      return
    }
    
    const newTimerId = setInterval(() => {
      const { settings: currentSettings } = get()
      const saved = get().saveSnapshot(currentSettings.skipIfUnchanged)
      if (saved) {
        console.log('[AutoBackup] Snapshot created')
      }
    }, settings.intervalMinutes * 60 * 1000)
    
    set({ timerId: newTimerId })
    console.log('[AutoBackup] Started with interval:', settings.intervalMinutes, 'minutes')
  },

  stopAutoBackup: () => {
    const { timerId } = get()
    if (timerId) {
      clearInterval(timerId)
      set({ timerId: null })
      console.log('[AutoBackup] Stopped')
    }
  },

  getDataHash: () => {
    const data = collectCurrentData()
    return calculateHash(data)
  }
}))
