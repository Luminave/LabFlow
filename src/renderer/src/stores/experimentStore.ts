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
import { MissingReagentRefError, mergeWarehouseBase, revertExperimentUsage, settleExperiment } from '@/core/settle'
import { useWarehouseStore } from './warehouseStore'
import { flushWarehouseWrite } from '../utils/warehouseWriteQueue'
import { loadWarehouseFile, restoreWarehouseContent } from '../utils/warehouseSource'
import { AgentLockError, assertProjectWritable, notifyWriteDeferred } from '../utils/agentLock'
import { blendConcentration, mergeSubstancePlaceholders } from '@/core/mix'

const CURRENT_EXPERIMENT_KEY = 'labflow_current_experiment'
const TUBE_HISTORIES_KEY = 'labflow_tube_histories'
const EXPERIMENTS_KEY = 'labflow_experiments' // 实验记录的 localStorage key

// ==================== 自动保存防抖机制 ====================
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 有改动还没真正落盘（自动保存失败时为 true）。
 * 2026-11 修：以前只看 2 秒防抖窗口，写盘失败后窗口一关就当成「已保存」，
 * 热加载接着把画布改动覆盖掉。
 */
let autoSaveDirty = false

/** 有没还没落盘的改动（防抖窗口里、或上次自动保存失败）——热加载判断用 */
export function hasPendingAutoSave(): boolean {
  return autoSaveTimer !== null || autoSaveDirty
}
const AUTO_SAVE_DELAY = 2000 // 2秒防抖

/**
 * 防抖自动保存：修改操作后 2 秒自动保存到数据库
 * 防止用户忘记点保存按钮导致数据丢失
 */
function debouncedAutoSave(get: () => ExperimentState) {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveDirty = true
  autoSaveTimer = setTimeout(async () => {
    autoSaveTimer = null
    const state = get()
    if (!state.currentExperiment) {
      autoSaveDirty = false
      return
    }

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
      autoSaveDirty = false

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
      // 落盘失败：改动仍然只在界面上——保持 dirty，热加载绝不覆盖，并且明确告诉人
      autoSaveDirty = true
      // 被 Agent 锁住：不是错误，是「暂缓写入」。提示一句、保持 dirty，别再刷「自动保存失败」
      if (e instanceof AgentLockError) {
        console.warn('[AutoSave] 本工程被 Agent 锁住，已暂缓写入：', e.message)
        notifyWriteDeferred(e.lock)
        return
      }
      console.error('[AutoSave] Failed to save experiment to DB:', e)
      notifyAutoSaveFailed((e as Error)?.message || '未知错误')
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

/** 自动保存失败的提示（轻提示即可；模块顶部不能引 React，用事件解耦） */
function notifyAutoSaveFailed(reason: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(
    new CustomEvent('labflow:global-toast', {
      detail: { text: `自动保存失败：${reason}；改动还在界面上（不会被热加载覆盖），请稍后手动保存` }
    })
  )
}

/**
 * 试管历史保存失败的提示：**不影响试剂账**，也不能让结算被报成失败。
 * 2026-11-23 真机事故：历史表绑定 undefined 失败 → 界面报「结束实验失败」，
 * 实际仓库.yml / 工程.yml 都已写好。
 */
function notifyHistorySaveFailed(reason: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(
      new CustomEvent('labflow:global-toast', {
        detail: { text: `实验已结束；试管历史保存失败（不影响试剂账）：${reason}` }
      })
    )
  } catch {
    // 提示发不出去也不能反过来把结算搞失败
  }
}


/** 通用轻提示（删工程 / 回退失败这类一次性消息用） */
function notifyToast(text: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent('labflow:global-toast', { detail: { text } }))
  } catch {
    // 提示发不出去不能反过来影响主流程
  }
}

/** 删工程成功后要说清楚「文件挪到哪了」，不然用户以为文件被硬删了 */
function notifyProjectDeleted(name: string, archiveFileName: string): void {
  if (archiveFileName) {
    notifyToast(`工程「${name}」已删除；工程文件已移到 工程/_deleted/${archiveFileName}（想恢复就把它挪回 工程/）`)
  } else {
    notifyToast(`工程「${name}」已删除（没有找到对应的工程文件）`)
  }
}

