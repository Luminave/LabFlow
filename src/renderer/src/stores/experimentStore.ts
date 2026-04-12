/**
 * 实验状态管理
 * 使用 SQLite 数据库持久化，localStorage 作为后备
 */

import { create } from 'zustand'
import { Experiment, Tube, TransferConnection, TubePosition, Substance, VolumeUnit } from '@shared/types'

const CURRENT_EXPERIMENT_KEY = 'labflow_current_experiment'
const TUBE_HISTORIES_KEY = 'labflow_tube_histories'
const EXPERIMENTS_KEY = 'labflow_experiments' // 实验记录的 localStorage key

// 计算试管结束状态的辅助函数
function calculateEndState(tubes: Tube[], connections: TransferConnection[]): Tube[] {
  // 计算每个试管的移入和移出体积
  const tubeInVolume = new Map<string, number>()
  const tubeOutVolume = new Map<string, number>()
  
  for (const conn of connections) {
    if (conn.volume <= 0) continue
    // 移入
    tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
    // 移出
    tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
  }
  
  // 计算每个试管移入的物质
  const tubeInSubstances = new Map<string, Map<string, { moles: number; unit: string }>>()
  
  for (const conn of connections) {
    if (conn.volume <= 0) continue
    const sourceTube = tubes.find(t => t.id === conn.fromTubeId)
    if (!sourceTube || sourceTube.type === 'buffer') continue
    
    let substanceMap = tubeInSubstances.get(conn.toTubeId)
    if (!substanceMap) {
      substanceMap = new Map()
      tubeInSubstances.set(conn.toTubeId, substanceMap)
    }
    
    for (const sub of sourceTube.substances) {
      const moles = sub.concentration * conn.volume
      const existing = substanceMap.get(sub.name)
      if (existing) {
        existing.moles += moles
      } else {
        substanceMap.set(sub.name, { moles, unit: sub.concentrationUnit })
      }
    }
  }
  
  return tubes.map(tube => {
    const inVolume = tubeInVolume.get(tube.id) || 0
    const outVolume = tubeOutVolume.get(tube.id) || 0
    
    // 计算结束体积
    let endVolume: number
    if (tube.type === 'source') {
      // 原料试管：初始体积 - 移出体积
      endVolume = Math.max(0, tube.remainingVolume - outVolume)
    } else if (tube.type === 'buffer') {
      // 缓冲液：保持无限或不变
      endVolume = tube.remainingVolume
    } else {
      // 中间产物：移入体积 - 移出体积
      endVolume = Math.max(0, inVolume - outVolume)
    }
    
    // 浓度保持不变（用户设定的值）
    // 中间试管不重新计算浓度，只更新体积
    const endSubstances = tube.substances
    
    return {
      ...tube,
      remainingVolume: endVolume,
      totalVolume: endVolume,
      substances: endSubstances
    }
  })
}

// 试管历史记录
interface TubeHistory {
  tubeId: string
  tubeName: string
  tubeType: string
  records: {
    id: string
    tubeId: string
    experimentId: string
    experimentName: string
    action: 'created' | 'transfer_in' | 'transfer_out'
    timestamp: string
    volumeBefore: number
    volumeAfter: number
    volumeUnit: VolumeUnit
    substancesBefore: Substance[]
    substancesAfter: Substance[]
    transferFrom?: string
    transferTo?: string
    transferVolume?: number
  }[]
  currentVolume: number
  currentVolumeUnit: VolumeUnit
  currentSubstances: Substance[]
}

interface ExperimentState {
  currentExperiment: Experiment | null
  currentTubes: Tube[]
  connections: TransferConnection[]
  tubePositions: TubePosition[]
  experiments: Experiment[]
  showEndState: boolean
  loading: boolean
  error: string | null
  
  createNewExperiment: (name: string, description?: string) => void
  saveCurrentExperiment: (name?: string) => void
  saveAsExperiment: (newName: string) => void
  loadExperiment: (id: string) => void
  deleteExperiment: (id: string) => void
  
  addSourceTube: (tube: Tube) => void
  addIntermediateTube: (tube: Tube) => void
  addBufferTube: (tube: Tube) => void
  addSampleTube: (tube: Tube) => void
  addWasteTube: (tube: Tube) => void
  removeTube: (tubeId: string) => void
  updateTubeInExperiment: (tubeId: string, updates: Partial<Tube>) => void
  
  addConnection: (connection: Omit<TransferConnection, 'id'>) => void
  updateConnection: (id: string, updates: Partial<TransferConnection>) => void
  removeConnection: (id: string) => void
  
  updateTubePosition: (tubeId: string, x: number, y: number) => void
  
  completeExperiment: () => Promise<void>
  revertExperiment: (experimentId: string) => Promise<boolean>
  
  toggleShowEndState: () => void
  fetchExperiments: () => Promise<void>
  resetExperiment: () => void
  loadSavedExperiment: () => void
  
  setDefaultBuffer: (bufferId: string | undefined) => void
  setExperimentAsWaste: (isWaste: boolean) => void
}

