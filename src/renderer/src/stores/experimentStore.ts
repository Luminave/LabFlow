/**
 * 实验状态管理
 * 使用 SQLite 数据库持久化，localStorage 作为后备
 */

import { create } from 'zustand'
import {
  ProjectFileConflictError,
  isProjectFileAvailable,
  loadProjectSource,
  saveProjectSource,
  type ProjectFileStat
} from '../utils/projectSource'
import { Experiment, Tube, TransferConnection, TubePosition, Substance, VolumeUnit } from '@shared/types'
import { roundVolume } from '@shared/utils/calculations'
import { computeEndState } from '@/core/endState'
import { settleExperiment } from '@/core/settle'
import { useWarehouseStore } from './warehouseStore'
import { requestWarehouseWrite } from '../utils/warehouseWriteQueue'
import { blendConcentration, mergeSubstancePlaceholders } from '@/core/mix'

const CURRENT_EXPERIMENT_KEY = 'labflow_current_experiment'
const TUBE_HISTORIES_KEY = 'labflow_tube_histories'
const EXPERIMENTS_KEY = 'labflow_experiments' // 实验记录的 localStorage key

// ==================== 自动保存防抖机制 ====================
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

/** 有没还没落盘的改动（自动保存的防抖窗口里就算有）——热加载判断用 */
export function hasPendingAutoSave(): boolean {
  return autoSaveTimer !== null
}
const AUTO_SAVE_DELAY = 2000 // 2秒防抖

/**
 * 防抖自动保存：修改操作后 2 秒自动保存到数据库
 * 防止用户忘记点保存按钮导致数据丢失
 */
function debouncedAutoSave(get: () => ExperimentState) {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(async () => {
    autoSaveTimer = null
    const state = get()
    if (!state.currentExperiment) return
    
    const experiment: Experiment = {
      ...state.currentExperiment,
      tubes: state.currentTubes,
      tubePositions: state.tubePositions,
      connections: state.connections,
      updatedAt: new Date().toISOString()
    }
    
    try {
      if (window.electronAPI) {
        await persistExperiment(experiment)
        console.log('[AutoSave] Experiment saved to database, id:', experiment.id)
      }
      
      // 同步更新 experiments 数组
      const experiments = get().experiments
      const existingIndex = experiments.findIndex(e => e.id === experiment.id)
      let newExperiments: Experiment[]
      if (existingIndex >= 0) {
        newExperiments = experiments.map(e => e.id === experiment.id ? experiment : e)
      } else {
        newExperiments = [...experiments, experiment]
      }
      
      saveExperimentsToStorage(newExperiments)
      // 注意：不调用 set() 避免循环触发，只更新 experiments 数组
      // currentExperiment/currentTubes 等已经在各操作中更新过了
    } catch (e) {
      console.error('[AutoSave] Failed to save experiment to DB:', e)
      // DB 失败时仍然保存到 localStorage
      const experiments = get().experiments
      const existingIndex = experiments.findIndex(ee => ee.id === experiment.id)
      let newExperiments: Experiment[]
      if (existingIndex >= 0) {
        newExperiments = experiments.map(ee => ee.id === experiment.id ? experiment : ee)
      } else {
        newExperiments = [...experiments, experiment]
      }
      saveExperimentsToStorage(newExperiments)
      console.log('[AutoSave] Saved to localStorage as fallback')
    }
  }, AUTO_SAVE_DELAY)
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
  saveCurrentExperiment: (name?: string, options?: { forceFile?: boolean }) => Promise<boolean | void>
  saveAsExperiment: (newName: string) => void
  /** 从工程正本文件重新载入（冲突时选「重新载入」/ 顶部提示条点它） */
  reloadExperimentFromFile: (id: string) => Promise<boolean>
  loadExperiment: (id: string) => boolean
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
  
  toggleShowEndState: () => Promise<void>
  fetchExperiments: () => Promise<void>
  resetExperiment: () => void
  loadSavedExperiment: () => void
  
  setDefaultBuffer: (bufferId: string | undefined) => void
  setExperimentAsWaste: (isWaste: boolean) => void
}

