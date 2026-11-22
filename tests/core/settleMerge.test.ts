/**
 * 回归：结算基底必须是**仓库全集**，不是「本实验用到的试管」。
 *
 * 事故（2026-11-23 真机）：工程只用到 39 种试剂里的 13 种，界面把数据库
 * `status != 'discarded'` 的 13 条当仓库全集传给 settleExperiment，
 * 结算结果里那 26 种没参与的试剂就整批消失了 → 截断护栏「试剂少了 26 条…拒绝写」。
 *
 * 这里锁两件事：
 * 1) core 的合并语义：没碰到的条目一条不动、顺序不变、对象引用不变；新入仓追加在末尾。
 * 2) 界面调用方真的把「仓库.yml 全集 + 内存」拼成基底再结算，且已 completed 仍然被拒。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mergeWarehouseBase, settleExperiment } from '../../src/core/settle'
import { toWarehouseYml } from '../../src/core/store/warehouseFile'
import { useExperimentStore } from '../../src/renderer/src/stores/experimentStore'
import { useWarehouseStore } from '../../src/renderer/src/stores/warehouseStore'
import { resetWarehouseFileStat } from '../../src/renderer/src/utils/warehouseSource'
import { resetWarehouseReagentsCache } from '../../src/renderer/src/utils/projectSource'
import { setWarehouseWriter } from '../../src/renderer/src/utils/warehouseWriteQueue'
import type { Experiment, Tube } from '../../src/shared/types'

const USED_COUNT = 13
const SPARE_COUNT = 26
const TOTAL = USED_COUNT + SPARE_COUNT // 39，与真机仓库一致

function makeTube(partial: Partial<Tube> & { id: string; name: string; type: Tube['type'] }): Tube {
  return {
    totalVolume: 200,
    totalVolumeUnit: 'μL',
    remainingVolume: 200,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active',
    ...partial
  }
}

/** 本实验用到的 13 种（源试管），其中 used-01 只剩 20 µL，会被扣到耗尽 */
function usedReagents(): Tube[] {
  return Array.from({ length: USED_COUNT }, (_, i) => {
    const index = i + 1
    const id = `used-${String(index).padStart(2, '0')}`
    return makeTube({
      id,
      name: `试剂${id}`,
      type: 'source',
      remainingVolume: index === 1 ? 20 : 100,
      lotNumber: `LOT-${index}`,
      openedAt: '2026-11-01'
    })
  })
}

/** 本实验没用到的 26 种（纳米球、旧探针…），结算后必须原样还在 */
function spareReagents(): Tube[] {
  const names = ['纳米球A', '纳米球B', '纳米球C', 'H1', 'H2', '旧探针P1', '旧探针P2']
  return Array.from({ length: SPARE_COUNT }, (_, i) => {
    const index = i + 1
    return makeTube({
      id: `spare-${String(index).padStart(2, '0')}`,
      name: `${names[i % names.length]}-${index}`,
      type: 'source',
      remainingVolume: 50 + index,
      lotNumber: `OLD-${index}`,
      openedAt: '2026-09-20',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z'
    })
  })
}

function fullWarehouse(): Tube[] {
  // 顺序故意打散：没用到的夹在用到的中间，验证「顺序不变」
  const used = usedReagents()
  const spare = spareReagents()
  return [...spare.slice(0, 13), ...used.slice(0, 7), ...spare.slice(13), ...used.slice(7)]
}

/** 画布：13 根源试管 + 13 根新中间产物，一根源试管扣到 0 */
function makeExperiment(warehouse: Tube[]): Pick<Experiment, 'tubes' | 'connections'> {
  const sources = warehouse.filter(tube => tube.id.startsWith('used-'))
  const intermediates = sources.map((source, i) =>
    makeTube({
      id: `mid-${i + 1}`,
      name: `中间产物${i + 1}`,
      type: 'intermediate',
      totalVolume: 0,
      remainingVolume: 0
    })
  )
  const connections = sources.map((source, i) => ({
    id: `c${i + 1}`,
    fromTubeId: source.id,
    toTubeId: `mid-${i + 1}`,
    volume: i === 0 ? 20 : 10,
    volumeUnit: 'μL' as const
  }))
  return { tubes: [...sources, ...intermediates], connections }
}

