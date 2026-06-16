/**
 * 成分颜色配置管理
 * 使用 SQLite 存储
 */

import { create } from 'zustand'
import { SubstanceColor } from '@shared/types'

interface SubstanceColorState {
  colors: Map<string, SubstanceColor>

  // 获取成分颜色
  getColor: (name: string) => SubstanceColor | undefined

  // 设置成分颜色
  setColor: (name: string, color: string, bgColor: string) => Promise<void>

  // 删除成分颜色
  removeColor: (name: string) => Promise<void>

  // 重置默认颜色
  resetDefaultColors: () => Promise<void>

  // 获取所有颜色配置
  getAllColors: () => SubstanceColor[]

  // 加载颜色配置
  loadColors: () => Promise<void>
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

// 获取已删除的默认颜色列表
function getDeletedDefaultColors(): string[] {
  try {
    const data = localStorage.getItem('labflow_deleted_default_colors')
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

// 记录删除的默认颜色
function addDeletedDefaultColor(name: string) {
  const deleted = getDeletedDefaultColors()
  if (!deleted.includes(name)) {
    deleted.push(name)
    localStorage.setItem('labflow_deleted_default_colors', JSON.stringify(deleted))
  }
}

// 重置删除记录（用于重置默认颜色）
function resetDeletedDefaultColors() {
  localStorage.removeItem('labflow_deleted_default_colors')
}

async function loadColorsFromStorage(): Promise<Map<string, SubstanceColor>> {
  const colors = new Map<string, SubstanceColor>()
  const deletedDefaults = getDeletedDefaultColors()

  // 先加载默认颜色（排除已删除的）
  defaultColors
    .filter(c => !deletedDefaults.includes(c.name))
    .forEach(c => colors.set(c.name, c))

  try {
    if (window.electronAPI) {
      // 从 SQLite 加载
      const customColors = await window.electronAPI.getSubstanceColors()
      customColors.forEach((c: any) => colors.set(c.name, { name: c.name, color: c.color, bgColor: c.bg_color }))
    } else {
      // 降级到 localStorage
      const data = localStorage.getItem('labflow_substance_colors')
      if (data) {
        const arr = JSON.parse(data) as SubstanceColor[]
        arr.forEach(c => colors.set(c.name, c))
      }
    }
  } catch (e) {
    console.error('Failed to load substance colors:', e)
  }

  return colors
}

async function saveColorsToStorage(colors: Map<string, SubstanceColor>) {
  try {
    // 保存所有颜色（包括默认颜色的修改版本）
    // 这样用户修改默认颜色后也能正确保存
    const allColors = Array.from(colors.values())

    if (window.electronAPI) {
      // 保存到 SQLite
      await window.electronAPI.saveSubstanceColors(allColors.map(c => ({
        name: c.name,
        color: c.color,
        bgColor: c.bgColor
      })))
    } else {
      // 降级到 localStorage
      localStorage.setItem('labflow_substance_colors', JSON.stringify(allColors))
    }
  } catch (e) {
    console.error('Failed to save substance colors:', e)
  }
}

export const useSubstanceColorStore = create<SubstanceColorState>((set, get) => ({
  colors: new Map(),

  getColor: (name) => {
    return get().colors.get(name)
  },

  setColor: async (name, color, bgColor) => {
    set(state => {
      const newColors = new Map(state.colors)
      newColors.set(name, { name, color, bgColor })
      saveColorsToStorage(newColors)
      return { colors: newColors }
    })
  },

  removeColor: async (name) => {
    // 如果删除的是默认颜色，记录到 localStorage
    const isDefault = defaultColors.some(d => d.name === name)
    if (isDefault) {
      addDeletedDefaultColor(name)
    }

    set(state => {
      const newColors = new Map(state.colors)
      newColors.delete(name)
      saveColorsToStorage(newColors)
      return { colors: newColors }
    })
  },

  resetDefaultColors: async () => {
    // 清除删除记录
    resetDeletedDefaultColors()

    // 重新加载颜色
    const colors = await loadColorsFromStorage()
    set({ colors })

    // 保存到数据库
    await saveColorsToStorage(colors)
  },

  getAllColors: () => {
    return Array.from(get().colors.values())
  },

  loadColors: async () => {
    const colors = await loadColorsFromStorage()
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