// 试管数据完整性修复（兼容旧数据格式）
function sanitizeTube(tube: any): Tube {
  return {
    id: tube.id || crypto.randomUUID(),
    name: tube.name || '未命名试管',
    type: tube.type || 'intermediate',
    totalVolume: tube.totalVolume ?? 0,
    totalVolumeUnit: tube.totalVolumeUnit || 'μL',
    remainingVolume: tube.remainingVolume ?? 0,
    remainingVolumeUnit: tube.remainingVolumeUnit || 'μL',
    substances: Array.isArray(tube.substances) ? tube.substances : [],
    createdAt: tube.createdAt || new Date().toISOString(),
    updatedAt: tube.updatedAt || new Date().toISOString(),
    status: tube.status || 'active',
    // 可选字段保留原值
    selectedBuffer: tube.selectedBuffer,
    asSource: tube.asSource,
    configOrder: tube.configOrder,
    tubeNumber: tube.tubeNumber,
    groupId: tube.groupId,
    storageLocation: tube.storageLocation,
    storageCondition: tube.storageCondition,
    notes: tube.notes,
    tags: tube.tags
  }
}

// 数据库记录转换
// 安全解析 JSON，处理双重序列化的情况
function safeParseJsonArray(jsonStr: string | null | undefined, defaultValue: any[] = []): any[] {
  if (!jsonStr) return defaultValue
  try {
    let parsed = JSON.parse(jsonStr)
    // 处理双重序列化：如果解析结果是字符串，再解析一次
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
    }
    return Array.isArray(parsed) ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}

function dbToExperiment(record: any): Experiment {
  const tubes = safeParseJsonArray(record.tubes).map(sanitizeTube)

  let initialStateTubes: any[] | undefined
  try {
    const parsed = safeParseJsonArray(record.initial_state_tubes)
    initialStateTubes = parsed.length > 0 ? parsed.map(sanitizeTube) : undefined
  } catch {
    initialStateTubes = undefined
  }

  let endStateTubes: any[] | undefined
  try {
    const parsed = safeParseJsonArray(record.end_state_tubes)
    endStateTubes = parsed.length > 0 ? parsed.map(sanitizeTube) : undefined
  } catch {
    endStateTubes = undefined
  }

  let warehouseSnapshot: any[] | undefined
  try {
    const parsed = safeParseJsonArray(record.warehouse_snapshot)
    warehouseSnapshot = parsed.length > 0 ? parsed.map(sanitizeTube) : undefined
  } catch {
    warehouseSnapshot = undefined
  }

  const tubePositions = safeParseJsonArray(record.tube_positions)
  const connections = safeParseJsonArray(record.connections)

  return {
    id: record.id,
    name: record.name || '未命名实验',
    description: record.description || undefined,
    createdAt: record.created_at || new Date().toISOString(),
    updatedAt: record.updated_at || new Date().toISOString(),
    completedAt: record.completed_at || undefined,
    status: record.status || 'draft',
    tubes,
    tubePositions,
    connections,
    warehouseSnapshot,
    initialStateTubes,
    endStateTubes,
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
    tubes: exp.tubes, // 主进程会做 JSON.stringify，这里传原始数组
    tube_positions: exp.tubePositions || [], // 主进程会做 JSON.stringify
    connections: exp.connections, // 主进程会做 JSON.stringify
    warehouse_snapshot: exp.warehouseSnapshot || null,
    initial_state_tubes: exp.initialStateTubes || null,
    end_state_tubes: exp.endStateTubes || null,
    is_waste: exp.isWaste ? 1 : 0
  }
}

// 历史记录管理
async function loadHistories(): Promise<Map<string, TubeHistory>> {
  try {
    if (window.electronAPI) {
      // 从 SQLite 加载
      const histories = await window.electronAPI.getTubeHistories()
      // 验证数据完整性
      const validHistories = histories.filter((h: any) => h && h.tubeId && Array.isArray(h.records))
      return new Map(validHistories.map((h: TubeHistory) => [h.tubeId, h]))
    } else {
      // 降级到 localStorage
      const data = localStorage.getItem(TUBE_HISTORIES_KEY)
      if (data) {
        const arr = JSON.parse(data)
        if (Array.isArray(arr)) {
          const validHistories = arr.filter((h: any) => h && h.tubeId && Array.isArray(h.records))
          return new Map(validHistories.map((h: TubeHistory) => [h.tubeId, h]))
        }
      }
    }
  } catch (e) {
    console.error('Failed to load histories:', e)
  }
  return new Map()
}

