/**
 * 备份状态管理
 * 通过 Electron IPC 调用主进程进行数据库级别的备份/恢复
 * 快照存储在磁盘文件中，不再依赖 localStorage 容量
 */

import { create } from 'zustand'

// 快照信息（从主进程获取）
export interface SnapshotInfo {
  id: string
  timestamp: string
  filename: string
  localStorage: Record<string, string | null>
  stats: { tubes: number; experiments: number; histories: number; groups: number }
}

// 备份设置
export interface BackupSettings {
  enabled: boolean
  intervalMinutes: number
  skipIfUnchanged: boolean
}

interface BackupState {
  snapshots: SnapshotInfo[]
  settings: BackupSettings
  dbPath: string
  backupDir: string
  loading: boolean
  storageConfig: StorageConfig | null

  // 操作
  loadSnapshots: () => Promise<void>
  loadPaths: () => Promise<void>
  loadStorageConfig: () => Promise<void>
  exportBackup: () => Promise<boolean>
  importBackup: () => Promise<{ success: boolean; needsReload?: boolean }>
  createSnapshot: () => Promise<boolean>
  restoreSnapshot: (id: string) => Promise<boolean>
  deleteSnapshot: (id: string) => Promise<void>
  updateSettings: (settings: Partial<BackupSettings>) => Promise<void>
  openBackupFolder: () => Promise<void>
  changeDbPath: () => Promise<void>
  changeBackupDir: () => Promise<void>
  resetPaths: () => Promise<void>
}

const SETTINGS_KEY = 'labflow_backup_settings'

// 收集前端 localStorage 数据（主题、字号等纯前端设置）
// 注意：groups 和 substance_colors 已迁移到 SQLite，不再需要从 localStorage 收集
function collectLocalStorageData(): Record<string, string | null> {
  return {
    labflow_theme: localStorage.getItem('labflow_theme'),
    labflow_font_size: localStorage.getItem('labflow_font_size'),
    labflow_backup_settings: localStorage.getItem('labflow_backup_settings'),
    // 保留这些字段以兼容旧版备份格式
    labflow_groups: localStorage.getItem('labflow_groups'),
    labflow_substance_colors: localStorage.getItem('labflow_substance_colors'),
  }
}

// 判断是否在 Electron 环境中
function isElectron(): boolean {
  return !!window.electronAPI
}

