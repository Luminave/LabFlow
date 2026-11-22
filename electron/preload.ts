import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用路径
  getAppPath: () => ipcRenderer.invoke('get-app-path'),

  // 试管操作
  getTubes: () => ipcRenderer.invoke('db:getTubes'),
  getTube: (id: string) => ipcRenderer.invoke('db:getTube', id),
  addTube: (tube: any) => ipcRenderer.invoke('db:addTube', tube),
  updateTube: (tube: any) => ipcRenderer.invoke('db:updateTube', tube),
  deleteTube: (id: string) => ipcRenderer.invoke('db:deleteTube', id),

  // 实验操作
  getExperiments: () => ipcRenderer.invoke('db:getExperiments'),
  getExperiment: (id: string) => ipcRenderer.invoke('db:getExperiment', id),
  saveExperiment: (exp: any) => ipcRenderer.invoke('db:saveExperiment', exp),
  deleteExperiment: (id: string) => ipcRenderer.invoke('db:deleteExperiment', id),

  // 试管使用记录
  getTubeUsage: (tubeId: string) => ipcRenderer.invoke('db:getTubeUsage', tubeId),
  addTubeUsage: (record: any) => ipcRenderer.invoke('db:addTubeUsage', record),

  // 试管历史记录
  getTubeHistories: () => ipcRenderer.invoke('db:getTubeHistories'),
  saveTubeHistory: (history: any) => ipcRenderer.invoke('db:saveTubeHistory', history),
  deleteTubeHistory: (tubeId: string) => ipcRenderer.invoke('db:deleteTubeHistory', tubeId),
  saveTubeHistories: (histories: any[]) => ipcRenderer.invoke('db:saveTubeHistories', histories),

  // 试管分组
  getGroups: () => ipcRenderer.invoke('db:getGroups'),
  saveGroup: (group: any) => ipcRenderer.invoke('db:saveGroup', group),
  deleteGroup: (id: string) => ipcRenderer.invoke('db:deleteGroup', id),
  saveGroups: (groups: any[]) => ipcRenderer.invoke('db:saveGroups', groups),

  // 物质颜色配置
  getSubstanceColors: () => ipcRenderer.invoke('db:getSubstanceColors'),
  saveSubstanceColor: (color: any) => ipcRenderer.invoke('db:saveSubstanceColor', color),
  deleteSubstanceColor: (name: string) => ipcRenderer.invoke('db:deleteSubstanceColor', name),
  saveSubstanceColors: (colors: any[]) => ipcRenderer.invoke('db:saveSubstanceColors', colors),

  // 清除所有数据库数据
  clearAllData: () => ipcRenderer.invoke('db:clearAllData'),

  // 备份操作
  backup: {
    getDbPath: () => ipcRenderer.invoke('backup:get-db-path'),
    getBackupDir: () => ipcRenderer.invoke('backup:get-backup-dir'),
    export: (localStorageData: Record<string, string | null>) =>
      ipcRenderer.invoke('backup:export', localStorageData),
    import: () => ipcRenderer.invoke('backup:import'),
    createSnapshot: (localStorageData: Record<string, string | null>) =>
      ipcRenderer.invoke('backup:create-snapshot', localStorageData),
    listSnapshots: () => ipcRenderer.invoke('backup:list-snapshots'),
    restoreSnapshot: (snapshotId: string) =>
      ipcRenderer.invoke('backup:restore-snapshot', snapshotId),
    deleteSnapshot: (snapshotId: string) =>
      ipcRenderer.invoke('backup:delete-snapshot', snapshotId),
    openFolder: () => ipcRenderer.invoke('backup:open-folder'),
    startAutoBackup: (intervalMinutes: number, localStorageData: Record<string, string | null>) =>
      ipcRenderer.invoke('backup:start-auto-backup', intervalMinutes, localStorageData),
    stopAutoBackup: () => ipcRenderer.invoke('backup:stop-auto-backup'),
  },

  // 存储路径配置
  config: {
    getStorage: () => ipcRenderer.invoke('config:get-storage'),
    showFolderDialog: (options: { title: string; defaultPath?: string }) =>
      ipcRenderer.invoke('config:show-folder-dialog', options),
    setDbPath: (newPath: string) => ipcRenderer.invoke('config:set-db-path', newPath),
    setBackupDir: (newDir: string) => ipcRenderer.invoke('config:set-backup-dir', newDir),
    resetPaths: () => ipcRenderer.invoke('config:reset-paths'),
    restartApp: () => ipcRenderer.invoke('config:restart-app'),
    getExportSettings: () => ipcRenderer.invoke('config:get-export-settings'),
    setExportSettings: (settings: { directory: string; fileNameTemplate: string; autoSubfolder: boolean; scaleX: number; scaleY: number }) =>
      ipcRenderer.invoke('config:set-export-settings', settings),
  },

  // 工程导出（.yml / .canvas / SOP 一次写出）
  getAgentLock: () => ipcRenderer.invoke('lock:get'),
  /** 强制解锁：把界面看到的那把锁的三元组一起传上去，主进程校验一致才删（第 2 条） */
  forceReleaseAgentLock: (payload?: { pid?: number | null; agent?: string; project?: string; force?: boolean }) =>
    ipcRenderer.invoke('lock:forceRelease', payload),
  onStoreFilesChanged: (callback: (payload: { warehouse: boolean; projects: string[] }) => void) => {
    const listener = (_event: unknown, payload: { warehouse: boolean; projects: string[] }) => callback(payload)
    ipcRenderer.on('store:filesChanged', listener)
    return () => ipcRenderer.removeListener('store:filesChanged', listener)
  },
  onAgentLockChanged: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('lock:changed', listener)
    return () => ipcRenderer.removeListener('lock:changed', listener)
  },
  exportProject: (payload: {
    directory?: string
    subfolder?: string
    files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]
  }) => ipcRenderer.invoke('export:project', payload),

  // 看板截图：传画布区域（CSS 像素），返回 PNG 的 base64（不含前缀），失败返回 null
  captureBoard: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('export:capture-board', rect),

  // 数据正本目录（工程/ 仓库/ 导出 都在它下面）
  dataRoot: {
    getInfo: () => ipcRenderer.invoke('data:get-info'),
    setRoot: (root: string) => ipcRenderer.invoke('data:set-root', root),
    listProjects: () => ipcRenderer.invoke('data:list-projects'),
    readProject: (fileNameOrName: string) => ipcRenderer.invoke('data:read-project', fileNameOrName),
    statProject: (fileNameOrName: string) => ipcRenderer.invoke('data:stat-project', fileNameOrName),
    findProject: (id: string) => ipcRenderer.invoke('data:find-project', id),
    backupWarehouse: (payload: { content: string }) => ipcRenderer.invoke('data:backup-warehouse', payload),
    writeProject: (payload: {
      id?: string
      name: string
      content: string
      expect?: { mtimeMs: number; size: number; hash?: string } | null
    }) =>
      ipcRenderer.invoke('data:write-project', payload),
    readWarehouse: () => ipcRenderer.invoke('data:read-warehouse'),
    writeWarehouse: (payload: { content: string; expect?: { mtimeMs: number; size: number; hash?: string } | null }) =>
      ipcRenderer.invoke('data:write-warehouse', payload),
    writeDerived: (files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]) =>
      ipcRenderer.invoke('data:write-derived', files),
    askConflict: (payload: { projectName: string; fileName?: string }) =>
      ipcRenderer.invoke('data:ask-conflict', payload),
    /** 删工程：把 工程/<文件名>.yml 移进 工程/_deleted/（第 4 条），先移成功再删数据库 */
    deleteProject: (payload: { id?: string; name?: string; fileName?: string }) =>
      ipcRenderer.invoke('data:delete-project', payload),
  },

  // 深链接：笔记里点 labflow:// 链接时主进程会推过来，返回取消订阅函数
  onOpenProject: (callback: (url: string) => void) => {
    const handler = (_event: unknown, url: string) => callback(url)
    ipcRenderer.on('deeplink:open', handler)
    return () => {
      ipcRenderer.removeListener('deeplink:open', handler)
    }
  },

  /**
   * 深链接：主动取一次「待处理」的链接（取走即清空，没有则 null）。
   * 冷启动时主进程的 push 可能比渲染层订阅更早，只有这一条能兜住。
   */
  takePendingProjectLink: (): Promise<string | null> => ipcRenderer.invoke('deeplink:take-pending'),
})
