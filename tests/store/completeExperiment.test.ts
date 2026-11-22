/**
 * 缺陷 4：结束实验的落地顺序
 * - 先算结算结果 → 仓库.yml 与工程正本都写成功 → 才改 DB 与内存
 * - 任一步失败：整体不落地、内存回滚、提示原因（异常抛给界面）
 * - 已完成（status: 'completed'）的工程再次结算：硬拒，不许二次扣减
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Experiment, Tube } from '../../src/shared/types'
import { useExperimentStore } from '../../src/renderer/src/stores/experimentStore'
import { useWarehouseStore } from '../../src/renderer/src/stores/warehouseStore'
import { setWarehouseWriter } from '../../src/renderer/src/utils/warehouseWriteQueue'

function sourceTube(): Tube {
  return {
    id: 'r-1',
    name: 'PBS',
    type: 'source',
    totalVolume: 200,
    totalVolumeUnit: 'μL',
    remainingVolume: 200,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  }
}

function sampleTube(): Tube {
  return {
    id: 's-1',
    name: '样品1',
    type: 'sample',
    totalVolume: 0,
    totalVolumeUnit: 'μL',
    remainingVolume: 0,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  }
}

function makeExperiment(status: Experiment['status'] = 'draft'): Experiment {
  return {
    id: 'exp-1',
    name: '结算测试',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status,
    tubes: [sourceTube(), sampleTube()],
    tubePositions: [],
    connections: [
      { id: 'c1', fromTubeId: 'r-1', toTubeId: 's-1', volume: 100, volumeUnit: 'μL' }
    ]
  }
}

function dbRow(): Record<string, unknown> {
  return {
    id: 'r-1',
    name: 'PBS',
    type: 'source',
    total_volume: 200,
    total_volume_unit: 'μL',
    remaining_volume: 200,
    remaining_volume_unit: 'μL',
    substances: '[]',
    created_at: '2026-11-18T00:00:00.000Z',
    updated_at: '2026-11-18T00:00:00.000Z',
    status: 'active'
  }
}

interface Installed {
  order: string[]
  updateTube: ReturnType<typeof vi.fn>
  addTube: ReturnType<typeof vi.fn>
  saveExperiment: ReturnType<typeof vi.fn>
  writeProject: ReturnType<typeof vi.fn>
  saveTubeHistories: ReturnType<typeof vi.fn>
  toasts: string[]
}

function installApi(
  overrides: { writeProject?: () => Promise<unknown>; dbWriteFails?: boolean; historiesFail?: boolean } = {}
): Installed {
  const order: string[] = []
  const toasts: string[] = []
  const updateTube = vi.fn(async () => {
    order.push('updateTube')
    if (overrides.dbWriteFails) throw new Error('数据库写失败')
    return { success: true }
  })
  const addTube = vi.fn(async () => {
    order.push('addTube')
    return { success: true }
  })
  const saveExperiment = vi.fn(async () => {
    order.push('saveExperiment')
    return { success: true }
  })
  const saveTubeHistories = vi.fn(async () => {
    order.push('saveTubeHistories')
    return overrides.historiesFail
      ? { success: false, error: 'Wrong API use : tried to bind a value of an unknown type (undefined).' }
      : { success: true }
  })
  const writeProject = vi.fn(async () => {
    order.push('writeProject')
    if (overrides.writeProject) return overrides.writeProject()
    return { ok: true, path: 'D:/x/工程/结算测试.yml', fileName: '结算测试.yml', stat: { mtimeMs: 5, size: 100 } }
  })

  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear()
  }

  ;(globalThis as any).window = {
    electronAPI: {
      getTubes: async () => [dbRow()],
      updateTube,
      addTube,
      deleteTube: async () => ({ success: true }),
      saveExperiment,
      getExperiments: async () => [],
      getTubeHistories: async () => [],
      saveTubeHistories,
      dataRoot: { writeProject, readWarehouse: async () => ({ ok: false, reason: 'not-found' }) }
    },
    dispatchEvent: (event: any) => {
      const text = event?.detail?.text
      if (typeof text === 'string') toasts.push(text)
      return true
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }

  return { order, updateTube, addTube, saveExperiment, writeProject, saveTubeHistories, toasts }
}

function seedStore(status: Experiment['status'] = 'draft'): void {
  const experiment = makeExperiment(status)
  useExperimentStore.setState({
    currentExperiment: experiment,
    currentTubes: experiment.tubes,
    connections: experiment.connections,
    tubePositions: [],
    experiments: [experiment],
    error: null
  })
  useWarehouseStore.setState({ tubes: [sourceTube()] })
}

beforeEach(() => {
  setWarehouseWriter(null)
  seedStore()
})

describe('结束实验：先写文件、后改库（缺陷 4）', () => {
  it('仓库正本写失败 → 数据库一个字没改、仓库内存回滚、有错误提示', async () => {
    const api = installApi()
    setWarehouseWriter(async () => ({ ok: false, message: '磁盘只读' }))

    await expect(useExperimentStore.getState().completeExperiment()).rejects.toThrow(/仓库正本没能写成/)

    expect(api.updateTube).not.toHaveBeenCalled()
    expect(api.addTube).not.toHaveBeenCalled()
    expect(api.saveExperiment).not.toHaveBeenCalled()
    expect(api.writeProject).not.toHaveBeenCalled()
    // 仓库内存回到结算前
    expect(useWarehouseStore.getState().tubes.map(t => [t.id, t.remainingVolume])).toEqual([['r-1', 200]])
    const error = useExperimentStore.getState().error as unknown as string
    expect(error).toContain('磁盘只读')
    // 工程还是草稿，没有凭空变成 completed
    expect(useExperimentStore.getState().currentExperiment?.status).toBe('draft')
    expect(useExperimentStore.getState().currentExperiment?.completedAt).toBeUndefined()
  })

  it('工程正本写失败 → 仓库文件恢复回去、数据库仍然没改', async () => {
    const api = installApi({ writeProject: async () => ({ ok: false, error: '磁盘满' }) })
    const writerCalls: Array<{ ok: boolean }> = []
    setWarehouseWriter(async () => {
      writerCalls.push({ ok: true })
      return { ok: true }
    })

    await expect(useExperimentStore.getState().completeExperiment()).rejects.toThrow(/工程正本没能写成/)

    expect(api.updateTube).not.toHaveBeenCalled()
    expect(api.saveExperiment).not.toHaveBeenCalled()
    // 第一次写结算后的仓库，第二次把仓库恢复回结算前
    expect(writerCalls).toHaveLength(2)
    expect(useWarehouseStore.getState().tubes.map(t => [t.id, t.remainingVolume])).toEqual([['r-1', 200]])
    const error = useExperimentStore.getState().error as unknown as string
    expect(error).toContain('磁盘满')
    expect(error).toContain('本次结算没有落地')
  })

  it('两个文件都写成功后才动数据库（顺序可验证）', async () => {
    const api = installApi()
    setWarehouseWriter(async () => ({ ok: true }))

    await useExperimentStore.getState().completeExperiment()

    expect(api.writeProject).toHaveBeenCalledTimes(1)
    expect(api.order[0]).toBe('writeProject')
    expect(api.order).toContain('updateTube')
    expect(useExperimentStore.getState().currentExperiment?.status).toBe('completed')
    expect(useWarehouseStore.getState().tubes.find(t => t.id === 'r-1')!.remainingVolume).toBe(100)
  })
  it('仓库写盘通道没挂上（桌面版）→ 也拒绝落地，不假装写过', async () => {
    const api = installApi()
    // 故意不注册 writer：桌面版里这等于「仓库.yml 没写」
    await expect(useExperimentStore.getState().completeExperiment()).rejects.toThrow(/仓库正本没能写成/)

    expect(api.updateTube).not.toHaveBeenCalled()
    expect(api.saveExperiment).not.toHaveBeenCalled()
    expect(useExperimentStore.getState().currentExperiment?.status).toBe('draft')
  })
})

describe('结束实验：重复结算被拒（缺陷 4）', () => {
  it('已经是 completed → 直接拒，不写文件、不扣仓库', async () => {
    seedStore('completed')
    const api = installApi()
    const writer = vi.fn(async () => ({ ok: true }))
    setWarehouseWriter(writer)

    await expect(useExperimentStore.getState().completeExperiment()).rejects.toThrow(/已经结束过/)

    expect(writer).not.toHaveBeenCalled()
    expect(api.updateTube).not.toHaveBeenCalled()
    expect(api.writeProject).not.toHaveBeenCalled()
    expect(useWarehouseStore.getState().tubes.find(t => t.id === 'r-1')!.remainingVolume).toBe(200)
  })
})

/**
 * 回归（2026-11-23 真机）：试管历史写失败把整次结算报成「结束实验失败」，
 * 可仓库.yml 和工程.yml 其实都已经落地。历史是旁支账本，不能反噬主账。
 */