async function saveHistories(histories: Map<string, TubeHistory>) {
  const historiesArray = Array.from(histories.values())
  if (window.electronAPI) {
    // 保存到 SQLite
    const result = await window.electronAPI.saveTubeHistories(historiesArray)
    if (!result || !result.success) {
      throw new Error(result?.error || '保存试管历史到数据库失败')
    }
  } else {
    // 降级到 localStorage
    localStorage.setItem(TUBE_HISTORIES_KEY, JSON.stringify(historiesArray))
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
          substances: tube.substances, // 主进程会做 JSON.stringify，这里传原始数组
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
    if (data) {
      const experiments = JSON.parse(data)
      // 确保试管数据完整
      return experiments.map((exp: any) => ({
        ...exp,
        tubes: (exp.tubes || []).map(sanitizeTube),
        initialStateTubes: exp.initialStateTubes ? exp.initialStateTubes.map(sanitizeTube) : undefined,
        endStateTubes: exp.endStateTubes ? exp.endStateTubes.map(sanitizeTube) : undefined,
        warehouseSnapshot: exp.warehouseSnapshot ? exp.warehouseSnapshot.map(sanitizeTube) : undefined,
        connections: exp.connections || [],
        tubePositions: exp.tubePositions || []
      }))
    }
  } catch (e) {
    console.error('Failed to load experiments from localStorage:', e)
  }
  return []
}

/** 工程 id → 正本文件信息（写文件时用它判断「有没有被别人改过」） */
const projectFiles = new Map<string, { fileName: string; stat: ProjectFileStat | null }>()

export function getProjectFileInfo(id: string): { fileName: string; stat: ProjectFileStat | null } | undefined {
  return projectFiles.get(id)
}

/** 先写正本（yml），再写数据库缓存；正本冲突时抛 ProjectFileConflictError，调用方决定怎么问主人 */
async function persistExperiment(
  experiment: Experiment,
  options: { skipFile?: boolean; forceFile?: boolean } = {}
): Promise<void> {
  if (!options.skipFile && isProjectFileAvailable()) {
    const known = projectFiles.get(experiment.id)
    // forceFile：主人在「工程文件已被外部修改」对话框里选了「用界面覆盖」
    const saved = await saveProjectSource(experiment, options.forceFile ? null : known?.stat ?? null)
    projectFiles.set(experiment.id, { fileName: saved.fileName, stat: saved.stat })
  }
  if (window.electronAPI) {
    // 数据库继续当缓存/回退：正本写成功后再落库，正本失败时这里不会被执行到
    await window.electronAPI.saveExperiment(experimentToDb(experiment))
  }
}

/**
 * 把所有工程的打开来源换成「工程/*.yml」：
 * - 文件存在 → 用文件内容（数据库只补快照类字段）
 * - 文件不存在 → 由数据库记录生成一份
 */
/** 这一轮以文件为准读进来的工程 id（用来阻止「数据库版本」把它们覆盖回去） */
const fileBackedIds = new Set<string>()

async function syncProjectsWithFiles(experiments: Experiment[]): Promise<Experiment[]> {
  if (!isProjectFileAvailable()) return experiments
  fileBackedIds.clear()
  const out: Experiment[] = []
  for (const experiment of experiments) {
    try {
      const source = await loadProjectSource(experiment)
      if (source) {
        projectFiles.set(experiment.id, { fileName: source.fileName, stat: source.stat })
        if (source.warnings.length > 0) {
          console.warn(`[Store] ${source.fileName} 有问题：`, source.warnings.join('；'))
        }
        if (source.fromFile) fileBackedIds.add(experiment.id)
        out.push(source.experiment)
        continue
      }
    } catch (error) {
      console.error('[Store] 读工程正本失败，退回数据库：', experiment.name, error)
    }
    out.push(experiment)
  }
  return out
}