describe('结算基底：仓库全集 + 只改用到的（settleMerge）', () => {
  it('39 条仓库只用 13 条 → 结算后 39 + 新入仓 13，没碰的 26 条 deep-equal 原样', () => {
    const warehouse = fullWarehouse()
    const snapshotBefore = JSON.parse(JSON.stringify(warehouse))
    const experiment = makeExperiment(warehouse)

    const settled = settleExperiment({ experiment, warehouse })

    expect(warehouse).toHaveLength(TOTAL)
    expect(settled.createdTubes).toHaveLength(13)
    expect(settled.warehouseAfter).toHaveLength(TOTAL + 13)

    // 前 39 条：顺序不变、id 不变
    expect(settled.warehouseAfter.slice(0, TOTAL).map(t => t.id)).toEqual(warehouse.map(t => t.id))

    // 没参与的 26 条：内容逐字段一致，且还是原来那个对象（说明真的没重建）
    const spareBefore = snapshotBefore.filter((t: Tube) => t.id.startsWith('spare-'))
    const spareAfter = settled.warehouseAfter.filter(t => t.id.startsWith('spare-'))
    expect(spareAfter).toHaveLength(SPARE_COUNT)
    expect(spareAfter).toEqual(spareBefore)
    for (const spareId of spareBefore.map((t: Tube) => t.id)) {
      const original = warehouse.find(t => t.id === spareId)
      expect(settled.warehouseAfter.find(t => t.id === spareId)).toBe(original)
    }

    // 新入仓追加在末尾
    expect(settled.warehouseAfter.slice(TOTAL).map(t => t.id)).toEqual(
      Array.from({ length: 13 }, (_, i) => `mid-${i + 1}`)
    )
    // 传入的仓库本身没被改（纯函数）
    expect(warehouse).toEqual(snapshotBefore)
  })

  it('用到的 13 条照旧扣减；扣到 0 → depleted；usage 只记这 13 条', () => {
    const warehouse = fullWarehouse()
    const settled = settleExperiment({ experiment: makeExperiment(warehouse), warehouse })

    expect(settled.usage).toHaveLength(USED_COUNT)
    expect(settled.usage.every(item => item.reagentId.startsWith('used-'))).toBe(true)

    const first = settled.warehouseAfter.find(t => t.id === 'used-01')!
    expect(first.remainingVolume).toBe(0)
    expect(first.status).toBe('depleted')
    expect(settled.depleted).toEqual(['used-01'])

    const second = settled.warehouseAfter.find(t => t.id === 'used-02')!
    expect(second.remainingVolume).toBe(90)
    expect(second.status).toBe('active')

    // 批号/开封日本来就在，扣减后也不能丢
    expect(first.lotNumber).toBe('LOT-1')
    expect(first.openedAt).toBe('2026-11-01')
  })

  it('mergeWarehouseBase：文件顺序为骨架，内存同 id 覆盖，内存新增追加', () => {
    const file = fullWarehouse()
    const memory = [
      // 改过余量的 used-02
      { ...file.find(t => t.id === 'used-02')!, remainingVolume: 42 },
      // 文件里还没有的新增（还没落盘）
      makeTube({ id: 'mem-new', name: '内存新增', type: 'source' })
    ]
    const merged = mergeWarehouseBase(file, memory)

    expect(merged.map(t => t.id).slice(0, TOTAL + 1)).toEqual([...file.map(t => t.id), 'mem-new'])
    expect(merged.find(t => t.id === 'used-02')!.remainingVolume).toBe(42)
    // 没被覆盖的条目原样引用
    expect(merged.find(t => t.id === 'spare-01')).toBe(file.find(t => t.id === 'spare-01'))
  })
})

// ==================== 界面调用方：真的拿仓库全集当基底 ====================

interface Harness {
  writeWarehouse: ReturnType<typeof vi.fn>
  updateTube: ReturnType<typeof vi.fn>
  addTube: ReturnType<typeof vi.fn>
  saveExperiment: ReturnType<typeof vi.fn>
}

