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
  
  addGroup: (name, color = '#e0e7ff', notes = '') => {
    const newGroup: TubeGroup = {
      id: crypto.randomUUID(),
      name,
      color,
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