describe('结束实验：历史保存失败不算结算失败（真机回归）', () => {
  it('saveTubeHistories 返回 {success:false} → 结算仍成功、仓库已扣、只给一条轻提示', async () => {
    const api = installApi({ historiesFail: true })
    setWarehouseWriter(async () => ({ ok: true }))

    // 不抛错：界面不会走「结束实验失败」的 catch
    await expect(useExperimentStore.getState().completeExperiment()).resolves.toBeUndefined()

    // 主账落地：工程 completed + 结束状态在 + 仓库扣减生效
    const state = useExperimentStore.getState()
    expect(state.currentExperiment?.status).toBe('completed')
    expect(state.currentExperiment?.endStateTubes).toBeDefined()
    expect(useWarehouseStore.getState().tubes.find(t => t.id === 'r-1')!.remainingVolume).toBe(100)
    expect(state.error).toBeNull()

    // 数据库该写的照写（历史失败不拦后面的步骤）
    expect(api.saveTubeHistories).toHaveBeenCalled()
    expect(api.updateTube).toHaveBeenCalled()
    expect(api.saveExperiment).toHaveBeenCalled()

    // 提示正好一条，且说明「不影响试剂账」
    const historyToasts = api.toasts.filter(t => t.includes('试管历史保存失败'))
    expect(historyToasts).toHaveLength(1)
    expect(historyToasts[0]).toContain('实验已结束')
    expect(historyToasts[0]).toContain('不影响试剂账')
  })
})