// 数据库记录转换
function dbToExperiment(record: any): Experiment {
  return {
    id: record.id,
    name: record.name,
    description: record.description || undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    completedAt: record.completed_at || undefined,
    status: record.status,
    tubes: JSON.parse(record.tubes || '[]'),
    tubePositions: JSON.parse(record.tube_positions || '[]'),
    connections: JSON.parse(record.connections || '[]'),
    warehouseSnapshot: record.warehouse_snapshot ? JSON.parse(record.warehouse_snapshot) : undefined,
    initialStateTubes: record.initial_state_tubes ? JSON.parse(record.initial_state_tubes) : undefined,
    endStateTubes: record.end_state_tubes ? JSON.parse(record.end_state_tubes) : undefined,
    isWaste: record.is_waste === 1 || record.is_waste === true
  }
}

function experimentToDb(exp: Experiment): any {
  return {
    id: exp.id,
    name: exp.name,
    description: exp.description || null,
    created_at: exp.createdAt,
    updated_at: exp.updatedAt,
    completed_at: exp.completedAt || null,
    status: exp.status,
    tubes: JSON.stringify(exp.tubes),
    tube_positions: JSON.stringify(exp.tubePositions || []),
    connections: JSON.stringify(exp.connections),
    warehouse_snapshot: exp.warehouseSnapshot ? JSON.stringify(exp.warehouseSnapshot) : null,
    initial_state_tubes: exp.initialStateTubes ? JSON.stringify(exp.initialStateTubes) : null,
    end_state_tubes: exp.endStateTubes ? JSON.stringify(exp.endStateTubes) : null,
    is_waste: exp.isWaste ? 1 : 0
  }
}

// 历史记录管理
function loadHistories(): Map<string, TubeHistory> {
  try {
    const data = localStorage.getItem(TUBE_HISTORIES_KEY)
    if (data) {
      const arr = JSON.parse(data)
      return new Map(arr.map((h: TubeHistory) => [h.tubeId, h]))
    }
  } catch (e) {
    console.error('Failed to load histories:', e)
  }
  return new Map()
}

function saveHistories(histories: Map<string, TubeHistory>) {
  try {
    localStorage.setItem(TUBE_HISTORIES_KEY, JSON.stringify(Array.from(histories.values())))
  } catch (e) {
    console.error('Failed to save histories:', e)
  }
}

function initTubeHistory(
  histories: Map<string, TubeHistory>,
  tubeId: string,
  tubeName: string,
  tubeType: string,
  initialVolume: number,
  volumeUnit: VolumeUnit,
  substances: Substance[],
  experimentId: string,
  experimentName: string
): TubeHistory {
  return {
    tubeId,
    tubeName,
    tubeType,
    records: [{
      id: crypto.randomUUID(),
      tubeId,
      experimentId,
      experimentName,
      action: 'created',
      timestamp: new Date().toISOString(),
      volumeBefore: 0,
      volumeAfter: initialVolume,
      volumeUnit,
      substancesBefore: [],
      substancesAfter: substances
    }],
    currentVolume: initialVolume,
    currentVolumeUnit: volumeUnit,
    currentSubstances: substances
  }
}

function addRecordToHistory(
  history: TubeHistory,
  experimentId: string,
  experimentName: string,
  action: 'transfer_in' | 'transfer_out',
  volumeBefore: number,
  volumeAfter: number,
  volumeUnit: VolumeUnit,
  substancesBefore: Substance[],
  substancesAfter: Substance[],
  transferFrom?: string,
  transferTo?: string,
  transferVolume?: number
) {
  history.records.push({
    id: crypto.randomUUID(),
    tubeId: history.tubeId,
    experimentId,
    experimentName,
    action,
    timestamp: new Date().toISOString(),
    volumeBefore,
    volumeAfter,
    volumeUnit,
    substancesBefore,
    substancesAfter,
    transferFrom,
    transferTo,
    transferVolume
  })
  history.currentVolume = volumeAfter
  history.currentSubstances = substancesAfter
}

// 仓库操作
async function getWarehouseTubes(): Promise<Tube[]> {
  try {
    if (window.electronAPI) {
      const records = await window.electronAPI.getTubes()
      return records.map((r: any) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        totalVolume: r.total_volume,
        totalVolumeUnit: r.total_volume_unit,
        remainingVolume: r.remaining_volume,
        remainingVolumeUnit: r.remaining_volume_unit,
        substances: JSON.parse(r.substances || '[]'),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        status: r.status
      }))
    } else {
      // 降级到 localStorage
      const data = localStorage.getItem('labflow_tubes')
      return data ? JSON.parse(data) : []
    }
  } catch (e) {
    console.error('Failed to get warehouse tubes:', e)
    // 尝试从 localStorage 读取
    try {
      const data = localStorage.getItem('labflow_tubes')
      return data ? JSON.parse(data) : []
    } catch {
      return []
    }
  }
}

async function saveWarehouseTubes(tubes: Tube[]) {
  try {
    if (window.electronAPI) {
      for (const tube of tubes) {
        await window.electronAPI.updateTube({
          id: tube.id,
          name: tube.name,
          type: tube.type,
          totalVolume: tube.totalVolume,
          totalVolumeUnit: tube.totalVolumeUnit,
          remainingVolume: tube.remainingVolume,
          remainingVolumeUnit: tube.remainingVolumeUnit,
          substances: JSON.stringify(tube.substances),
          updatedAt: tube.updatedAt,
          status: tube.status
        })
      }
    } else {
      // localStorage 降级
      localStorage.setItem('labflow_tubes', JSON.stringify(tubes))
    }
  } catch (e) {
    console.error('Failed to save warehouse tubes:', e)
    // 尝试 localStorage 降级
    try {
      localStorage.setItem('labflow_tubes', JSON.stringify(tubes))
    } catch (e2) {
      console.error('Failed to save to localStorage:', e2)
    }
  }
}