/** 数据库只给 13 条（模拟 status != 'discarded' 过滤），仓库.yml 里是 39 条 */
function installApi(fileReagents: Tube[], dbReagents: Tube[]): Harness {
  const toRow = (tube: Tube) => ({
    id: tube.id,
    name: tube.name,
    type: tube.type,
    total_volume: tube.totalVolume,
    total_volume_unit: tube.totalVolumeUnit,
    remaining_volume: tube.remainingVolume,
    remaining_volume_unit: tube.remainingVolumeUnit,
    substances: JSON.stringify(tube.substances ?? []),
    created_at: tube.createdAt,
    updated_at: tube.updatedAt,
    status: tube.status
  })

  const warehouseText = toWarehouseYml({ groups: [], reagents: fileReagents })
  const writeWarehouse = vi.fn(async () => ({ ok: true, path: 'D:/x/仓库.yml', stat: { mtimeMs: 10, size: 1000 } }))
  const updateTube = vi.fn(async () => ({ success: true }))
  const addTube = vi.fn(async () => ({ success: true }))
  const saveExperiment = vi.fn(async () => ({ success: true }))

  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear()
  }

  ;(globalThis as any).window = {
    electronAPI: {
      getTubes: async () => dbReagents.map(toRow),
      updateTube,
      addTube,
      deleteTube: async () => ({ success: true }),
      saveExperiment,
      getExperiments: async () => [],
      getTubeHistories: async () => [],
      saveTubeHistories: async () => ({ success: true }),
      dataRoot: {
        readWarehouse: async () => ({ ok: true, path: 'D:/x/仓库.yml', content: warehouseText, stat: { mtimeMs: 9, size: 1000 } }),
        writeWarehouse,
        writeProject: async () => ({
          ok: true,
          path: 'D:/x/工程/test.yml',
          fileName: 'test.yml',
          stat: { mtimeMs: 5, size: 100 }
        })
      }
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {}
  }

  return { writeWarehouse, updateTube, addTube, saveExperiment }
}

function seedStore(experiment: Pick<Experiment, 'tubes' | 'connections'>, memory: Tube[], status: Experiment['status'] = 'draft'): void {
  const full: Experiment = {
    id: 'exp-merge',
    name: '结算合并测试',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status,
    tubes: experiment.tubes,
    tubePositions: [],
    connections: experiment.connections
  }
  useExperimentStore.setState({
    currentExperiment: full,
    currentTubes: full.tubes,
    connections: full.connections,
    tubePositions: [],
    experiments: [full],
    error: null
  })
  // 内存里的仓库是被污染过的子集（13 条）
  useWarehouseStore.setState({ tubes: memory })
}

describe('结束实验：基底取仓库.yml 全集（回归 2026-11-23）', () => {
  beforeEach(() => {
    setWarehouseWriter(null)
    resetWarehouseFileStat()
    resetWarehouseReagentsCache()
  })

  it('数据库只有 13 条、仓库.yml 有 39 条 → 写盘时是 39 + 新入仓，26 条没丢', async () => {
    const file = fullWarehouse()
    const db = usedReagents()
    const experiment = makeExperiment(file)
    const api = installApi(file, db)
    seedStore(experiment, db)

    // 写盘时抓内存快照：这就是真的会落进 仓库.yml 的内容
    const written: Tube[][] = []
    setWarehouseWriter(async () => {
      written.push(useWarehouseStore.getState().tubes.map(t => ({ ...t })))
      return { ok: true }
    })

    await useExperimentStore.getState().completeExperiment()

    expect(written).toHaveLength(1)
    expect(written[0]).toHaveLength(TOTAL + 13)
    expect(written[0].filter(t => t.id.startsWith('spare-'))).toHaveLength(SPARE_COUNT)
    expect(written[0].find(t => t.name.startsWith('纳米球'))).toBeTruthy()

    // DB 只更新用到的那些，没碰过的试剂一个都不写
    expect(api.updateTube).toHaveBeenCalledTimes(USED_COUNT)
    expect(api.updateTube.mock.calls.every((call: any[]) => call[0].id.startsWith('used-'))).toBe(true)
    expect(api.addTube).toHaveBeenCalledTimes(13)
    expect(useExperimentStore.getState().currentExperiment?.status).toBe('completed')
  })

  it('同一个工程已 completed 再结算 → 拒绝，不再写仓库、不再扣减', async () => {
    const file = fullWarehouse()
    const db = usedReagents()
    const experiment = makeExperiment(file)
    const api = installApi(file, db)
    seedStore(experiment, db, 'completed')

    const written: Tube[][] = []
    setWarehouseWriter(async () => {
      written.push(useWarehouseStore.getState().tubes.map(t => ({ ...t })))
      return { ok: true }
    })

    await expect(useExperimentStore.getState().completeExperiment()).rejects.toThrow(/已经结束过/)

    expect(written).toHaveLength(0)
    expect(api.updateTube).not.toHaveBeenCalled()
    expect(api.writeWarehouse).not.toHaveBeenCalled()
    expect(useWarehouseStore.getState().tubes).toHaveLength(USED_COUNT)
  })
})
