/**
 * 第 4 条（删工程移文件）与第 5 条（回退要写两个正本）的 store 层测试。
 *
 * 第 4 条：以前删工程只删数据库，`工程/<名>.yml` 留在盘上 → 手工放个同名文件就「诈尸」。
 * 现在先移进 `工程/_deleted/`，移成功才删数据库，并把「挪到哪了」说给用户。
 *
 * 第 5 条：以前回退只改数据库/内存，`仓库.yml` 与工程正本一个字没动，重启按文件重读 ← 白回退。
 * 现在「先算 → 两个正本都写成功 → 再改数据库与内存」，工程状态回到 draft。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Experiment, Tube } from '../../src/shared/types'
import { useExperimentStore } from '../../src/renderer/src/stores/experimentStore'
import { useWarehouseStore } from '../../src/renderer/src/stores/warehouseStore'
import { setWarehouseWriter } from '../../src/renderer/src/utils/warehouseWriteQueue'
import { resetWarehouseFileStat } from '../../src/renderer/src/utils/warehouseSource'
import { toWarehouseYml } from '../../src/core/store/warehouseFile'

function tube(over: Partial<Tube> & Pick<Tube, 'id' | 'name' | 'type'>): Tube {
  return {
    totalVolume: 200,
    totalVolumeUnit: 'μL',
    remainingVolume: 200,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active',
    ...over
  } as Tube
}

function makeExperiment(status: Experiment['status'] = 'completed'): Experiment {
  return {
    id: 'exp-1',
    name: '演示工程',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status,
    tubes: [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 100 })],
    tubePositions: [],
    connections: [],
    completedAt: '2026-11-20T00:00:00.000Z',
    endStateTubes: [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 100 })],
    warehouseSnapshot: [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 200 })]
  }
}

interface Installed {
  order: string[]
  toasts: string[]
  deleteProject: ReturnType<typeof vi.fn>
  deleteExperiment: ReturnType<typeof vi.fn>
  writeProject: ReturnType<typeof vi.fn>
  writeWarehouse: ReturnType<typeof vi.fn>
  deleteTube: ReturnType<typeof vi.fn>
  updateTube: ReturnType<typeof vi.fn>
  saveExperiment: ReturnType<typeof vi.fn>
}

function installApi(
  options: {
    deleteProject?: () => Promise<unknown>
    writeProject?: () => Promise<unknown>
    writeWarehouse?: () => Promise<unknown>
    deleteTubeFails?: boolean
    warehouseText?: string | null
    warehouseTubes?: Tube[]
  } = {}
): Installed {
  const order: string[] = []
  const toasts: string[] = []

  const deleteProject = vi.fn(async () => {
    order.push('deleteProject')
    if (options.deleteProject) return options.deleteProject()
    return { ok: true, from: 'D:/x/工程/演示工程.yml', path: 'D:/x/工程/_deleted/20261123-013000-演示工程.yml', fileName: '20261123-013000-演示工程.yml' }
  })
  const deleteExperiment = vi.fn(async () => {
    order.push('deleteExperiment')
    return { success: true }
  })
  const writeProject = vi.fn(async () => {
    order.push('writeProject')
    if (options.writeProject) return options.writeProject()
    return { ok: true, path: 'D:/x/工程/演示工程.yml', fileName: '演示工程.yml', stat: { mtimeMs: 3, size: 120 } }
  })
  const writeWarehouse = vi.fn(async () => {
    order.push('writeWarehouse')
    if (options.writeWarehouse) return options.writeWarehouse()
    return { ok: true, path: 'D:/x/仓库.yml', stat: { mtimeMs: 4, size: 200 } }
  })
  const deleteTube = vi.fn(async () => {
    order.push('deleteTube')
    if (options.deleteTubeFails) throw new Error('数据库锁住了')
    return { success: true }
  })
  const updateTube = vi.fn(async () => {
    order.push('updateTube')
    return { success: true }
  })
  const saveExperiment = vi.fn(async () => {
    order.push('saveExperiment')
    return { success: true }
  })

  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear()
  }

  const globalAny = globalThis as Record<string, unknown>
  if (typeof globalAny.CustomEvent !== 'function') {
    globalAny.CustomEvent = class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    }
  }

  const warehouseTubes = options.warehouseTubes ?? [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 100 })]
  const rows = warehouseTubes.map(item => ({
    id: item.id,
    name: item.name,
    type: item.type,
    total_volume: item.totalVolume,
    total_volume_unit: item.totalVolumeUnit,
    remaining_volume: item.remainingVolume,
    remaining_volume_unit: item.remainingVolumeUnit,
    substances: JSON.stringify(item.substances ?? []),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    status: item.status
  }))
  const warehouseText =
    options.warehouseText === undefined
      ? toWarehouseYml({ groups: [], reagents: warehouseTubes })
      : options.warehouseText

  ;(globalAny as any).window = {
    electronAPI: {
      getAgentLock: async () => null,
      getTubes: async () => rows,
      updateTube,
      addTube: async () => ({ success: true }),
      deleteTube,
      saveExperiment,
      deleteExperiment,
      getExperiments: async () => [],
      getTubeHistories: async () => [],
      saveTubeHistories: async () => ({ success: true }),
      dataRoot: {
        deleteProject,
        writeProject,
        writeWarehouse,
        readWarehouse: async () =>
          warehouseText === null
            ? { ok: false, reason: 'not-found' }
            : { ok: true, path: 'D:/x/仓库.yml', content: warehouseText, stat: { mtimeMs: 1, size: warehouseText.length } }
      }
    },
    dispatchEvent: (event: any) => {
      const text = event?.detail?.text
      if (typeof text === 'string') toasts.push(text)
      return true
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }

  return { order, toasts, deleteProject, deleteExperiment, writeProject, writeWarehouse, deleteTube, updateTube, saveExperiment }
}

function seedStore(status: Experiment['status'] = 'completed', warehouseTubes?: Tube[]): Experiment {
  const experiment = makeExperiment(status)
  useExperimentStore.setState({
    currentExperiment: experiment,
    currentTubes: experiment.tubes,
    connections: experiment.connections,
    tubePositions: [],
    experiments: [experiment],
    error: null
  })
  useWarehouseStore.setState({ tubes: warehouseTubes ?? experiment.warehouseSnapshot! })
  return experiment
}

beforeEach(() => {
  resetWarehouseFileStat()
  setWarehouseWriter(null)
})

describe('删工程：先移文件、再删数据库（第 4 条）', () => {
  it('删成功 → 文件先归档、数据库后删，提示说清挪到 工程/_deleted/ 哪一份', async () => {
    seedStore('draft')
    const api = installApi()

    await useExperimentStore.getState().deleteExperiment('exp-1')

    expect(api.deleteProject).toHaveBeenCalledTimes(1)
    expect(api.deleteProject.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'exp-1', name: '演示工程' })
    )
    expect(api.deleteExperiment).toHaveBeenCalledTimes(1)
    // 顺序：先移文件，后删库
    expect(api.order).toEqual(['deleteProject', 'deleteExperiment'])
    expect(useExperimentStore.getState().experiments).toHaveLength(0)
    const toast = api.toasts.join('\n')
    expect(toast).toContain('工程「演示工程」已删除')
    expect(toast).toContain('工程/_deleted/20261123-013000-演示工程.yml')
    expect(toast).toContain('挪回 工程/')
  })

  it('文件移不动 → 数据库一个都没删，并说清「数据库没动」', async () => {
    seedStore('draft')
    const api = installApi({ deleteProject: async () => ({ ok: false, error: '磁盘只读' }) })

    await useExperimentStore.getState().deleteExperiment('exp-1')

    expect(api.deleteExperiment).toHaveBeenCalledTimes(0)
    expect(useExperimentStore.getState().experiments).toHaveLength(1)
    const toast = api.toasts.join('\n')
    expect(toast).toContain('删除工程失败')
    expect(toast).toContain('磁盘只读')
    expect(toast).toContain('数据库没动')
  })

  it('磁盘上本来就没有这个文件（not-found）→ 不算失败，数据库照删', async () => {
    seedStore('draft')
    const api = installApi({ deleteProject: async () => ({ ok: false, reason: 'not-found' }) })

    await useExperimentStore.getState().deleteExperiment('exp-1')

    expect(api.deleteExperiment).toHaveBeenCalledTimes(1)
    expect(useExperimentStore.getState().experiments).toHaveLength(0)
    expect(api.toasts.join('\n')).toContain('没有找到对应的工程文件')
  })
})

describe('回退：两个正本都写、状态回到 draft（第 5 条）', () => {
  it('成功 → 工程正本写的是 status: draft；仓库文件写了一次；之后才动数据库', async () => {
    // 结算后的仓库：r-1 只剩 100，另外多了结算入仓的中间产物 t-new
    const settledExtra = tube({ id: 't-new', name: '10E1', type: 'intermediate', remainingVolume: 50 })
    const settledWarehouse = [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 100 }), settledExtra]
    const experiment = seedStore('completed', settledWarehouse)
    const api = installApi({ warehouseTubes: settledWarehouse })
    const writerCalls: Array<{ explicitDelete?: boolean | string[] }> = []
    setWarehouseWriter(async options => {
      writerCalls.push({ explicitDelete: options?.explicitDelete })
      return { ok: true }
    })

    await expect(useExperimentStore.getState().revertExperiment('exp-1')).resolves.toBe(true)

    // 工程正本：内容是 draft、且写完才动数据库
    expect(api.writeProject).toHaveBeenCalledTimes(1)
    const written = api.writeProject.mock.calls[0][0] as { content: string }
    expect(written.content).toContain('status: draft')
    expect(written.content).not.toContain('status: completed')
    expect(api.order[0]).toBe('writeProject')

    // 仓库正本：写了一次，且是「显式删除」形态（回退必然让条目变少，不能撞截断护栏）
    expect(writerCalls).toHaveLength(1)
    expect(writerCalls[0].explicitDelete).toBe(true)

    // 数据库在文件之后：删掉结算新增的中间产物，并按快照写回余量
    expect(api.deleteTube).toHaveBeenCalledTimes(1)
    expect(api.deleteTube).toHaveBeenCalledWith('t-new')
    expect(api.updateTube).toHaveBeenCalled()
    expect(api.order.indexOf('writeProject')).toBeLessThan(api.order.indexOf('deleteTube'))

    // 内存与状态
    const state = useExperimentStore.getState()
    expect(state.experiments[0].status).toBe('draft')
    expect(state.currentExperiment?.status).toBe('draft')
    expect(state.currentExperiment?.completedAt).toBeUndefined()
    expect(state.currentExperiment?.endStateTubes).toBeUndefined()
    expect(useWarehouseStore.getState().tubes.find(item => item.id === 'r-1')!.remainingVolume).toBe(200)
    // 顺带把 completed 那条历史清掉
    expect(experiment.completedAt).toBe('2026-11-20T00:00:00.000Z')
  })

  it('工程正本写失败 → 仓库文件恢复回原文、数据库一个字没改、返回 false', async () => {
    seedStore('completed', [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 100 })])
    const api = installApi({ writeProject: async () => ({ ok: false, error: '磁盘满' }) })
    const writerCalls: unknown[] = []
    setWarehouseWriter(async () => {
      writerCalls.push('flush')
      return { ok: true }
    })

    await expect(useExperimentStore.getState().revertExperiment('exp-1')).resolves.toBe(false)

    // 第一次写回退结果，第二次把仓库恢复成回退前（restoreWarehouseContent 走 writeWarehouse）
    expect(writerCalls).toHaveLength(1)
    expect(api.writeWarehouse).toHaveBeenCalledTimes(1)
    expect(api.deleteTube).toHaveBeenCalledTimes(0)
    expect(api.updateTube).toHaveBeenCalledTimes(0)
    expect(api.saveExperiment).toHaveBeenCalledTimes(0)
    expect(useExperimentStore.getState().experiments[0].status).toBe('completed')
    expect(useWarehouseStore.getState().tubes.find(item => item.id === 'r-1')!.remainingVolume).toBe(100)
    const toast = api.toasts.join('\n')
    expect(toast).toContain('回退失败')
    expect(toast).toContain('没有落地')
  })

  it('仓库文件写失败 → 工程正本都不写，返回 false', async () => {
    seedStore('completed')
    const api = installApi()
    setWarehouseWriter(async () => ({ ok: false, message: '磁盘只读' }))

    await expect(useExperimentStore.getState().revertExperiment('exp-1')).resolves.toBe(false)

    expect(api.writeProject).toHaveBeenCalledTimes(0)
    expect(api.deleteTube).toHaveBeenCalledTimes(0)
    expect(api.toasts.join('\n')).toContain('磁盘只读')
    expect(useExperimentStore.getState().experiments[0].status).toBe('completed')
  })

  it('仓库正本读不懂（broken）→ 不覆盖、直接拒绝回退', async () => {
    seedStore('completed')
    const api = installApi({ warehouseText: '这不是: [合法的 yaml' })
    setWarehouseWriter(async () => ({ ok: true }))

    await expect(useExperimentStore.getState().revertExperiment('exp-1')).resolves.toBe(false)

    expect(api.writeProject).toHaveBeenCalledTimes(0)
    expect(api.toasts.join('\n')).toContain('读不懂')
  })
})
