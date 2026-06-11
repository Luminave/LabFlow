/**
 * 成分颜色配置管理
 */

import { create } from 'zustand'
import { SubstanceColor } from '@shared/types'

const STORAGE_KEY = 'labflow_substance_colors'

interface SubstanceColorState {
  colors: Map<string, SubstanceColor>
  
  // 获取成分颜色
  getColor: (name: string) => SubstanceColor | undefined
  
  // 设置成分颜色
  setColor: (name: string, color: string, bgColor: string) => void
  
  // 删除成分颜色
  removeColor: (name: string) => void
  
  // 获取所有颜色配置
  getAllColors: () => SubstanceColor[]
  
  // 加载颜色配置
  loadColors: () => void
}

// 默认颜色（用于没有配置的成分）
const defaultColors = [
  { name: 'E1', color: '#1e293b', bgColor: '#fef08a' },
  { name: 'E2', color: '#1e293b', bgColor: '#a5f3fc' },
  { name: 'E3', color: '#1e293b', bgColor: '#c4b5fd' },
  { name: 'E4', color: '#1e293b', bgColor: '#fca5a5' },
  { name: 'DNA', color: '#1e293b', bgColor: '#86efac' },
  { name: 'RNA', color: '#1e293b', bgColor: '#fdba74' },
]

function loadColorsFromStorage(): Map<string, SubstanceColor> {
  const colors = new Map<string, SubstanceColor>()
  
  // 先加载默认颜色
  defaultColors.forEach(c => colors.set(c.name, c))
  
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      const arr = JSON.parse(data) as SubstanceColor[]
      arr.forEach(c => colors.set(c.name, c))
    }
  } catch (e) {
    console.error('Failed to load substance colors:', e)
  }
  
  return colors
}

function saveColorsToStorage(colors: Map<string, SubstanceColor>) {
  try {
    // 只保存用户自定义的颜色（排除默认颜色）
    const customColors = Array.from(colors.values()).filter(
      c => !defaultColors.some(d => d.name === c.name && d.bgColor === c.bgColor)
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customColors))
  } catch (e) {
    console.error('Failed to save substance colors:', e)
  }
}

export const useSubstanceColorStore = create<SubstanceColorState>((set, get) => ({
  colors: new Map(),
  
  getColor: (name) => {
    return get().colors.get(name)
  },
  
  setColor: (name, color, bgColor) => {
    set(state => {
      const newColors = new Map(state.colors)
      newColors.set(name, { name, color, bgColor })
      saveColorsToStorage(newColors)
      return { colors: newColors }
    })
  },
  
  removeColor: (name) => {
    set(state => {
      const newColors = new Map(state.colors)
      newColors.delete(name)
      saveColorsToStorage(newColors)
      return { colors: newColors }
    })
  },
  
  getAllColors: () => {
    return Array.from(get().colors.values())
  },
  
  loadColors: () => {
    const colors = loadColorsFromStorage()
    set({ colors })
  }
}))

// 导出获取颜色的辅助函数
export function getSubstanceColor(name: string): { color: string; bgColor: string } {
  const store = useSubstanceColorStore.getState()
  const found = store.colors.get(name)
  if (found) {
    return { color: found.color, bgColor: found.bgColor }
  }
  // 返回默认样式
  return { color: '#64748b', bgColor: '#f1f5f9' }
}
