declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.css' {
  const content: string
  export default content
}

// 快照信息
interface SnapshotInfo {
  id: string
  timestamp: string
  filename: string
  localStorage: Record<string, string | null>
  stats: { tubes: number; experiments: number; histories: number; groups: number }
}

// 备份 API
interface BackupAPI {
  getDbPath: () => Promise<string>
  getBackupDir: () => Promise<string>
  export: (localStorageData: Record<string, string | null>) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>
  import: () => Promise<{ success: boolean; canceled?: boolean; legacy?: boolean; localStorage?: Record<string, string | null>; version?: string; error?: string }>
  createSnapshot: (localStorageData: Record<string, string | null>) => Promise<{ success: boolean; snapshot?: SnapshotInfo; error?: string }>
  listSnapshots: () => Promise<SnapshotInfo[]>
  restoreSnapshot: (snapshotId: string) => Promise<{ success: boolean; localStorage?: Record<string, string | null>; error?: string }>
  deleteSnapshot: (snapshotId: string) => Promise<{ success: boolean; error?: string }>
  openFolder: () => Promise<void>
  startAutoBackup: (intervalMinutes: number, localStorageData: Record<string, string | null>) => Promise<{ success: boolean }>
  stopAutoBackup: () => Promise<{ success: boolean }>
}

// 存储配置
interface StorageConfig {
  dbPath: string
  backupDir: string
  isCustomDbPath: boolean
  isCustomBackupDir: boolean
}

// 存储配置 API
interface ConfigAPI {
  getStorage: () => Promise<StorageConfig>
  showFolderDialog: (options: { title: string; defaultPath?: string }) => Promise<{ canceled: boolean; filePaths: string[] }>
  setDbPath: (newPath: string) => Promise<{ success: boolean; changed?: boolean; needsRestart?: boolean; error?: string }>
  setBackupDir: (newDir: string) => Promise<{ success: boolean; changed?: boolean; error?: string }>
  resetPaths: () => Promise<{ success: boolean; needsRestart?: boolean; error?: string }>
  restartApp: () => Promise<void>
}

interface ElectronAPI {
  getAppPath: () => Promise<string>
  getTubes: () => Promise<any[]>
  getTube: (id: string) => Promise<any>
  addTube: (tube: any) => Promise<any>
  updateTube: (tube: any) => Promise<any>
  deleteTube: (id: string) => Promise<{ success: boolean }>
  getExperiments: () => Promise<any[]>
  getExperiment: (id: string) => Promise<any>
  saveExperiment: (exp: any) => Promise<any>
  deleteExperiment: (id: string) => Promise<{ success: boolean }>
  getTubeUsage: (tubeId: string) => Promise<any[]>
  addTubeUsage: (record: any) => Promise<any>

  // 试管历史记录
  getTubeHistories: () => Promise<any[]>
  saveTubeHistory: (history: any) => Promise<{ success: boolean; error?: string }>
  deleteTubeHistory: (tubeId: string) => Promise<{ success: boolean; error?: string }>
  saveTubeHistories: (histories: any[]) => Promise<{ success: boolean; error?: string }>

  // 试管分组
  getGroups: () => Promise<any[]>
  saveGroup: (group: any) => Promise<{ success: boolean; error?: string }>
  deleteGroup: (id: string) => Promise<{ success: boolean; error?: string }>
  saveGroups: (groups: any[]) => Promise<{ success: boolean; error?: string }>

  // 物质颜色配置
  getSubstanceColors: () => Promise<any[]>
  saveSubstanceColor: (color: any) => Promise<{ success: boolean; error?: string }>
  deleteSubstanceColor: (name: string) => Promise<{ success: boolean; error?: string }>
  saveSubstanceColors: (colors: any[]) => Promise<{ success: boolean; error?: string }>

  clearAllData: () => Promise<{ success: boolean; error?: string }>
  backup: BackupAPI
  config: ConfigAPI
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
