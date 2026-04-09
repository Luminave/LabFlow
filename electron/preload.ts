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
})

// TypeScript 类型声明
export interface ElectronAPI {
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