export const useBackupStore = create<BackupState>((set, get) => ({
  snapshots: [],
  settings: {
    enabled: false,
    intervalMinutes: 30,
    skipIfUnchanged: true
  },
  dbPath: '',
  backupDir: '',
  loading: false,
  storageConfig: null,

  loadPaths: async () => {
    if (!isElectron()) return
    try {
      const api = window.electronAPI!
      const [dbPath, backupDir] = await Promise.all([
        api.backup.getDbPath(),
        api.backup.getBackupDir()
      ])
      set({ dbPath, backupDir })
    } catch (e) {
      console.error('Failed to load paths:', e)
    }
  },

  loadStorageConfig: async () => {
    if (!isElectron()) return
    try {
      const config = await window.electronAPI!.config.getStorage()
      set({ storageConfig: config, dbPath: config.dbPath, backupDir: config.backupDir })
    } catch (e) {
      console.error('Failed to load storage config:', e)
    }
  },

  loadSnapshots: async () => {
    try {
      // 加载设置（仍然从 localStorage 读取，因为这是 UI 设置）
      const settingsStr = localStorage.getItem(SETTINGS_KEY)
      const settings = settingsStr ? JSON.parse(settingsStr) : {
        enabled: false,
        intervalMinutes: 30,
        skipIfUnchanged: true
      }

      if (!isElectron()) {
        set({ settings })
        return
      }

      // 从主进程获取快照列表
      const snapshots = await window.electronAPI!.backup.listSnapshots()
      set({ snapshots, settings })

      // 如果设置中启用了自动备份，通知主进程启动定时器
      if (settings.enabled) {
        const localStorageData = collectLocalStorageData()
        window.electronAPI!.backup.startAutoBackup(settings.intervalMinutes, localStorageData)
      }
    } catch (e) {
      console.error('Failed to load snapshots:', e)
    }
  },

  exportBackup: async () => {
    if (!isElectron()) {
      console.error('Export requires Electron environment')
      return false
    }

    set({ loading: true })
    try {
      const localStorageData = collectLocalStorageData()
      const result = await window.electronAPI!.backup.export(localStorageData)

      if (result.canceled) return false

      if (result.success) {
        alert('✅ 备份已保存到：\n' + result.filePath)
        return true
      } else {
        alert('❌ 备份失败：' + (result.error || '未知错误'))
        return false
      }
    } catch (e) {
      console.error('Export failed:', e)
      alert('❌ 备份失败：' + (e as Error).message)
      return false
    } finally {
      set({ loading: false })
    }
  },

  importBackup: async () => {
    if (!isElectron()) {
      console.error('Import requires Electron environment')
      return { success: false }
    }

    set({ loading: true })
    try {
      const result = await window.electronAPI!.backup.import()

      if (result.canceled) return { success: false }

      if (result.success) {
        // 恢复 localStorage 数据（主题、字号等前端设置）
        if (result.localStorage) {
          // 恢复主题设置
          if (result.localStorage.labflow_theme) {
            localStorage.setItem('labflow_theme', result.localStorage.labflow_theme)
          }
          // 恢复字号设置
          if (result.localStorage.labflow_font_size) {
            localStorage.setItem('labflow_font_size', result.localStorage.labflow_font_size)
          }
          // 恢复备份设置
          if (result.localStorage.labflow_backup_settings) {
            localStorage.setItem('labflow_backup_settings', result.localStorage.labflow_backup_settings)
          }

          // 兼容旧版备份：如果包含 groups 或 substance_colors，迁移到 SQLite
          if (result.localStorage.labflow_groups) {
            try {
              const groups = JSON.parse(result.localStorage.labflow_groups)
              if (Array.isArray(groups) && groups.length > 0) {
                await window.electronAPI!.saveGroups(groups)
              }
            } catch (e) {
              console.error('Failed to restore groups from backup:', e)
            }
          }
          if (result.localStorage.labflow_substance_colors) {
            try {
              const colors = JSON.parse(result.localStorage.labflow_substance_colors)
              if (Array.isArray(colors) && colors.length > 0) {
                await window.electronAPI!.saveSubstanceColors(colors)
              }
            } catch (e) {
              console.error('Failed to restore substance colors from backup:', e)
            }
          }
        }

        const versionInfo = result.legacy ? `\n（兼容模式：v${result.version} 格式，仅恢复前端数据）` : ''
        alert(`✅ 数据导入成功！${versionInfo}\n页面将重新加载以应用新数据。`)
        return { success: true, needsReload: true }
      } else {
        alert('❌ 导入失败：' + (result.error || '未知错误'))
        return { success: false }
      }
    } catch (e) {
      console.error('Import failed:', e)
      alert('❌ 导入失败：' + (e as Error).message)
      return { success: false }
    } finally {
      set({ loading: false })
    }
  },

  createSnapshot: async () => {
    if (!isElectron()) return false

    set({ loading: true })
    try {
      const localStorageData = collectLocalStorageData()
      const result = await window.electronAPI!.backup.createSnapshot(localStorageData)

      if (result.success && result.snapshot) {
        const newSnapshots = [result.snapshot, ...get().snapshots]
        set({ snapshots: newSnapshots })
        alert('✅ 快照已保存！')
        return true
      } else {
        alert('❌ 快照创建失败：' + (result.error || '未知错误'))
        return false
      }
    } catch (e) {
      console.error('Snapshot creation failed:', e)
      alert('❌ 快照创建失败：' + (e as Error).message)
      return false
    } finally {
      set({ loading: false })
    }
  },

  restoreSnapshot: async (id: string) => {
    if (!isElectron()) return false

    set({ loading: true })
    try {
      const result = await window.electronAPI!.backup.restoreSnapshot(id)

      if (result.success) {
        // 恢复 localStorage 数据（主题、字号等前端设置）
        if (result.localStorage) {
          // 恢复主题设置
          if (result.localStorage.labflow_theme) {
            localStorage.setItem('labflow_theme', result.localStorage.labflow_theme)
          }
          // 恢复字号设置
          if (result.localStorage.labflow_font_size) {
            localStorage.setItem('labflow_font_size', result.localStorage.labflow_font_size)
          }
          // 恢复备份设置
          if (result.localStorage.labflow_backup_settings) {
            localStorage.setItem('labflow_backup_settings', result.localStorage.labflow_backup_settings)
          }

          // 兼容旧版快照：如果包含 groups 或 substance_colors，迁移到 SQLite
          if (result.localStorage.labflow_groups) {
            try {
              const groups = JSON.parse(result.localStorage.labflow_groups)
              if (Array.isArray(groups) && groups.length > 0) {
                await window.electronAPI!.saveGroups(groups)
              }
            } catch (e) {
              console.error('Failed to restore groups from snapshot:', e)
            }
          }
          if (result.localStorage.labflow_substance_colors) {
            try {
              const colors = JSON.parse(result.localStorage.labflow_substance_colors)
              if (Array.isArray(colors) && colors.length > 0) {
                await window.electronAPI!.saveSubstanceColors(colors)
              }
            } catch (e) {
              console.error('Failed to restore substance colors from snapshot:', e)
            }
          }
        }
        return true
      } else {
        alert('❌ 恢复失败：' + (result.error || '未知错误'))
        return false
      }
    } catch (e) {
      console.error('Restore failed:', e)
      alert('❌ 恢复失败：' + (e as Error).message)
      return false
    } finally {
      set({ loading: false })
    }
  },

  deleteSnapshot: async (id: string) => {
    if (!isElectron()) return

    try {
      const result = await window.electronAPI!.backup.deleteSnapshot(id)
      if (result.success) {
        const newSnapshots = get().snapshots.filter(s => s.id !== id)
        set({ snapshots: newSnapshots })
      }
    } catch (e) {
      console.error('Delete failed:', e)
    }
  },

  updateSettings: async (newSettings) => {
    const settings = { ...get().settings, ...newSettings }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    set({ settings })

    // 通知主进程更新自动备份
    if (!isElectron()) return

    try {
      if (settings.enabled) {
        const localStorageData = collectLocalStorageData()
        await window.electronAPI!.backup.startAutoBackup(settings.intervalMinutes, localStorageData)
      } else {
        await window.electronAPI!.backup.stopAutoBackup()
      }
    } catch (e) {
      console.error('Failed to update auto-backup settings:', e)
    }
  },

  openBackupFolder: async () => {
    if (!isElectron()) return
    try {
      await window.electronAPI!.backup.openFolder()
    } catch (e) {
      console.error('Failed to open backup folder:', e)
    }
  },

  changeDbPath: async () => {
    if (!isElectron()) return
    try {
      const dialogResult = await window.electronAPI!.config.showFolderDialog({
        title: '选择数据库存储位置',
        defaultPath: get().storageConfig?.dbPath ? get().storageConfig!.dbPath.replace(/[/\\][^/\\]+$/, '') : undefined
      })

      if (dialogResult.canceled || dialogResult.filePaths.length === 0) return

      const selectedDir = dialogResult.filePaths[0]
      const newPath = selectedDir + '\\labflow.db'

      const result = await window.electronAPI!.config.setDbPath(newPath)

      if (result.success) {
        if (result.needsRestart) {
          const confirmed = confirm('数据库路径已更改，需要重启应用才能生效。\n\n是否立即重启？')
          if (confirmed) {
            await window.electronAPI!.config.restartApp()
          } else {
            await get().loadStorageConfig()
          }
        } else {
          await get().loadStorageConfig()
        }
      } else {
        alert('设置失败：' + (result.error || '未知错误'))
      }
    } catch (e) {
      console.error('Failed to change db path:', e)
      alert('操作失败')
    }
  },

  changeBackupDir: async () => {
    if (!isElectron()) return
    try {
      const dialogResult = await window.electronAPI!.config.showFolderDialog({
        title: '选择备份目录',
        defaultPath: get().storageConfig?.backupDir
      })

      if (dialogResult.canceled || dialogResult.filePaths.length === 0) return

      const newDir = dialogResult.filePaths[0]
      const result = await window.electronAPI!.config.setBackupDir(newDir)

      if (result.success) {
        await get().loadStorageConfig()
        if (result.changed) {
          alert('备份目录已更新！\n\n注意：旧目录中的快照不会自动迁移。')
        }
      } else {
        alert('设置失败：' + (result.error || '未知错误'))
      }
    } catch (e) {
      console.error('Failed to change backup dir:', e)
      alert('操作失败')
    }
  },

  resetPaths: async () => {
    if (!isElectron()) return
    const confirmed = confirm('确定要重置为默认路径吗？\n\n数据库路径将恢复为默认位置，需要重启应用。')
    if (!confirmed) return

    try {
      const result = await window.electronAPI!.config.resetPaths()
      if (result.success) {
        if (result.needsRestart) {
          const restartNow = confirm('路径已重置，是否立即重启？')
          if (restartNow) {
            await window.electronAPI!.config.restartApp()
          } else {
            await get().loadStorageConfig()
          }
        }
      }
    } catch (e) {
      console.error('Failed to reset paths:', e)
    }
  }
}))
