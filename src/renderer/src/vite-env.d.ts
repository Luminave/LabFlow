declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.css' {
  const content: string
  export default content
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
