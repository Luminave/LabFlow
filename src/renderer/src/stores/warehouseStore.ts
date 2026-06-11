/**
 * 试剂仓库状态管理
 * 使用 SQLite 数据库持久化
 */

import { create } from 'zustand'
import { Tube, TubeStatus } from '@shared/types'

interface WarehouseState {
  tubes: Tube[]
  loading: boolean
  error: string | null
  
  fetchTubes: () => Promise<void>
  addTube: (tube: Omit<Tube, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Tube>
  updateTube: (id: string, updates: Partial<Tube>) => Promise<void>
  deleteTube: (id: string) => Promise<void>
  updateTubeStatus: (id: string, status: TubeStatus) => Promise<void>
  setTubes: (tubes: Tube[]) => void
}

// 将数据库记录转换为 Tube 对象
function dbToTube(record: any): Tube {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    totalVolume: record.total_volume,
    totalVolumeUnit: record.total_volume_unit,
    remainingVolume: record.remaining_volume,
    remainingVolumeUnit: record.remaining_volume_unit,
    substances: JSON.parse(record.substances || '[]'),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    status: record.status as TubeStatus,
    storageLocation: record.storage_location || undefined,
    storageCondition: record.storage_condition || undefined,
    notes: record.notes || undefined,
    tags: record.tags ? JSON.parse(record.tags) : undefined,
    groupId: record.group_id || undefined
  }
}

// 将 Tube 对象转换为数据库记录
function tubeToDb(tube: Tube): any {
  return {
    id: tube.id,
    name: tube.name,
    type: tube.type,
    totalVolume: tube.totalVolume,
    totalVolumeUnit: tube.totalVolumeUnit,
    remainingVolume: tube.remainingVolume,
    remainingVolumeUnit: tube.remainingVolumeUnit,
    substances: JSON.stringify(tube.substances),
    createdAt: tube.createdAt,
    updatedAt: tube.updatedAt,
    status: tube.status,
    storageLocation: tube.storageLocation || null,
    storageCondition: tube.storageCondition || null,
    notes: tube.notes || null,
    tags: JSON.stringify(tube.tags || []),
    groupId: tube.groupId || null
  }
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  tubes: [],
  loading: false,
  error: null,
  
  fetchTubes: async () => {
    set({ loading: true, error: null })
    try {
      if (window.electronAPI) {
        const records = await window.electronAPI.getTubes()
        const tubes = records.map(dbToTube)
        set({ tubes, loading: false })
      } else {
        // 降级到 localStorage（开发模式）
        const data = localStorage.getItem('labflow_tubes')
        const tubes = data ? JSON.parse(data) : []
        set({ tubes, loading: false })
      }
    } catch (error) {
      console.error('Failed to fetch tubes:', error)
      set({ error: (error as Error).message, loading: false })
    }
  },
  
  addTube: async (tubeData) => {
    const newTube: Tube = {
      ...tubeData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    try {
      if (window.electronAPI) {
        await window.electronAPI.addTube(tubeToDb(newTube))
      } else {
        const tubes = [...get().tubes, newTube]
        localStorage.setItem('labflow_tubes', JSON.stringify(tubes))
      }
      
      // 创建试管历史记录
      const historiesData = localStorage.getItem('labflow_tube_histories')
      let histories: TubeHistory[] = []
      try {
        histories = historiesData ? JSON.parse(historiesData) : []
      } catch {
        histories = []
      }
      
      // 检查是否已经有这个试管的历史记录
      const existingIndex = histories.findIndex(h => h.tubeId === newTube.id)
      
      if (existingIndex >= 0) {
        // 已存在，更新而不是创建新的
        histories[existingIndex] = {
          ...histories[existingIndex],
          tubeName: newTube.name,
          tubeType: newTube.type,
          currentVolume: newTube.remainingVolume,
          currentVolumeUnit: newTube.remainingVolumeUnit,
          currentSubstances: newTube.substances
        }
      } else {
        // 不存在，添加创建记录
        histories.push({
          tubeId: newTube.id,
          tubeName: newTube.name,
          tubeType: newTube.type,
          records: [{
            id: crypto.randomUUID(),
            tubeId: newTube.id,
            experimentId: 'warehouse',
            experimentName: '试剂仓库',
            action: 'created',
            timestamp: new Date().toISOString(),
            volumeBefore: 0,
            volumeAfter: newTube.remainingVolume,
            volumeUnit: newTube.remainingVolumeUnit,
            substancesBefore: [],
            substancesAfter: newTube.substances
          }],
          currentVolume: newTube.remainingVolume,
          currentVolumeUnit: newTube.remainingVolumeUnit,
          currentSubstances: newTube.substances
        })
      }
      
      localStorage.setItem('labflow_tube_histories', JSON.stringify(histories))
      
      set({ tubes: [...get().tubes, newTube] })
      return newTube
    } catch (error) {
      console.error('Failed to add tube:', error)
      throw error
    }
  },
  
  updateTube: async (id, updates) => {
    const newTubes = get().tubes.map(tube => 
      tube.id === id 
        ? { ...tube, ...updates, updatedAt: new Date().toISOString() }
        : tube
    )
    
    try {
      const updatedTube = newTubes.find(t => t.id === id)
      if (updatedTube) {
        if (window.electronAPI) {
          await window.electronAPI.updateTube(tubeToDb(updatedTube))
        } else {
          localStorage.setItem('labflow_tubes', JSON.stringify(newTubes))
        }
      }
      
      set({ tubes: newTubes })
    } catch (error) {
      console.error('Failed to update tube:', error)
      throw error
    }
  },
  
  deleteTube: async (id) => {
    const newTubes = get().tubes.filter(tube => tube.id !== id)
    
    try {
      if (window.electronAPI) {
        await window.electronAPI.deleteTube(id)
      } else {
        localStorage.setItem('labflow_tubes', JSON.stringify(newTubes))
      }
      
      set({ tubes: newTubes })
    } catch (error) {
      console.error('Failed to delete tube:', error)
      throw error
    }
  },
  
  updateTubeStatus: async (id, status) => {
    await get().updateTube(id, { status })
  },
  
  setTubes: (tubes) => {
    set({ tubes })
  }
}))