export function resetProjectFileCache(): void {
  projectFiles.clear()
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
  
  saveCurrentExperiment: async (name, options) => {
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
        console.log('[saveCurrentExperiment] 写正本+缓存, id:', experiment.id, 'name:', experiment.name)
        await persistExperiment(experiment, { forceFile: options?.forceFile })
        console.log('[saveCurrentExperiment] 保存成功')
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
      // 使用 experiment 中的最新数据保存，而不是旧的 state
      saveCurrentExperimentToStorage({
        currentExperiment: experiment,
        currentTubes: experiment.tubes,
        connections: experiment.connections,
        tubePositions: experiment.tubePositions
      })
      console.log('[saveCurrentExperiment] Store updated, experiments count:', newExperiments.length)
      return true
    } catch (e) {
      // 工程正本被外部改过：不覆盖、不改 store，交给界面弹「重新载入 / 用界面覆盖」
      if (e instanceof ProjectFileConflictError) throw e
      console.error('[saveCurrentExperiment] Failed to save experiment:', e)
      // 即使 DB 保存失败，也更新 store 和 localStorage
      const experiments = get().experiments
      const existingIndex = experiments.findIndex(ee => ee.id === experiment.id)
      let newExperiments: Experiment[]
      if (existingIndex >= 0) {
        newExperiments = experiments.map(ee => ee.id === experiment.id ? experiment : ee)
      } else {
        newExperiments = [...experiments, experiment]
      }
      saveExperimentsToStorage(newExperiments)
      set({ experiments: newExperiments, currentExperiment: experiment })
      saveCurrentExperimentToStorage({
        currentExperiment: experiment,
        currentTubes: experiment.tubes,
        connections: experiment.connections,
        tubePositions: experiment.tubePositions
      })
      console.log('[saveCurrentExperiment] Saved to store+localStorage despite DB error')
      return false
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
        await persistExperiment(newExperiment)
      }
      
      const experiments = get().experiments
      const newExperiments = [...experiments, newExperiment]
      
      saveExperimentsToStorage(newExperiments)
      
      set({ experiments: newExperiments, currentExperiment: newExperiment })
      // 使用 newExperiment 中的最新数据保存
      saveCurrentExperimentToStorage({
        currentExperiment: newExperiment,
        currentTubes: newExperiment.tubes,
        connections: newExperiment.connections,
        tubePositions: newExperiment.tubePositions
      })
    } catch (e) {
      console.error('Failed to save as experiment:', e)
    }
  },
  
  reloadExperimentFromFile: async (id) => {
    const experiment = get().experiments.find(e => e.id === id) || get().currentExperiment
    if (!experiment) return false
    const source = await loadProjectSource(experiment)
    if (!source) return false
    projectFiles.set(id, { fileName: source.fileName, stat: source.stat })
    const safeTubes = (source.experiment.tubes || []).map(sanitizeTube)
    const displayTubes = source.experiment.initialStateTubes
      ? source.experiment.initialStateTubes.map(sanitizeTube)
      : safeTubes
    set({
      currentExperiment: { ...source.experiment, tubes: safeTubes },
      currentTubes: displayTubes,
      connections: source.experiment.connections || [],
      tubePositions: source.experiment.tubePositions || [],
      experiments: get().experiments.map(e => (e.id === source.experiment.id ? source.experiment : e)),
      showEndState: false
    })
    saveCurrentExperimentToStorage({
      currentExperiment: { ...source.experiment, tubes: safeTubes },
      currentTubes: displayTubes,
      connections: source.experiment.connections || [],
      tubePositions: source.experiment.tubePositions || []
    })
    return true
  },

  loadExperiment: (id) => {
    try {
      const experiment = get().experiments.find(e => e.id === id)
      if (!experiment) {
        console.warn('[loadExperiment] Experiment not found:', id)
        return false
      }

      // 确保 tubes 数据完整（兼容旧数据格式）
      const safeTubes = (experiment.tubes || []).map(sanitizeTube)
      const safeInitialTubes = experiment.initialStateTubes
        ? experiment.initialStateTubes.map(sanitizeTube)
        : undefined
      const displayTubes = safeInitialTubes || safeTubes

      const safeConnections = experiment.connections || []
      const safePositions = experiment.tubePositions || []

      set({
        currentExperiment: { ...experiment, tubes: safeTubes, initialStateTubes: safeInitialTubes },
        currentTubes: displayTubes,
        connections: safeConnections,
        tubePositions: safePositions,
        showEndState: false
      })

      saveCurrentExperimentToStorage({
        currentExperiment: { ...experiment, tubes: safeTubes, initialStateTubes: safeInitialTubes },
        currentTubes: displayTubes,
        connections: safeConnections,
        tubePositions: safePositions
      })
      return true
    } catch (e) {
      console.error('[loadExperiment] Failed to load experiment:', e)
      return false
    }
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
    debouncedAutoSave(get)
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
    debouncedAutoSave(get)
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
    debouncedAutoSave(get)
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
    debouncedAutoSave(get)
  },
  
  addWasteTube: (tube) => {
    set(state => {
      if (!state.currentExperiment) return state
      
      const newTubes = [...state.currentTubes, tube]
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
    debouncedAutoSave(get)
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
    debouncedAutoSave(get)
  },
  
  updateTubeInExperiment: (tubeId, updates) => {
    set(state => {
      if (!state.currentExperiment) return state
      const newTubes = state.currentTubes.map(t => t.id === tubeId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)
      const newState = { currentTubes: newTubes, currentExperiment: { ...state.currentExperiment, tubes: newTubes } }
      saveCurrentExperimentToStorage({ ...newState, connections: state.connections, tubePositions: state.tubePositions })
      return newState
    })
    debouncedAutoSave(get)
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
        const existingSubstances = mergeSubstancePlaceholders(targetTube.substances, sourceTube.substances)
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
    debouncedAutoSave(get)
  },
  
  updateConnection: (id, updates) => {
    set(state => {
      if (!state.currentExperiment) return state
      const newConnections = state.connections.map(c => c.id === id ? { ...c, ...updates } : c)
      const newState = { connections: newConnections, currentExperiment: { ...state.currentExperiment, connections: newConnections } }
      saveCurrentExperimentToStorage({ ...state, ...newState })
      return newState
    })
    debouncedAutoSave(get)
  },
  
  removeConnection: (id) => {
    set(state => {
      if (!state.currentExperiment) return state
      const newConnections = state.connections.filter(c => c.id !== id)
      const newState = { connections: newConnections, currentExperiment: { ...state.currentExperiment, connections: newConnections } }
      saveCurrentExperimentToStorage({ ...state, ...newState })
      return newState
    })
    debouncedAutoSave(get)
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
    debouncedAutoSave(get)
  },
  
  completeExperiment: async () => {
    const { currentExperiment, currentTubes, connections } = get()
    if (!currentExperiment) return

    const histories = await loadHistories()
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
          roundVolume(sourceHistory.currentVolume), roundVolume(Math.max(0, sourceHistory.currentVolume - conn.volume)),
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
              existing.concentration = blendConcentration(
                existing, targetHistory.currentVolume, sub, conn.volume, existing.concentrationUnit
              )
            } else {
              newSubstances.push({
                name: sub.name,
                concentration: blendConcentration(
                  { name: sub.name, concentration: 0, concentrationUnit: sub.concentrationUnit },
                  targetHistory.currentVolume, sub, conn.volume, sub.concentrationUnit
                ),
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
          roundVolume(targetHistory.currentVolume), roundVolume(targetHistory.currentVolume + conn.volume),
          conn.volumeUnit, targetHistory.currentSubstances, newSubstances,
          fromId, undefined, conn.volume)
      }
    }
    try {
      await saveHistories(histories)
    } catch (e) {
      console.error('[completeExperiment] Failed to save tube histories:', e)
      alert('⚠️ 试管历史记录保存失败：' + (e as Error).message + '\n\n实验数据已保存，但溯源页面可能无法显示试管记录。')
    }

    // 结算（core 纯函数：界面与 CLI 共用同一套规则）
    const warehouseNow = await getWarehouseTubes()
    const settled = settleExperiment(
      { experiment: { tubes: currentTubes, connections }, warehouse: warehouseNow },
      { now: () => new Date().toISOString() }
    )
    const endStateTubes = settled.endStateTubes

    console.log('[completeExperiment] 结算：扣减', settled.usage.length, '条，新入仓', settled.created.length, '根，耗尽', settled.depleted.length, '根')

    if (window.electronAPI) {
      // 仓库里已有的试管：余量 / 状态
      for (const tube of settled.updated) {
        await window.electronAPI.updateTube({
          id: tube.id,
          name: tube.name,
          type: tube.type,
          totalVolume: tube.totalVolume,
          totalVolumeUnit: tube.totalVolumeUnit,
          remainingVolume: tube.remainingVolume,
          remainingVolumeUnit: tube.remainingVolumeUnit,
          substances: tube.substances,
          updatedAt: tube.updatedAt,
          status: tube.status
        })
      }

      // 新入仓的中间产物：保留画布上的 id
      for (const tube of settled.createdTubes) {
        await window.electronAPI.addTube({
          id: tube.id,
          name: tube.name,
          type: tube.type,
          totalVolume: tube.totalVolume,
          totalVolumeUnit: tube.totalVolumeUnit,
          remainingVolume: tube.remainingVolume,
          remainingVolumeUnit: tube.remainingVolumeUnit,
          substances: tube.substances,
          createdAt: tube.createdAt,
          updatedAt: tube.updatedAt,
          status: tube.status
        })
      }

      // 结算结果回写 仓库.yml（写前有截断护栏）
      useWarehouseStore.getState().setTubes(settled.warehouseAfter)
      requestWarehouseWrite()
    } else {
      // 降级到 localStorage
      const existingTubesData = localStorage.getItem('labflow_tubes')
      const existingTubes: Tube[] = existingTubesData ? JSON.parse(existingTubesData) : []
      const merged = new Map(existingTubes.map(t => [t.id, t]))
      for (const tube of settled.warehouseAfter) {
        const { tubeNumber: _ignored, ...tubeData } = tube as any
        merged.set(tube.id, tubeData as Tube)
      }
      localStorage.setItem('labflow_tubes', JSON.stringify([...merged.values()]))
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
      await persistExperiment(completedExperiment)
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
    const histories = await loadHistories()
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
    try {
      await saveHistories(histories)
    } catch (e) {
      console.error('[revertExperiment] Failed to save tube histories:', e)
    }

    const revertedExperiment = { ...experiment, status: 'reverted' as const, updatedAt: new Date().toISOString() }
    if (window.electronAPI) {
      await persistExperiment(revertedExperiment)
    }
    
    const newExperiments = get().experiments.map(e => e.id === experimentId ? revertedExperiment : e)
    saveExperimentsToStorage(newExperiments)
    
    // 同步更新 currentExperiment（如果当前正在查看这个实验）
    const currentExp = get().currentExperiment
    const updates: any = { experiments: newExperiments }
    if (currentExp && currentExp.id === experimentId) {
      updates.currentExperiment = revertedExperiment
    }
    set(updates)
    
    console.log('[revertExperiment] Experiment reverted successfully')
    return true
  },
  
  toggleShowEndState: async () => {
    const state = get()
    const newShowEndState = !state.showEndState

    if (state.currentExperiment) {
      if (newShowEndState) {
        // 显示结束状态
        if (state.currentExperiment.status === 'completed' && state.currentExperiment.endStateTubes) {
          // 已完成实验：使用保存的结束状态
          set({ showEndState: true, currentTubes: state.currentExperiment.endStateTubes })
          return
        }
        // 未完成实验：动态计算结束状态（内核：查仓库口径）
        const warehouseTubes = await getWarehouseTubes()
        const calculatedEndState = computeEndState({
          tubes: state.currentTubes,
          connections: state.connections,
          warehouseTubes
        })
        set({ showEndState: true, currentTubes: calculatedEndState })
        return
      }
      // 显示初始状态
      const displayTubes = state.currentExperiment.initialStateTubes || state.currentExperiment.tubes
      set({ showEndState: false, currentTubes: displayTubes })
      return
    }

    set({ showEndState: newShowEndState })
  },
  
  fetchExperiments: async () => {
    set({ loading: true, error: null })
    try {
      let experiments: Experiment[]
      if (window.electronAPI) {
        const records = await window.electronAPI.getExperiments()
        experiments = records.map(dbToExperiment)
        console.log('[fetchExperiments] Loaded from DB:', experiments.length, 'experiments')
        // 正本在 工程/*.yml：文件存在就用文件，缺文件就用数据库记录生成一份
        experiments = await syncProjectsWithFiles(experiments)
      } else {
        experiments = loadExperimentsFromStorage()
        console.log('[fetchExperiments] Loaded from localStorage:', experiments.length, 'experiments')
      }
      
      // 合并：如果当前正在编辑的实验在列表中，用当前最新的数据覆盖
      const currentState = get()
      if (currentState.currentExperiment) {
        const currentId = currentState.currentExperiment.id

        // 这一轮是从 工程/*.yml 读进来的 → 文件为准：拿文件版本回填当前工程，而不是反过来
        const fromFile = fileBackedIds.has(currentId)
          ? experiments.find(e => e.id === currentId)
          : undefined
        if (fromFile) {
          set({
            currentExperiment: fromFile,
            currentTubes: fromFile.tubes,
            connections: fromFile.connections || [],
            tubePositions: fromFile.tubePositions || []
          })
          console.log('[fetchExperiments] 当前工程以正本文件为准：', fromFile.name)
        } else {
          const latestExperiment: Experiment = {
            ...currentState.currentExperiment,
            tubes: currentState.currentTubes,
            tubePositions: currentState.tubePositions,
            connections: currentState.connections,
            updatedAt: new Date().toISOString()
          }
          const existingIndex = experiments.findIndex(e => e.id === currentId)
          if (existingIndex >= 0) {
            // 用当前最新的数据覆盖数据库中的旧数据
            experiments[existingIndex] = latestExperiment
          } else {
            experiments.unshift(latestExperiment)
          }
          console.log('[fetchExperiments] Merged current experiment, total:', experiments.length)
        }
      }
      
      saveExperimentsToStorage(experiments)
      set({ experiments, loading: false })
    } catch (error) {
      console.error('[fetchExperiments] Failed to fetch from database, trying localStorage:', error)
      let experiments = loadExperimentsFromStorage()
      
      // 即使 DB 加载失败，也要合并当前实验
      const currentState = get()
      if (currentState.currentExperiment) {
        const currentId = currentState.currentExperiment.id
        const latestExperiment: Experiment = {
          ...currentState.currentExperiment,
          tubes: currentState.currentTubes,
          tubePositions: currentState.tubePositions,
          connections: currentState.connections,
          updatedAt: new Date().toISOString()
        }
        const existingIndex = experiments.findIndex(e => e.id === currentId)
        if (existingIndex >= 0) {
          experiments[existingIndex] = latestExperiment
        } else {
          experiments.unshift(latestExperiment)
        }
      }
      
      saveExperimentsToStorage(experiments)
      set({ experiments, loading: false, error: (error as Error).message })
    }
  },
  
  resetExperiment: () => {
    localStorage.removeItem(CURRENT_EXPERIMENT_KEY)
    set({ currentExperiment: null, currentTubes: [], connections: [], tubePositions: [], showEndState: false })
  },
  
  loadSavedExperiment: () => {
    try {
      const saved = loadCurrentExperimentFromStorage()
      if (saved && saved.currentExperiment) {
        // 确保试管数据完整
        const safeTubes = (saved.currentTubes || []).map(sanitizeTube)

        // 同时将加载的实验合并到 experiments 列表中
        // 防止 fetchExperiments 先执行但找不到当前实验的情况
        const experiments = get().experiments
        const existingIndex = experiments.findIndex(e => e.id === saved.currentExperiment!.id)
        let newExperiments: Experiment[]
        if (existingIndex >= 0) {
          newExperiments = experiments.map(e => e.id === saved.currentExperiment!.id ? saved.currentExperiment! : e)
        } else {
          newExperiments = [...experiments, saved.currentExperiment!]
        }

        set({
          currentExperiment: saved.currentExperiment,
          currentTubes: safeTubes,
          connections: saved.connections || [],
          tubePositions: saved.tubePositions || [],
          experiments: newExperiments,
          showEndState: false
        })
        console.log('[loadSavedExperiment] Restored experiment:', saved.currentExperiment.name, 'experiments count:', newExperiments.length)
      }
    } catch (e) {
      console.error('[loadSavedExperiment] Failed to load saved experiment:', e)
      // 清除损坏的缓存数据
      localStorage.removeItem(CURRENT_EXPERIMENT_KEY)
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
    debouncedAutoSave(get)
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
    debouncedAutoSave(get)
  }
}))

export async function getTubeHistory(tubeId: string) {
  const histories = await loadHistories()
  return histories.get(tubeId)
}

export async function getAllTubeHistories() {
  const histories = await loadHistories()

  // 过滤掉无效的历史记录
  const validHistories = new Map<string, TubeHistory>()

  histories.forEach((history, tubeId) => {
    try {
      // 必须有 records 数组且不为空
      if (history.records && Array.isArray(history.records) && history.records.length > 0) {
        // 过滤掉无效的记录
        const validRecords = history.records.filter(r => {
          if (!r || !r.action) return false
          if (r.action === 'created') return true
          if (r.action === 'transfer_in' || r.action === 'transfer_out') {
            // 必须有有效的转移体积
            return r.transferVolume !== undefined && r.transferVolume > 0
          }
          return false
        })

        // 如果还有有效记录，更新并保留
        if (validRecords.length > 0) {
          history.records = validRecords
          // 确保 currentSubstances 是数组
          if (!Array.isArray(history.currentSubstances)) {
            history.currentSubstances = []
          }
          validHistories.set(tubeId, history)
        }
      }
    } catch (e) {
      console.warn('[getAllTubeHistories] Failed to process history for tube:', tubeId, e)
    }
  })

  return validHistories
}