function notifyDeleteFailed(reason: string): void {
  notifyToast(`删除工程失败：${reason}`)
}

function notifyRevertFailed(reason: string): void {
  notifyToast(`回退失败：${reason}`)
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

/**
 * **只写工程正本（yml）**，不碰数据库。
 * 结束实验时用它：文件要先写成功，数据库/内存才许动。
 * 正本冲突时抛 ProjectFileConflictError，调用方决定怎么问主人。
 */
async function persistProjectFile(experiment: Experiment, options: { forceFile?: boolean } = {}): Promise<void> {
  if (!isProjectFileAvailable()) return
  const known = projectFiles.get(experiment.id)
  // forceFile：主人在「工程文件已被外部修改」对话框里选了「用界面覆盖」
  const saved = await saveProjectSource(experiment, options.forceFile ? null : known?.stat ?? null)
  projectFiles.set(experiment.id, { fileName: saved.fileName, stat: saved.stat })
}

/** 先写正本（yml），再写数据库缓存；正本冲突时抛 ProjectFileConflictError，调用方决定怎么问主人 */
async function persistExperiment(
  experiment: Experiment,
  options: { skipFile?: boolean; forceFile?: boolean } = {}
): Promise<void> {
  // 第 1 条：写入口统一的锁闸门。这里挡在**写任何文件之前**——
  // 自动保存、手动保存、另存为、回退全都走这条路，被锁时一个字节都不落地。
  await assertProjectWritable({ id: experiment.id, name: experiment.name })
  if (!options.skipFile) {
    await persistProjectFile(experiment, { forceFile: options.forceFile })
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
      // 本工程被 Agent 锁着：一个字都没写，**不许**把它当成「保存成功」记进 store
      if (e instanceof AgentLockError) {
        notifyWriteDeferred(e.lock)
        throw e
      }
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
    const experiment =
      get().experiments.find(e => e.id === id) ||
      (get().currentExperiment?.id === id ? get().currentExperiment : null)
    const name = experiment?.name || id

    // 第 1 条：删工程也要动文件（移进 _deleted/），被 Agent 锁着时一并挡住
    try {
      await assertProjectWritable({ id, name })
    } catch (error) {
      if (error instanceof AgentLockError) notifyWriteDeferred(error.lock)
      notifyDeleteFailed((error as Error).message)
      return
    }

    // 第 4 条：先把 工程/<文件名>.yml 移进 工程/_deleted/，**成功了才删数据库**。
    // 顺序反过来就会留孤儿文件（以前就是这么留的：文件还在盘上、列表里已经没了）。
    const dataRoot = typeof window !== 'undefined' ? window.electronAPI?.dataRoot : undefined
    let archivedFileName = ''
    if (dataRoot?.deleteProject) {
      try {
        const moved = await dataRoot.deleteProject({
          id,
          name: experiment?.name,
          fileName: getProjectFileInfo(id)?.fileName
        })
        if (moved.ok) {
          archivedFileName = moved.fileName
        } else if (!('reason' in moved && moved.reason === 'not-found')) {
          notifyDeleteFailed(
            `工程文件没能移进 工程/_deleted/（${'error' in moved ? moved.error : '未知原因'}），数据库没动`
          )
          return
        }
      } catch (error) {
        notifyDeleteFailed(`工程文件没能移进 工程/_deleted/（${(error as Error).message}），数据库没动`)
        return
      }
    }

    try {
      if (window.electronAPI) {
        await window.electronAPI.deleteExperiment(id)
      }
      // 文件已经移走了，缓存里那条也别留着
      projectFiles.delete(id)

      const experiments = get().experiments.filter(e => e.id !== id)
      set({ experiments })

      if (get().currentExperiment?.id === id) {
        localStorage.removeItem(CURRENT_EXPERIMENT_KEY)
        set({ currentExperiment: null, currentTubes: [], connections: [], tubePositions: [] })
      }
      notifyProjectDeleted(name, archivedFileName)
    } catch (e) {
      console.error('Failed to delete experiment:', e)
      notifyDeleteFailed((e as Error).message || '未知错误')
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

    // 硬守卫：已经结束过的工程不许再结算一次（重复点会二次扣减仓库、凭空生成中间产物）
    if (currentExperiment.status === 'completed') {
      const message = '这个工程已经结束过了，不能重复结算'
      set({ error: message })
      throw new Error(message)
    }

    // 第 1 条：本工程被 Agent 锁住 → 整笔不落地。
    // 以前 completeExperiment 根本不看锁：弹窗、按钮都还能点，账照扣、文件照写。
    try {
      await assertProjectWritable({ id: currentExperiment.id, name: currentExperiment.name })
    } catch (error) {
      if (error instanceof AgentLockError) notifyWriteDeferred(error.lock)
      set({ error: (error as Error).message })
      throw error
    }

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
    /**
     * 历史记录写失败不影响结算（原行为：只提示）。
     * 2026-11-23 修（真机：结算被历史记录拖垮）：以前这里有 alert，且若 alert 之后
     * 任何一步抛出，界面就报「结束实验失败」——可仓库.yml、工程.yml 其实已经落地了。
     * 现在：失败只记 warn + 一条轻提示，**绝不抛**，也绝不回滚已落地的数据。
     */
    const saveHistoriesOrWarn = async (): Promise<void> => {
      try {
        await saveHistories(histories)
      } catch (e) {
        console.warn('[completeExperiment] 试管历史保存失败（不影响试剂账）:', e)
        notifyHistorySaveFailed((e as Error)?.message || '未知原因')
      }
    }


    // 结算（core 纯函数：界面与 CLI 共用同一套规则）
    //
    // 2026-11-23 修（阻断：真机点「结束实验」被截断护栏拒写）：
    // 结算基底必须是**仓库全集**。以前这里用 getWarehouseTubes()，它读数据库
    // `status != 'discarded'` 的子集——39 种试剂只剩 13 种，结算结果因此把本实验
    // 没用到的 26 种整批丢掉（日志：试剂少了 26 条…拒绝写）。
    // 现在的口径：仓库.yml（真相）的顺序当骨架，内存里同 id 的条目覆盖，内存新增追加。
    const warehouseFile = await loadWarehouseFile()
    if (warehouseFile.state === 'broken') {
      const reason = warehouseFile.error || warehouseFile.warnings[0] || '内容无法解析'
      const message = `仓库正本（仓库.yml）读不懂（${reason}），不敢结算：请先修好仓库文件`
      set({ error: message })
      throw new Error(message)
    }
    const warehouseFromFile = warehouseFile.state === 'ok' && warehouseFile.snapshot ? warehouseFile.snapshot.reagents : []
    let warehouseBase = mergeWarehouseBase(warehouseFromFile, useWarehouseStore.getState().tubes)
    // 既没有文件也没有内存（首次启动的极端情况）才退回数据库
    if (warehouseBase.length === 0) warehouseBase = await getWarehouseTubes()
    const warehouseFileText = warehouseFile.state === 'ok' ? warehouseFile.text : undefined

    const settled = (() => {
      try {
        return settleExperiment(
          { experiment: { tubes: currentTubes, connections }, warehouse: warehouseBase },
          { now: () => new Date().toISOString() }
        )
      } catch (error) {
        // 第 7 条：源试管引用的试剂在仓库里找不到 → 拒绝结算，并说清是哪几管
        if (error instanceof MissingReagentRefError) {
          set({ error: error.message })
          console.warn('[completeExperiment] 结算被引用检查拒绝：', error.message)
        }
        throw error
      }
    })()
    const endStateTubes = settled.endStateTubes

    console.log('[completeExperiment] 结算：扣减', settled.usage.length, '条，新入仓', settled.created.length, '根，耗尽', settled.depleted.length, '根')

    // 先算好结算后的工程，等两个正本都写成功再落地
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

    /** 任何一步失败：记下原因、提示界面，并把异常抛给调用方（内存里什么都没改） */
    const fail = (message: string): never => {
      set({ error: message })
      throw new Error(message)
    }

    if (window.electronAPI) {
      // ① 先写 仓库.yml：等它**真的**写完（冲突时 warehouseSync 已重读文件并提示）
      // warehouseBefore 用拼好的全集：结算前「真仓库」就是仓库.yml 那份，回滚也要回到它
      const warehouseBefore = warehouseBase
      useWarehouseStore.getState().setTubes(settled.warehouseAfter)
      const flushed = await flushWarehouseWrite()
      if (!flushed.ok) {
        // 冲突时内存已被重读的文件内容替换，不再回滚；其它失败把内存恢复原样
        if (!flushed.conflict) useWarehouseStore.getState().setTubes(warehouseBefore)
        console.error('[completeExperiment] 仓库正本写失败：', flushed.message)
        fail(`仓库正本没能写成（${flushed.message || '未知原因'}），本次结算没有落地：仓库和数据库都没改`)
      }

      // ② 再写工程正本；写不成就把仓库文件恢复回去，整体不落地
      try {
        await persistProjectFile(completedExperiment)
      } catch (error) {
        useWarehouseStore.getState().setTubes(warehouseBefore)
        // 回滚要用**原文**：走护栏重写会被当成「非显式删除」拒掉，文件就停在结算后状态了
        let restored = false
        // 恢复失败的真实原因要写进提示里，不然用户只知道「没恢复」，不知道卡在哪
        let restoreFailure = ''
        if (warehouseFileText !== undefined) restored = await restoreWarehouseContent(warehouseFileText)
        if (!restored) {
          // 拿不到原文（仓库文件本来不存在 / 没有桌面正本）→ 退回「按内存重写一遍」
          // 必修 3：flushWarehouseWrite 不抛错，护栏拒绝/冲突时返回 { ok: false }，必须看返回值
          try {
            const fallback = await flushWarehouseWrite()
            restored = fallback.ok
            if (!restored) {
              restoreFailure = fallback.message || '未知原因'
              console.error('[completeExperiment] 恢复仓库文件失败：', restoreFailure)
            }
          } catch (restoreError) {
            restored = false
            restoreFailure = (restoreError as Error).message
            console.error('[completeExperiment] 恢复仓库文件异常：', restoreError)
          }
        }
        const reason = error instanceof ProjectFileConflictError ? '工程文件已被外部修改' : (error as Error).message
        console.error('[completeExperiment] 工程正本写失败：', error)
        fail(
          restored
            ? `工程正本没能写成（${reason}），本次结算没有落地：仓库和数据库都没改`
            : `工程正本没能写成（${reason}），仓库文件可能还停在结算后的状态，请检查 仓库.yml（数据库没改；恢复仓库文件也失败了：${restoreFailure || '未知原因'}）`
        )
      }

      // ③ 两个文件都成了，才动数据库和内存
      useWarehouseStore.getState().setTubes(settled.warehouseAfter)

      await saveHistoriesOrWarn()

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

      await window.electronAPI.saveExperiment(experimentToDb(completedExperiment))
    } else {
      await saveHistoriesOrWarn()
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
    if (!experiment) {
      notifyRevertFailed('找不到这个工程')
      return false
    }

    /**
     * 必修 1（守卫，2026-11-23）：只有「已完成（结算过）」的工程才谈得上回退。
     * 回退的全部依据是「结算时扣掉了哪些量」，草稿工程没有这笔账，硬跑只会把仓库改坏。
     * HistoryPage 的拦截只在「还存在更晚的已完成工程」时生效，不能依赖它。
     */
    if (experiment.status !== 'completed') {
      const label = experiment.status === 'draft' ? '草稿' : experiment.status
      notifyRevertFailed(`「${experiment.name}」现在是「${label}」状态，只有已完成的工程才能回退`)
      return false
    }

    console.log('[revertExperiment] Reverting experiment:', experimentId)

    // 第 1 条：被 Agent 锁住 → 一个文件都不写
    try {
      await assertProjectWritable({ id: experiment.id, name: experiment.name })
    } catch (error) {
      if (error instanceof AgentLockError) notifyWriteDeferred(error.lock)
      notifyRevertFailed((error as Error).message)
      return false
    }

    // 第 5 条：回退后的工程状态回到 draft（以前写的是 'reverted'，界面还当只读，等于回退没回干净）
    const revertedExperiment: Experiment = {
      ...experiment,
      status: 'draft',
      completedAt: undefined,
      endStateTubes: undefined,
      updatedAt: new Date().toISOString()
    }

    /**
     * 第 5 条：回退也要走「先算 → 两个正本文件都写成功 → 再改数据库与内存」。
     * 以前这里只改数据库和内存，`仓库.yml` / 工程 yml 一个字都没动：
     * 重启后热加载按文件为准，刚回退掉的试剂量又回来了——等于白回退。
     *
     * 必修 1（2026-11-23）：基底换成**当前**仓库，不再用 `experiment.warehouseSnapshot`。
     * 快照只在建工程那一刻记一次，拿它整份覆盖会把建工程之后的所有变化（别的工程结算、
     * 新加的试剂）一起抹掉。口径与 completeExperiment 完全一致：仓库.yml 的顺序当骨架、
     * 内存里同 id 的条目覆盖、内存新增追加；两者都空才退回数据库。
     */
    const warehouseBefore = useWarehouseStore.getState().tubes
    let warehouseBase: Tube[]
    let warehouseFileText: string | undefined
    if (window.electronAPI) {
      const read = await loadWarehouseFile()
      if (read.state === 'broken') {
        const reason = read.error || read.warnings[0] || '内容无法解析'
        notifyRevertFailed(`仓库正本（仓库.yml）读不懂（${reason}），这次回退没有落地`)
        return false
      }
      warehouseFileText = read.state === 'ok' ? read.text : undefined
      const warehouseFromFile = read.state === 'ok' && read.snapshot ? read.snapshot.reagents : []
      warehouseBase = mergeWarehouseBase(warehouseFromFile, warehouseBefore)
      if (warehouseBase.length === 0) warehouseBase = await getWarehouseTubes()
    } else {
      warehouseBase = await getWarehouseTubes()
    }

    // 只把本工程结算时扣掉的量加回去（core 纯函数，与 settleExperiment 对称）
    const reverted = revertExperimentUsage(
      { experiment, warehouse: warehouseBase },
      { now: () => new Date().toISOString() }
    )
    console.log(
      '[revertExperiment] 加回',
      reverted.restored.length,
      '根试剂，删掉',
      reverted.deleteIds.length,
      '根本工程入仓的中间产物，跳过',
      reverted.skipped.length,
      '根'
    )

    if (window.electronAPI) {
      // ① 先写 仓库.yml；只放行本工程新入仓那几根的删除，其余条目一律不许少
      useWarehouseStore.getState().setTubes(reverted.warehouseAfter)
      const flushOptions = reverted.deleteIds.length > 0 ? { explicitDelete: reverted.deleteIds } : undefined
      const flushed = await flushWarehouseWrite(flushOptions)
      if (!flushed.ok) {
        // 冲突时内存已被重读的文件内容替换（不再回滚）；其它失败恢复内存
        if (!flushed.conflict) useWarehouseStore.getState().setTubes(warehouseBefore)
        notifyRevertFailed(`仓库正本没能写成（${flushed.message || '未知原因'}），这次回退没有落地`)
        return false
      }

      // ② 再写工程正本（状态 draft）；写不成就把仓库文件恢复回去，整体不落地
      try {
        await persistProjectFile(revertedExperiment)
      } catch (error) {
        useWarehouseStore.getState().setTubes(warehouseBefore)
        let restored = false
        let restoreFailure = ''
        if (warehouseFileText !== undefined) restored = await restoreWarehouseContent(warehouseFileText)
        if (!restored) {
          /**
           * 必修 3（2026-11-23）：`flushWarehouseWrite` **不抛错**，护栏拒绝 / 内容冲突时
           * 返回 `{ ok: false }`。以前这里不看返回值就 `restored = true`，于是界面谎报
           * 「仓库和数据库都没改」，而文件其实停在回退后的状态——用户重跑会二次扣减。
           */
          try {
            const fallback = await flushWarehouseWrite()
            restored = fallback.ok
            if (!restored) {
              restoreFailure = fallback.message || '未知原因'
              console.error('[revertExperiment] 恢复仓库文件失败：', restoreFailure)
            }
          } catch (restoreError) {
            restored = false
            restoreFailure = (restoreError as Error).message
            console.error('[revertExperiment] 恢复仓库文件异常：', restoreError)
          }
        }
        const reason = error instanceof ProjectFileConflictError ? '工程文件已被外部修改' : (error as Error).message
        console.error('[revertExperiment] 工程正本写失败：', error)
        notifyRevertFailed(
          restored
            ? `工程正本没能写成（${reason}），这次回退没有落地：仓库和数据库都没改`
            : `工程正本没能写成（${reason}），仓库文件可能停在回退后的状态，请检查 仓库.yml（数据库没改；恢复仓库文件也失败了：${restoreFailure || '未知原因'}）`
        )
        return false
      }
    }

    // ③ 两个文件都成了，才动数据库与内存
    try {
      if (window.electronAPI) {
        // 先删本工程新入仓的中间产物，再把加回去的余量写回数据库
        for (const tubeId of reverted.deleteIds) {
          console.log('[revertExperiment] Deleting tube:', tubeId)
          await window.electronAPI.deleteTube(tubeId)
        }
        for (const tube of reverted.updated) {
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
        console.log('[revertExperiment] Warehouse restored: +', reverted.restored.length, 'tubes')
      } else {
        // localStorage 降级：回退后的仓库整份写回
        localStorage.setItem('labflow_tubes', JSON.stringify(reverted.warehouseAfter))
      }
    } catch (error) {
      console.error('[revertExperiment] 恢复仓库数据库失败：', error)
      notifyRevertFailed(
        `文件已经回退，但仓库数据库没写成功（${(error as Error).message}）；请不要在界面里改仓库，先重开应用让它按文件重读`
      )
      return false
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

    const newExperiments = get().experiments.map(e => e.id === experimentId ? revertedExperiment : e)
    saveExperimentsToStorage(newExperiments)

    // 同步更新 currentExperiment（如果当前正在查看这个实验）
    const currentExp = get().currentExperiment
    const updates: any = { experiments: newExperiments }
    if (currentExp && currentExp.id === experimentId) {
      updates.currentExperiment = revertedExperiment
      // 界面上那几根管也跟着回到初始状态，不然画布还显示结算后的结束态
      updates.currentTubes = revertedExperiment.tubes
      updates.showEndState = false
    }
    set(updates)

    // 数据库那份（正本是文件，这里是缓存）：写失败不算回退失败，文件已经对了
    try {
      if (window.electronAPI) await window.electronAPI.saveExperiment(experimentToDb(revertedExperiment))
    } catch (error) {
      console.warn('[revertExperiment] 数据库缓存写失败（正本已回退）：', error)
      notifyToast('实验已回退、正本文件已写好；数据库缓存没写成功，重开应用会按文件重读')
    }

    // 必修 1：只加回本工程用到的量，其余条目原样不动——跳过的必须说清楚，不能悄悄放过
    if (reverted.skipped.length > 0) {
      notifyToast(
        `回退完成，但这 ${reverted.skipped.length} 根没动：${reverted.skipped
          .map(item => `${item.name}（${item.reason}）`)
          .join('；')}`
      )
    } else if (reverted.restored.length > 0 || reverted.removedCreatedTubes.length > 0) {
      notifyToast(
        `已回退「${experiment.name}」：加回 ${reverted.restored.length} 根试剂的体积${
          reverted.removedCreatedTubes.length > 0 ? `，删掉 ${reverted.removedCreatedTubes.length} 根本工程入仓的中间产物` : ''
        }`
      )
    }

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