// 当前实验缓存
function saveCurrentExperimentToStorage(state: {
  currentExperiment: Experiment | null
  currentTubes: Tube[]
  connections: TransferConnection[]
  tubePositions: TubePosition[]
}) {
  try {
    localStorage.setItem(CURRENT_EXPERIMENT_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('Failed to save experiment:', e)
  }
}

function loadCurrentExperimentFromStorage(): {
  currentExperiment: Experiment | null
  currentTubes: Tube[]
  connections: TransferConnection[]
  tubePositions: TubePosition[]
} | null {
  try {
    const data = localStorage.getItem(CURRENT_EXPERIMENT_KEY)
    if (data) return JSON.parse(data)
  } catch (e) {
    console.error('Failed to load experiment:', e)
  }
  return null
}

// 保存实验记录到 localStorage
function saveExperimentsToStorage(experiments: Experiment[]) {
  try {
    localStorage.setItem(EXPERIMENTS_KEY, JSON.stringify(experiments))
  } catch (e) {
    console.error('Failed to save experiments to localStorage:', e)
  }
}

// 从 localStorage 加载实验记录
function loadExperimentsFromStorage(): Experiment[] {
  try {
    const data = localStorage.getItem(EXPERIMENTS_KEY)
    if (data) return JSON.parse(data)
  } catch (e) {
    console.error('Failed to load experiments from localStorage:', e)
  }
  return []
}

export const useExperimentStore = create<ExperimentState>((set, get) => ({
  currentExperiment: null,
  currentTubes: [],
  connections: [],
  tubePositions: [],
  experiments: [],
  showEndState: false,
  loading: false,
  error: null,
  
  createNewExperiment: async (name, description) => {
    const warehouseSnapshot = await getWarehouseTubes()
    const newExperiment: Experiment = {
      id: crypto.randomUUID(),
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft',
      tubes: [],
      tubePositions: [],
      connections: [],
      warehouseSnapshot
    }
    
    const state = {
      currentExperiment: newExperiment,
      currentTubes: [],
      connections: [],
      tubePositions: []
    }
    
    saveCurrentExperimentToStorage(state)
    set(state)
  },
  
  saveCurrentExperiment: async (name) => {
    const state = get()
    if (!state.currentExperiment) return
    
    const experiment: Experiment = {
      ...state.currentExperiment,
      name: name || state.currentExperiment.name,
      tubes: state.currentTubes,
      tubePositions: state.tubePositions,
      connections: state.connections,
      updatedAt: new Date().toISOString()
    }
    
    try {
      if (window.electronAPI) {
        await window.electronAPI.saveExperiment(experimentToDb(experiment))
      }
      
      const experiments = get().experiments
      const existingIndex = experiments.findIndex(e => e.id === experiment.id)
      let newExperiments: Experiment[]
      
      if (existingIndex >= 0) {
        newExperiments = experiments.map(e => e.id === experiment.id ? experiment : e)
      } else {
        newExperiments = [...experiments, experiment]
      }
      
      // 同时保存到 localStorage 作为备份
      saveExperimentsToStorage(newExperiments)
      
      set({ experiments: newExperiments, currentExperiment: experiment })
      saveCurrentExperimentToStorage({ ...state, currentExperiment: experiment })
    } catch (e) {
      console.error('Failed to save experiment:', e)
    }
  },

  saveAsExperiment: async (newName) => {
    const state = get()
    if (!state.currentExperiment) return
    
    // 创建一个全新 ID 的实验副本
    const newExperiment: Experiment = {
      ...state.currentExperiment,
      id: crypto.randomUUID(),
      name: newName,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: undefined,
      tubes: state.currentTubes,
      tubePositions: state.tubePositions,
      connections: state.connections
    }
    
    try {
      if (window.electronAPI) {
        await window.electronAPI.saveExperiment(experimentToDb(newExperiment))
      }
      
      const experiments = get().experiments
      const newExperiments = [...experiments, newExperiment]
      
      saveExperimentsToStorage(newExperiments)
      
      set({ experiments: newExperiments, currentExperiment: newExperiment })
      saveCurrentExperimentToStorage({ ...state, currentExperiment: newExperiment })
    } catch (e) {
      console.error('Failed to save as experiment:', e)
    }
  },
  
  loadExperiment: (id) => {
    const experiment = get().experiments.find(e => e.id === id)
    if (!experiment) {
      alert('找不到该实验')
      return
    }
    
    const displayTubes = experiment.initialStateTubes || experiment.tubes
    
    set({
      currentExperiment: experiment,
      currentTubes: displayTubes,
      connections: experiment.connections,
      tubePositions: experiment.tubePositions || [],
      showEndState: false
    })
    
    saveCurrentExperimentToStorage({
      currentExperiment: experiment,
      currentTubes: displayTubes,
      connections: experiment.connections,
      tubePositions: experiment.tubePositions || []
    })
  },
  
  deleteExperiment: async (id) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.deleteExperiment(id)
      }
      
      const experiments = get().experiments.filter(e => e.id !== id)
      set({ experiments })
      
      if (get().currentExperiment?.id === id) {
        localStorage.removeItem(CURRENT_EXPERIMENT_KEY)
        set({ currentExperiment: null, currentTubes: [], connections: [], tubePositions: [] })
      }
    } catch (e) {
      console.error('Failed to delete experiment:', e)
    }
  },
  
  addSourceTube: (tube) => {
    set(state => {
      if (!state.currentExperiment || state.currentTubes.find(t => t.id === tube.id)) return state
      
      // 不再在添加时创建历史记录，等实验结算时再创建
      
      const newTubes = [...state.currentTubes, tube]
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
  },
  
  addIntermediateTube: (tube) => {
    set(state => {
      if (!state.currentExperiment) return state
      
      // 不再在添加时创建历史记录，等实验结算时再创建
      
      // 试管的 remainingVolume 设置为 0（表示当前实际体积）
      const tubeWithZeroVolume = { ...tube, remainingVolume: 0 }
      const newTubes = [...state.currentTubes, tubeWithZeroVolume]
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
  },
  
  addBufferTube: (tube) => {
    set(state => {
      if (!state.currentExperiment) return state
      
      // 缓冲液试管不再创建历史记录
      
      const newTubes = [...state.currentTubes, tube]
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
  },
  
  addSampleTube: (tube) => {
    set(state => {
      if (!state.currentExperiment) return state
      
      // 上样试管不创建历史记录，不保存到仓库
      const newTubes = [...state.currentTubes, tube]
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
  },
  
  addWasteTube: (tube) => {
    set(state => {
      if (!state.currentExperiment) return state
      
      const newTubes = [...state.currentTubes, tube]
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
  },
  
  removeTube: (tubeId) => {
    set(state => {
      if (!state.currentExperiment) return state
      
      const newTubes = state.currentTubes.filter(t => t.id !== tubeId)
      const newConnections = state.connections.filter(c => c.fromTubeId !== tubeId && c.toTubeId !== tubeId)
      const newPositions = state.tubePositions.filter(p => p.tubeId !== tubeId)
      
      const newState = {
        currentTubes: newTubes,
        connections: newConnections,
        tubePositions: newPositions,
        currentExperiment: { ...state.currentExperiment, tubes: newTubes, connections: newConnections, tubePositions: newPositions }
      }
      saveCurrentExperimentToStorage(newState)
      return newState
    })
  },
  
  updateTubeInExperiment: (tubeId, updates) => {
    set(state => {
      if (!state.currentExperiment) return state
      const newTubes = state.currentTubes.map(t => t.id === tubeId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
  },
  
  addConnection: (connectionData) => {
    const connection: TransferConnection = { ...connectionData, id: crypto.randomUUID() }
    set(state => {
      if (!state.currentExperiment) return state
      
      const newConnections = [...state.connections, connection]
      let newTubes = state.currentTubes
      
      // 如果目标试管是中间产物，自动继承源试管的成分
      const sourceTube = state.currentTubes.find(t => t.id === connection.fromTubeId)
      const targetTube = state.currentTubes.find(t => t.id === connection.toTubeId)
      
      if (sourceTube && targetTube && targetTube.type === 'intermediate' && sourceTube.type !== 'buffer') {
        // 合并源试管的成分到目标试管
        const existingSubstances = [...targetTube.substances]
        for (const sub of sourceTube.substances) {
          const existing = existingSubstances.find(s => s.name === sub.name)
          if (!existing) {
            // 添加新成分，浓度暂时为0
            existingSubstances.push({
              name: sub.name,
              concentration: 0,
              concentrationUnit: sub.concentrationUnit
            })
          }
        }
        
        newTubes = newTubes.map(t => 
          t.id === targetTube.id 
            ? { ...t, substances: existingSubstances }
            : t
        )
      }
      
      const newState = { 
        connections: newConnections, 
        currentTubes: newTubes,
        currentExperiment: { ...state.currentExperiment, connections: newConnections, tubes: newTubes } 
      }
      saveCurrentExperimentToStorage({ ...state, ...newState })
      return newState
    })
  },
  
  updateConnection: (id, updates) => {
    set(state => {
      if (!state.currentExperiment) return state
      const newConnections = state.connections.map(c => c.id === id ? { ...c, ...updates } : c)
      const newState = { connections: newConnections, currentExperiment: { ...state.currentExperiment, connections: newConnections } }
      saveCurrentExperimentToStorage({ ...state, ...newState })
      return newState
    })
  },
  
  removeConnection: (id) => {
    set(state => {
      if (!state.currentExperiment) return state
      const newConnections = state.connections.filter(c => c.id !== id)
      const newState = { connections: newConnections, currentExperiment: { ...state.currentExperiment, connections: newConnections } }
      saveCurrentExperimentToStorage({ ...state, ...newState })
      return newState
    })
  },
  
  updateTubePosition: (tubeId, x, y) => {
    set(state => {
      if (!state.currentExperiment) return state
      const newPositions = state.tubePositions.some(p => p.tubeId === tubeId)
        ? state.tubePositions.map(p => p.tubeId === tubeId ? { ...p, x, y } : p)
        : [...state.tubePositions, { tubeId, x, y }]
      const newState = { tubePositions: newPositions, currentExperiment: { ...state.currentExperiment, tubePositions: newPositions } }
      saveCurrentExperimentToStorage({ ...state, ...newState })
      return newState
    })
  },
  
  completeExperiment: async () => {
    const { currentExperiment, currentTubes, connections } = get()
    if (!currentExperiment) return
    
    const histories = loadHistories()
    const initialStateTubes = currentTubes.map(t => ({ ...t }))
    
    // 统计缓冲液消耗（按仓库 ID 分组）
    const bufferUsage = new Map<string, { totalVolume: number; tube: Tube }>()
    
    for (const tube of currentTubes) {
      if (tube.type === 'buffer' && tube.id.startsWith('buffer-')) {
        // 提取仓库缓冲液 ID：buffer-{仓库ID}-{目标ID}
        const parts = tube.id.split('-')
        if (parts.length >= 3) {
          const warehouseBufferId = parts.slice(1, -1).join('-')
          const existing = bufferUsage.get(warehouseBufferId)
          
          // 计算该缓冲液卡片的总输出体积
          const outConns = connections.filter(c => c.fromTubeId === tube.id)
          const totalOut = outConns.reduce((sum, c) => sum + c.volume, 0)
          
          if (existing) {
            existing.totalVolume += totalOut
          } else {
            bufferUsage.set(warehouseBufferId, { totalVolume: totalOut, tube })
          }
        }
      }
    }
    
    // 在结算时，为画布上存在的试管创建历史记录
    for (const tube of currentTubes) {
      // 跳过缓冲液试管实例（只记录仓库缓冲液）
      if (tube.type === 'buffer' && tube.id.startsWith('buffer-')) {
        continue
      }
      
      // 跳过上样试管（不记录历史）
      if (tube.type === 'sample') {
        continue
      }
      
      if (!histories.has(tube.id)) {
        // 创建初始记录
        const initialVolume = tube.type === 'intermediate' ? 0 : tube.remainingVolume
        histories.set(tube.id, initTubeHistory(
          histories, tube.id, tube.name, tube.type,
          initialVolume, tube.remainingVolumeUnit, tube.substances,
          currentExperiment.id, currentExperiment.name
        ))
      }
    }
    
    // 为仓库缓冲液创建/更新历史记录
    for (const [warehouseBufferId, usage] of bufferUsage) {
      if (!histories.has(warehouseBufferId)) {
        // 从仓库获取缓冲液信息
        const warehouseTubes = await getWarehouseTubes()
        const bufferTemplate = warehouseTubes.find(t => t.id === warehouseBufferId)
        if (bufferTemplate) {
          histories.set(warehouseBufferId, initTubeHistory(
            histories, warehouseBufferId, bufferTemplate.name, 'buffer',
            bufferTemplate.remainingVolume === Infinity ? 0 : bufferTemplate.remainingVolume, 
            bufferTemplate.remainingVolumeUnit, bufferTemplate.substances,
            currentExperiment.id, currentExperiment.name
          ))
        }
      }
      
      // 记录缓冲液消耗
      const bufferHistory = histories.get(warehouseBufferId)
      if (bufferHistory && usage.totalVolume > 0) {
        // 缓冲液体积不变（假设无限），但记录使用
        addRecordToHistory(bufferHistory, currentExperiment.id, currentExperiment.name, 'transfer_out',
          bufferHistory.currentVolume, bufferHistory.currentVolume,
          usage.tube.remainingVolumeUnit, bufferHistory.currentSubstances, bufferHistory.currentSubstances,
          undefined, 'multiple', usage.totalVolume)
      }
    }
    
    // 记录移液操作
    for (const conn of connections) {
      if (conn.volume <= 0) continue
      const sourceTube = currentTubes.find(t => t.id === conn.fromTubeId)
      const targetTube = currentTubes.find(t => t.id === conn.toTubeId)
      if (!sourceTube || !targetTube) continue
      
      // 记录源试管移出
      const sourceHistory = histories.get(conn.fromTubeId)
      if (sourceHistory) {
        addRecordToHistory(sourceHistory, currentExperiment.id, currentExperiment.name, 'transfer_out',
          sourceHistory.currentVolume, Math.max(0, sourceHistory.currentVolume - conn.volume),
          conn.volumeUnit, sourceHistory.currentSubstances, sourceHistory.currentSubstances,
          undefined, conn.toTubeId, conn.volume)
      }
      
      // 记录目标试管移入（包括缓冲液）
      const targetHistory = histories.get(conn.toTubeId)
      if (targetHistory) {
        // 对于中间产物试管，浓度使用用户设定的值，不重新计算
        let newSubstances = targetHistory.currentSubstances
        
        if (targetTube.type === 'intermediate') {
          // 中间产物：使用试管数据中的浓度（用户设定的值）
          newSubstances = targetTube.substances
        } else if (sourceTube.type !== 'buffer' && sourceTube.substances.length > 0) {
          // 非中间产物：按实际移入计算浓度
          newSubstances = [...targetHistory.currentSubstances]
          for (const sub of sourceTube.substances) {
            const existing = newSubstances.find(s => s.name === sub.name)
            if (existing) {
              const totalMoles = existing.concentration * targetHistory.currentVolume + sub.concentration * conn.volume
              existing.concentration = Math.round(totalMoles / (targetHistory.currentVolume + conn.volume) * 1000) / 1000
            } else {
              newSubstances.push({
                name: sub.name,
                concentration: Math.round((sub.concentration * conn.volume) / (targetHistory.currentVolume + conn.volume) * 1000) / 1000,
                concentrationUnit: sub.concentrationUnit
              })
            }
          }
        }
        
        // 记录移入操作
        const fromId = sourceTube.type === 'buffer' && sourceTube.id.startsWith('buffer-')
          ? sourceTube.id  // 保留缓冲液的完整ID
          : conn.fromTubeId
        
        addRecordToHistory(targetHistory, currentExperiment.id, currentExperiment.name, 'transfer_in',
          targetHistory.currentVolume, targetHistory.currentVolume + conn.volume,
          conn.volumeUnit, targetHistory.currentSubstances, newSubstances,
          fromId, undefined, conn.volume)
      }
    }
    saveHistories(histories)
    
    // 计算结束状态
    const tubeInVolume = new Map<string, number>()
    const tubeOutVolume = new Map<string, number>()
    
    for (const conn of connections) {
      if (conn.volume <= 0) continue
      tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
      tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
    }
    
    // 计算每个试管移入的物质
    const tubeInSubstances = new Map<string, Map<string, { moles: number; unit: string }>>()
    
    for (const conn of connections) {
      if (conn.volume <= 0) continue
      const sourceTube = currentTubes.find(t => t.id === conn.fromTubeId)
      if (!sourceTube || sourceTube.type === 'buffer') continue
      
      let substanceMap = tubeInSubstances.get(conn.toTubeId)
      if (!substanceMap) {
        substanceMap = new Map()
        tubeInSubstances.set(conn.toTubeId, substanceMap)
      }
      
      for (const sub of sourceTube.substances) {
        const moles = sub.concentration * conn.volume
        const existing = substanceMap.get(sub.name)
        if (existing) {
          existing.moles += moles
        } else {
          substanceMap.set(sub.name, { moles, unit: sub.concentrationUnit })
        }
      }
    }
    
    // 获取仓库数据，用于获取原料试管的初始体积
    const warehouseTubesForInit = await getWarehouseTubes()
    
    const endStateTubes = currentTubes.map(tube => {
      const inVolume = tubeInVolume.get(tube.id) || 0
      const outVolume = tubeOutVolume.get(tube.id) || 0
      
      // 计算结束体积
      let endVolume: number
      if (tube.type === 'source') {
        // 原料试管：使用仓库中的初始体积 - 移出体积
        const whTube = warehouseTubesForInit.find(t => t.id === tube.id)
        const initialVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
        endVolume = Math.max(0, initialVolume - outVolume)
      } else if (tube.type === 'buffer') {
        // 缓冲液：保持不变
        endVolume = tube.remainingVolume
      } else if (tube.type === 'intermediate') {
        // 中间产物：判断是从仓库添加的还是新创建的
        const whTube = warehouseTubesForInit.find(t => t.id === tube.id)
        const isInWarehouse = !!whTube
        
        if (isInWarehouse) {
          // 从仓库添加的中间产物：当作原料处理
          const initialVolume = whTube.remainingVolume
          endVolume = Math.max(0, initialVolume - outVolume)
        } else {
          // 新创建的中间产物：移入体积 - 移出体积
          endVolume = Math.max(0, inVolume - outVolume)
        }
      } else {
        endVolume = tube.remainingVolume
      }
      
      // 浓度保持不变（用户设定的值）
      const endSubstances = tube.substances
      
      return {
        ...tube,
        remainingVolume: endVolume,
        totalVolume: endVolume,
        substances: endSubstances,
        updatedAt: new Date().toISOString()
      }
    })
    
    // 更新仓库
    const warehouseTubes = await getWarehouseTubes()
    console.log('[completeExperiment] Warehouse tubes:', warehouseTubes.length)
    const tubesToUpdate: Tube[] = []
    const tubesToAdd: Tube[] = []
    
    for (const tube of endStateTubes) {
      // 跳过上样试管（不保存到仓库）
      if (tube.type === 'sample') {
        continue
      }
      
      if (tube.type === 'source') {
        // 原料试管：更新剩余体积和状态
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        console.log('[completeExperiment] Source tube:', tube.id, tube.name, 'found in warehouse:', !!whTube, 'endVolume:', tube.remainingVolume)
        if (whTube) {
          whTube.remainingVolume = tube.remainingVolume
          whTube.substances = tube.substances
          whTube.status = tube.remainingVolume <= 0 ? 'depleted' : 'active'
          whTube.updatedAt = new Date().toISOString()
          tubesToUpdate.push(whTube)
        }
      } else if (tube.type === 'intermediate') {
        // 中间产物：检查是否已在仓库中
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        
        if (whTube) {
          // 已在仓库中（之前实验产生的），更新剩余体积
          console.log('[completeExperiment] Intermediate tube (existing):', tube.id, tube.name, 'endVolume:', tube.remainingVolume)
          whTube.remainingVolume = tube.remainingVolume
          whTube.totalVolume = tube.totalVolume
          whTube.substances = tube.substances
          whTube.status = tube.remainingVolume <= 0 ? 'depleted' : 'active'
          whTube.updatedAt = new Date().toISOString()
          tubesToUpdate.push(whTube)
        } else {
          // 不在仓库中（新产生的），添加到仓库
          console.log('[completeExperiment] Intermediate tube (new):', tube.id, tube.name, 'endVolume:', tube.remainingVolume)
          const intermediateTube: Tube = {
            ...tube,
            status: 'active',
            updatedAt: new Date().toISOString()
          }
          intermediateTube.createdAt = intermediateTube.createdAt || new Date().toISOString()
          tubesToAdd.push(intermediateTube)
        }
      }
    }
    
    console.log('[completeExperiment] Tubes to update:', tubesToUpdate.length)
    console.log('[completeExperiment] Tubes to add:', tubesToAdd.length)
    console.log('[completeExperiment] Has electronAPI:', !!window.electronAPI)
    
    // 保存到数据库
    if (window.electronAPI) {
      // 更新已有试管
      for (const tube of tubesToUpdate) {
        console.log('[completeExperiment] Updating tube:', tube.id, tube.remainingVolume)
        await window.electronAPI.updateTube({
          id: tube.id,
          name: tube.name,
          type: tube.type,
          totalVolume: tube.totalVolume,
          totalVolumeUnit: tube.totalVolumeUnit,
          remainingVolume: tube.remainingVolume,
          remainingVolumeUnit: tube.remainingVolumeUnit,
          substances: JSON.stringify(tube.substances),
          updatedAt: tube.updatedAt,
          status: tube.status
        })
      }
      
      // 添加新试管
      for (const tube of tubesToAdd) {
        console.log('[completeExperiment] Adding tube:', tube.id, tube.name, tube.remainingVolume)
        await window.electronAPI.addTube({
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
          status: tube.status
        })
      }
    } else {
      // 降级到 localStorage
      console.log('[completeExperiment] Using localStorage fallback')
      
      // 更新已有试管
      const existingTubesData = localStorage.getItem('labflow_tubes')
      let existingTubes: Tube[] = existingTubesData ? JSON.parse(existingTubesData) : []
      
      for (const tube of tubesToUpdate) {
        console.log('[completeExperiment] Updating tube in localStorage:', tube.id, tube.remainingVolume)
        const index = existingTubes.findIndex(t => t.id === tube.id)
        if (index >= 0) {
          existingTubes[index] = tube
        }
      }
      
      // 添加新试管
      for (const tube of tubesToAdd) {
        console.log('[completeExperiment] Adding tube to localStorage:', tube.id, tube.name, tube.remainingVolume)
        existingTubes.push(tube)
      }
      
      localStorage.setItem('labflow_tubes', JSON.stringify(existingTubes))
      console.log('[completeExperiment] Saved', existingTubes.length, 'tubes to localStorage')
    }
    
    // 保存实验
    const completedExperiment: Experiment = {
      ...currentExperiment,
      status: 'completed',
      completedAt: new Date().toISOString(),
      tubes: currentTubes,
      tubePositions: get().tubePositions,
      connections,
      initialStateTubes,
      endStateTubes
    }
    
    if (window.electronAPI) {
      await window.electronAPI.saveExperiment(experimentToDb(completedExperiment))
    }
    
    localStorage.removeItem(CURRENT_EXPERIMENT_KEY)
    
    const experiments = get().experiments
    const newExperiments = experiments.some(e => e.id === completedExperiment.id)
      ? experiments.map(e => e.id === completedExperiment.id ? completedExperiment : e)
      : [...experiments, completedExperiment]
    
    // 同时保存到 localStorage 作为备份（和 saveCurrentExperiment 一致）
    saveExperimentsToStorage(newExperiments)
    
    set({ currentExperiment: completedExperiment, currentTubes, tubePositions: get().tubePositions, experiments: newExperiments, showEndState: false })
  },
  
  revertExperiment: async (experimentId) => {
    const experiment = get().experiments.find(e => e.id === experimentId)
    if (!experiment || !experiment.warehouseSnapshot) {
      alert('无法回退：缺少仓库快照')
      return false
    }
    
    console.log('[revertExperiment] Reverting experiment:', experimentId)
    console.log('[revertExperiment] Warehouse snapshot:', experiment.warehouseSnapshot.length, 'tubes')
    
    // 获取当前仓库状态
    const currentWarehouseTubes = await getWarehouseTubes()
    console.log('[revertExperiment] Current warehouse:', currentWarehouseTubes.length, 'tubes')
    
    // 找出需要删除的中间产物（不在快照中的试管）
    const snapshotIds = new Set(experiment.warehouseSnapshot.map(t => t.id))
    const tubesToDelete = currentWarehouseTubes.filter(t => !snapshotIds.has(t.id))
    console.log('[revertExperiment] Tubes to delete:', tubesToDelete.map(t => t.name))
    
    // 恢复仓库快照
    await saveWarehouseTubes(experiment.warehouseSnapshot)
    console.log('[revertExperiment] Warehouse restored to snapshot')
    
    // 删除新增的试管（如果使用数据库）
    if (window.electronAPI) {
      for (const tube of tubesToDelete) {
        console.log('[revertExperiment] Deleting tube:', tube.id, tube.name)
        await window.electronAPI.deleteTube(tube.id)
      }
    } else {
      // localStorage 降级：快照已经覆盖了，不需要额外操作
      console.log('[revertExperiment] Using localStorage, snapshot already saved')
    }
    
    // 清除历史记录
    const histories = loadHistories()
    histories.forEach(history => {
      const expRecords = history.records.filter(r => r.experimentId === experimentId)
      if (expRecords.length === 0) return
      
      const firstRecord = expRecords[0]
      const beforeIndex = history.records.findIndex(r => r.id === firstRecord.id) - 1
      
      if (beforeIndex >= 0) {
        const before = history.records[beforeIndex]
        history.currentVolume = before.volumeAfter
        history.currentSubstances = before.substancesAfter
      } else {
        history.currentVolume = firstRecord.volumeBefore
        history.currentSubstances = firstRecord.substancesBefore
      }
      history.records = history.records.filter(r => r.experimentId !== experimentId)
    })
    saveHistories(histories)
    
    const revertedExperiment = { ...experiment, status: 'reverted' as const, updatedAt: new Date().toISOString() }
    if (window.electronAPI) {
      await window.electronAPI.saveExperiment(experimentToDb(revertedExperiment))
    }
    
    const newExperiments = get().experiments.map(e => e.id === experimentId ? revertedExperiment : e)
    saveExperimentsToStorage(newExperiments)
    set({ experiments: newExperiments })
    console.log('[revertExperiment] Experiment reverted successfully')
    return true
  },
  
  toggleShowEndState: () => {
    set(state => {
      const newShowEndState = !state.showEndState
      
      if (state.currentExperiment) {
        if (newShowEndState) {
          // 显示结束状态
          if (state.currentExperiment.status === 'completed' && state.currentExperiment.endStateTubes) {
            // 已完成实验：使用保存的结束状态
            return { showEndState: true, currentTubes: state.currentExperiment.endStateTubes }
          } else {
            // 未完成实验：动态计算结束状态
            const calculatedEndState = calculateEndState(state.currentTubes, state.connections)
            return { showEndState: true, currentTubes: calculatedEndState }
          }
        } else {
          // 显示初始状态
          const displayTubes = state.currentExperiment.initialStateTubes || state.currentExperiment.tubes
          return { showEndState: false, currentTubes: displayTubes }
        }
      }
      return { showEndState: newShowEndState }
    })
  },
  
  fetchExperiments: async () => {
    set({ loading: true, error: null })
    try {
      if (window.electronAPI) {
        const records = await window.electronAPI.getExperiments()
        const experiments = records.map(dbToExperiment)
        // 同时保存到 localStorage 作为备份
        saveExperimentsToStorage(experiments)
        set({ experiments, loading: false })
      } else {
        // 降级到 localStorage
        const experiments = loadExperimentsFromStorage()
        set({ experiments, loading: false })
      }
    } catch (error) {
      console.error('Failed to fetch experiments from database, trying localStorage:', error)
      // 出错时尝试从 localStorage 加载
      const experiments = loadExperimentsFromStorage()
      set({ experiments, loading: false, error: (error as Error).message })
    }
  },
  
  resetExperiment: () => {
    localStorage.removeItem(CURRENT_EXPERIMENT_KEY)
    set({ currentExperiment: null, currentTubes: [], connections: [], tubePositions: [], showEndState: false })
  },
  
  loadSavedExperiment: () => {
    const saved = loadCurrentExperimentFromStorage()
    if (saved) {
      set({
        currentExperiment: saved.currentExperiment,
        currentTubes: saved.currentTubes,
        connections: saved.connections,
        tubePositions: saved.tubePositions || [],
        showEndState: false
      })
    }
  },
  
  setDefaultBuffer: (bufferId) => {
    set(state => {
      if (!state.currentExperiment) return state
      const updated = { 
        ...state.currentExperiment, 
        defaultBuffer: bufferId 
      }
      saveCurrentExperimentToStorage({ ...state, currentExperiment: updated })
      return { currentExperiment: updated }
    })
  },
  
  setExperimentAsWaste: (isWaste) => {
    set(state => {
      if (!state.currentExperiment) return state
      const updated = { 
        ...state.currentExperiment, 
        isWaste 
      }
      saveCurrentExperimentToStorage({ ...state, currentExperiment: updated })
      return { currentExperiment: updated }
    })
  }
}))

export function getTubeHistory(tubeId: string) {
  return loadHistories().get(tubeId)
}

export function getAllTubeHistories() {
  const histories = loadHistories()
  
  // 过滤掉无效的历史记录
  const validHistories = new Map<string, TubeHistory>()
  
  histories.forEach((history, tubeId) => {
    // 必须有 records 数组且不为空
    if (history.records && history.records.length > 0) {
      // 过滤掉无效的记录
      const validRecords = history.records.filter(r => {
        if (r.action === 'created') return true
        if (r.action === 'transfer_in' || r.action === 'transfer_out') {
          // 必须有有效的转移体积
          return r.transferVolume !== undefined && r.transferVolume > 0
        }
        return true
      })
      
      // 如果还有有效记录，更新并保留
      if (validRecords.length > 0) {
        history.records = validRecords
        validHistories.set(tubeId, history)
      }
    }
  })
  
  return validHistories
}
