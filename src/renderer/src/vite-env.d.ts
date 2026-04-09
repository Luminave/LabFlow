declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.css' {
  const content: string
  export default content
}

interface ElectronAPI {
  addTube: (tube: any) => Promise<void>
  updateTube: (tube: any) => Promise<void>
  deleteTube: (id: string) => Promise<void>
  getTubes: () => Promise<any[]>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
