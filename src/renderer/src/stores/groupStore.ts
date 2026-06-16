/**
 * 试管分组状态管理
 * 使用 SQLite 存储
 */

import { create } from 'zustand'
import { TubeGroup } from '@shared/types'

interface GroupState {
  groups: TubeGroup[]
  loading: boolean

  loadGroups: () => Promise<void>
  addGroup: (name: string, color?: string, notes?: string) => Promise<TubeGroup>
  updateGroup: (id: string, updates: Partial<TubeGroup>) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  getGroup: (id: string) => TubeGroup | undefined
  generateGroupName: () => string
}

// 醒目的分组预设颜色
export const GROUP_PRESET_COLORS = [
  '#6366f1', // 靛蓝
  '#ec4899', // 粉红
  '#14b8a6', // 青绿
  '#f59e0b', // 琥珀
  '#8b5cf6', // 紫色
  '#ef4444', // 红色
  '#06b6d4', // 青色
  '#84cc16', // 黄绿
  '#f97316', // 橙色
  '#a855f7', // 紫罗兰
  '#10b981', // 翠绿
  '#e11d48', // 玫红
]

// 随机获取一个分组颜色
function getRandomGroupColor(): string {
  return GROUP_PRESET_COLORS[Math.floor(Math.random() * GROUP_PRESET_COLORS.length)]
}

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  loading: false,

  loadGroups: async () => {
    try {
      if (window.electronAPI) {
        // 从 SQLite 加载
        const groups = await window.electronAPI.getGroups()
        // 验证数据格式
        const validGroups = Array.isArray(groups) ? groups.filter(g => g && g.id && g.name) : []
        set({ groups: validGroups })
      } else {
        // 降级到 localStorage
        const data = localStorage.getItem('labflow_groups')
        let groups: TubeGroup[] = []
        try {
          groups = data ? JSON.parse(data) : []
          if (!Array.isArray(groups)) groups = []
        } catch {
          console.warn('[loadGroups] Failed to parse localStorage data')
          groups = []
        }
        set({ groups })
      }
    } catch (e) {
      console.error('Failed to load groups:', e)
      set({ groups: [] })
    }
  },

  addGroup: async (name, color, notes = '') => {
    const finalColor = color || getRandomGroupColor()
    const newGroup: TubeGroup = {
      id: crypto.randomUUID(),
      name,
      color: finalColor,
      notes,
      createdAt: new Date().toISOString()
    }

    try {
      if (window.electronAPI) {
        await window.electronAPI.saveGroup(newGroup)
      } else {
        const groups = [...get().groups, newGroup]
        localStorage.setItem('labflow_groups', JSON.stringify(groups))
      }
    } catch (e) {
      console.error('Failed to save group:', e)
    }

    set({ groups: [...get().groups, newGroup] })
    return newGroup
  },

  updateGroup: async (id, updates) => {
    const newGroups = get().groups.map(g =>
      g.id === id ? { ...g, ...updates } : g
    )

    try {
      const updatedGroup = newGroups.find(g => g.id === id)
      if (updatedGroup) {
        if (window.electronAPI) {
          await window.electronAPI.saveGroup(updatedGroup)
        } else {
          localStorage.setItem('labflow_groups', JSON.stringify(newGroups))
        }
      }
    } catch (e) {
      console.error('Failed to update group:', e)
    }

    set({ groups: newGroups })
  },

  deleteGroup: async (id) => {
    const newGroups = get().groups.filter(g => g.id !== id)

    try {
      if (window.electronAPI) {
        await window.electronAPI.deleteGroup(id)
      } else {
        localStorage.setItem('labflow_groups', JSON.stringify(newGroups))
      }
    } catch (e) {
      console.error('Failed to delete group:', e)
    }

    set({ groups: newGroups })
  },

  getGroup: (id) => {
    return get().groups.find(g => g.id === id)
  },

  generateGroupName: () => {
    const now = new Date()
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '') // yymmdd

    // 检查是否已有同名分组
    const groups = get().groups
    let groupName = dateStr
    let counter = 1

    while (groups.some(g => g.name === groupName)) {
      counter++
      groupName = `${dateStr}-${counter}`
    }

    return groupName
  }
}))
