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
})
