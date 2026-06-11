/**
 * 试管分组状态管理
 * 使用 localStorage 存储
 */

import { create } from 'zustand'
import { TubeGroup } from '@shared/types'

interface GroupState {
  groups: TubeGroup[]
  loading: boolean
  
  loadGroups: () => void
  addGroup: (name: string, color?: string, notes?: string) => TubeGroup
  updateGroup: (id: string, updates: Partial<TubeGroup>) => void
  deleteGroup: (id: string) => void
  getGroup: (id: string) => TubeGroup | undefined
  generateGroupName: () => string
}

const GROUPS_KEY = 'labflow_groups'

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
  
  loadGroups: () => {
    try {
      const data = localStorage.getItem(GROUPS_KEY)
      const groups = data ? JSON.parse(data) : []
      set({ groups })
    } catch (e) {
      console.error('Failed to load groups:', e)
    }
  },
  
  addGroup: (name, color, notes = '') => {
    const finalColor = color || getRandomGroupColor()
    const newGroup: TubeGroup = {
      id: crypto.randomUUID(),
      name,
      color: finalColor,
      notes,
      createdAt: new Date().toISOString()
    }
    
    const newGroups = [...get().groups, newGroup]
    localStorage.setItem(GROUPS_KEY, JSON.stringify(newGroups))
    set({ groups: newGroups })
    
    return newGroup
  },
  
  updateGroup: (id, updates) => {
    const newGroups = get().groups.map(g => 
      g.id === id ? { ...g, ...updates } : g
    )
    localStorage.setItem(GROUPS_KEY, JSON.stringify(newGroups))
    set({ groups: newGroups })
  },
  
  deleteGroup: (id) => {
    const newGroups = get().groups.filter(g => g.id !== id)
    localStorage.setItem(GROUPS_KEY, JSON.stringify(newGroups))
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
