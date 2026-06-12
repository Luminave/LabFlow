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
  clearAllData: () => Promise<{ success: boolean; error?: string }>
  backup: BackupAPI
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
