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
  // 画布：r-1 起始 200 µL，往样品里移了 100 µL，并生成一根中间产物 t-new（结算后才入仓）
  const created = tube({ id: 't-new', name: '10E1', type: 'intermediate', remainingVolume: 50 })
  return {
    id: 'exp-1',
    name: '演示工程',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status,
    tubes: [
      tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 200 }),
      tube({ id: 's-1', name: '样品1', type: 'sample', totalVolume: 0, remainingVolume: 0 }),
      created
    ],
    tubePositions: [],
    connections: [
      { id: 'c1', fromTubeId: 'r-1', toTubeId: 's-1', volume: 100, volumeUnit: 'μL' }
    ] as Experiment['connections'],
    completedAt: '2026-11-20T00:00:00.000Z',
    endStateTubes: [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 100 }), created],
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
    // 必修 1 之后只放行「本工程自己新入仓的那几根」，所以这里是 id 数组而不是 true
    expect(writerCalls).toHaveLength(1)
    expect(writerCalls[0].explicitDelete).toEqual(['t-new'])

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

/**
 * 必修 1：回退必须以**当前**仓库为基底，只把本工程扣掉的量加回去。
 *
 * 事故形状：以前拿建工程时那份 `warehouseSnapshot` 整份覆盖仓库 →
 * 建工程到回退之间别人的结算、新加的试剂全被抹掉。
 */
describe('回退：只加回本工程用掉的那部分，不动别人的（必修 1）', () => {
  function wideExperiment(): Experiment {
    const originals = Array.from({ length: 39 }, (_, i) =>
      tube({ id: `r-${i + 1}`, name: `试剂${i + 1}`, type: 'source', remainingVolume: 200 })
    )
    return {
      id: 'exp-wide',
      name: '宽工程',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
      completedAt: '2026-11-20T00:00:00.000Z',
      status: 'completed',
      tubes: [...originals, tube({ id: 's-1', name: '样品1', type: 'sample', totalVolume: 0, remainingVolume: 0 })],
      tubePositions: [],
      connections: [
        { id: 'c1', fromTubeId: 'r-1', toTubeId: 's-1', volume: 10, volumeUnit: 'μL' },
        { id: 'c2', fromTubeId: 'r-2', toTubeId: 's-1', volume: 20, volumeUnit: 'μL' },
        { id: 'c3', fromTubeId: 'r-3', toTubeId: 's-1', volume: 30, volumeUnit: 'μL' }
      ] as Experiment['connections'],
      endStateTubes: [
        tube({ id: 'r-1', name: '试剂1', type: 'source', remainingVolume: 190 }),
        tube({ id: 'r-2', name: '试剂2', type: 'source', remainingVolume: 180 }),
        tube({ id: 'r-3', name: '试剂3', type: 'source', remainingVolume: 170 })
      ],
      warehouseSnapshot: originals
    }
  }

  it('仓库 39 条 + 期间新增 2 条 → 回退后 41 条：新增的在、用掉的 3 条体积回来、其余不动', async () => {
    const experiment = wideExperiment()
    // 当前仓库：本工程结算后 r-1/2/3 少了，另有两根是这段时间别的工程加进来的
    const warehouseNow = [
      ...experiment.tubes
        .filter(item => item.type === 'source')
        .map(item =>
          item.id === 'r-1'
            ? { ...item, remainingVolume: 190 }
            : item.id === 'r-2'
              ? { ...item, remainingVolume: 180 }
              : item.id === 'r-3'
                ? { ...item, remainingVolume: 170 }
                : item
        ),
      tube({ id: 'n-1', name: '别人新加的A', type: 'source', remainingVolume: 500 }),
      tube({ id: 'n-2', name: '别人新加的B', type: 'source', remainingVolume: 600 })
    ]
    expect(warehouseNow).toHaveLength(41)

    installApi({ warehouseTubes: warehouseNow })
    seedStore('completed', warehouseNow)
    useExperimentStore.setState({ experiments: [experiment] })

    const writerCalls: Array<{ explicitDelete?: boolean | string[] }> = []
    setWarehouseWriter(async options => {
      writerCalls.push({ explicitDelete: options?.explicitDelete })
      return { ok: true }
    })

    await expect(useExperimentStore.getState().revertExperiment('exp-wide')).resolves.toBe(true)

    const after = useWarehouseStore.getState().tubes
    expect(after).toHaveLength(41)
    // 期间新增的两根还在，内容一个字没动
    expect(after.find(item => item.id === 'n-1')).toMatchObject({ name: '别人新加的A', remainingVolume: 500 })
    expect(after.find(item => item.id === 'n-2')).toMatchObject({ name: '别人新加的B', remainingVolume: 600 })
    // 本工程用掉的三根：10 + 20 + 30 → 回到 200
    expect(after.find(item => item.id === 'r-1')!.remainingVolume).toBe(200)
    expect(after.find(item => item.id === 'r-2')!.remainingVolume).toBe(200)
    expect(after.find(item => item.id === 'r-3')!.remainingVolume).toBe(200)
    // 其余 36 根原样
    for (let i = 4; i <= 39; i += 1) {
      expect(after.find(item => item.id === `r-${i}`)!.remainingVolume).toBe(200)
    }
    // 没有任何一根被删 → 不给显式删除白名单
    expect(writerCalls).toHaveLength(1)
    expect(writerCalls[0].explicitDelete).toBeUndefined()
  })

  it('只有已完成的工程才能回退：草稿 → 拒绝，一个文件都不写', async () => {
    seedStore('draft')
    const api = installApi()
    const writer = vi.fn(async () => ({ ok: true }))
    setWarehouseWriter(writer)

    await expect(useExperimentStore.getState().revertExperiment('exp-1')).resolves.toBe(false)

    expect(writer).toHaveBeenCalledTimes(0)
    expect(api.writeProject).toHaveBeenCalledTimes(0)
    expect(api.updateTube).toHaveBeenCalledTimes(0)
    const toast = api.toasts.join('\n')
    expect(toast).toContain('回退失败')
    expect(toast).toContain('只有已完成的工程才能回退')
  })

  /**
   * 必修 3：`flushWarehouseWrite` 不抛错，护栏拒绝时返回 `{ ok: false }`。
   * 以前不看返回值 → 界面说「仓库和数据库都没改」，其实文件停在结算后状态。
   */
  it('恢复仓库文件也失败（flush 返回 ok:false）→ 文案不许出现「都没有改」，要说清停在哪个状态', async () => {
    // warehouseText: null → 读不到原文，只能走 flush 兜底（第二次 flush 被拒）
    seedStore('completed', [tube({ id: 'r-1', name: 'PBS', type: 'source', remainingVolume: 100 })])
    const api = installApi({ warehouseText: null, writeProject: async () => ({ ok: false, error: '磁盘满' }) })

    let flushCount = 0
    setWarehouseWriter(async () => {
      flushCount += 1
      if (flushCount === 1) return { ok: true }
      return { ok: false, message: '条目从 2 条掉到 1 条，像是被截断，已拦下' }
    })

    await expect(useExperimentStore.getState().revertExperiment('exp-1')).resolves.toBe(false)

    expect(flushCount).toBe(2)
    const toast = api.toasts.join('\n')
    expect(toast).toContain('回退失败')
    expect(toast).not.toContain('都没有改')
    expect(toast).toContain('仓库文件可能停在回退后的状态')
    expect(toast).toContain('仓库.yml')
    expect(toast).toContain('像是被截断')
    expect(api.deleteTube).toHaveBeenCalledTimes(0)
  })
})
