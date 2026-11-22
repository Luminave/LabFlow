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

// 导出设置（讲述者页的「导出」用）
interface ExportSettingsConfig {
  directory: string
  fileNameTemplate: string
  autoSubfolder: boolean
  /** 画布横向 / 纵向比例倍率（0.5–4.0，步长 0.1，默认 1.6） */
  scaleX: number
  scaleY: number
  /** 保存后自动重新导出（默认开） */
  autoExportOnSave: boolean
  /** 导出是否写 .canvas（默认开） */
  exportCanvasFile: boolean
  /** 导出是否额外画 <工程名>.png（默认开） */
  exportImage: boolean
  /** 导出目录里是否再放一份工程 .yml（只当备份，默认关） */
  exportDataFile: boolean
}

// 数据正本目录（工程/ 仓库/ 导出）
interface DataFileStat {
  mtimeMs: number
  size: number
}

interface DataRootInfo {
  root: string
  projectDir: string
  exportDir: string
  warehousePath: string
  ok: boolean
  projects: { name: string; fileName: string; stat: DataFileStat }[]
}

interface DataRootAPI {
  getInfo: () => Promise<DataRootInfo>
  setRoot: (root: string) => Promise<{ success: boolean; root?: string; error?: string }>
  listProjects: () => Promise<{ name: string; fileName: string; path: string; stat: DataFileStat }[]>
  readProject: (
    fileNameOrName: string
  ) => Promise<{ ok: true; path: string; content: string; stat: DataFileStat | null } | { ok: false; reason: 'not-found' }>
  statProject: (fileNameOrName: string) => Promise<DataFileStat | null>
  writeProject: (payload: {
    id?: string
    name: string
    content: string
    expect?: DataFileStat | null
  }) => Promise<
    | { ok: true; path: string; fileName: string; stat: DataFileStat }
    | { ok: false; conflict: true; path: string; stat: DataFileStat | null }
    | { ok: false; error: string }
  >
  readWarehouse: () => Promise<
    { ok: true; path: string; content: string; stat: DataFileStat | null } | { ok: false; reason: 'not-found' }
  >
  writeWarehouse: (payload: {
    content: string
    expect?: DataFileStat | null
  }) => Promise<
    { ok: true; path: string; stat: DataFileStat } | { ok: false; conflict?: true; stat?: DataFileStat | null; error?: string }
  >
  writeDerived: (
    files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]
  ) => Promise<{ ok: boolean; directory?: string; written?: { name: string; size: number }[]; error?: string }>
  askConflict: (payload: { projectName: string; fileName?: string }) => Promise<'reload' | 'overwrite' | 'cancel'>
}

// 存储配置 API
interface ConfigAPI {
  getStorage: () => Promise<StorageConfig>
  showFolderDialog: (options: { title: string; defaultPath?: string }) => Promise<{ canceled: boolean; filePaths: string[] }>
  setDbPath: (newPath: string) => Promise<{ success: boolean; changed?: boolean; needsRestart?: boolean; error?: string }>
  setBackupDir: (newDir: string) => Promise<{ success: boolean; changed?: boolean; error?: string }>
  resetPaths: () => Promise<{ success: boolean; needsRestart?: boolean; error?: string }>
  restartApp: () => Promise<void>
  getExportSettings: () => Promise<ExportSettingsConfig>
  setExportSettings: (
    settings: ExportSettingsConfig
  ) => Promise<{ success: boolean; settings?: ExportSettingsConfig; error?: string }>
}

// 工程导出结果
interface ExportProjectResult {
  success: boolean
  canceled?: boolean
  directory?: string
  files?: string[]
  error?: string
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
  exportProject: (payload: {
    directory?: string
    subfolder?: string
    files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]
  }) => Promise<ExportProjectResult>
  /** 看板截图：返回 PNG 的 base64（不含 data: 前缀），失败返回 null */
  captureBoard?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
  /** 深链接（labflow://）：笔记里点链接时主进程推过来；返回取消订阅函数 */
  onOpenProject?: (callback: (url: string) => void) => () => void
  /** Agent 锁（第 2 步）：读当前锁、强制解锁、订阅变化 */
  getAgentLock?: () => Promise<ParsedAgentLockPayload>
  forceReleaseAgentLock?: () => Promise<{ ok: boolean; error?: string }>
  onStoreFilesChanged?: (cb: (payload: { warehouse: boolean; projects: string[] }) => void) => () => void
  onAgentLockChanged?: (callback: (payload: ParsedAgentLockPayload) => void) => () => void
  /** 数据正本目录（工程/ 仓库/ 导出） */
  dataRoot?: DataRootAPI
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}

/** 锁文件解析结果（与 src/core/lock.ts 的 ParsedAgentLock 同形） */
export type ParsedAgentLockPayload =
  | { pid: number | null; agent: string; project: string; note: string; startedAt: string }
  | { broken: true; raw: string; reason: string }
  | null
