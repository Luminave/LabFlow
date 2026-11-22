import { describe, expect, it } from 'vitest'

import { settleExperiment } from '../../src/core/settle'
import type { Experiment, Tube } from '../../src/shared/types'

/** 造一根试管（默认 µL） */
function makeTube(partial: Partial<Tube> & { id: string; name: string; type: Tube['type'] }): Tube {
  return {
    totalVolume: 100,
    totalVolumeUnit: 'μL',
    remainingVolume: 100,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active',
    ...partial
  }
}

function makeExperiment(tubes: Tube[], connections: Experiment['connections']): Pick<Experiment, 'tubes' | 'connections'> {
  return { tubes, connections }
}

describe('结算（settleExperiment）', () => {
  it('1M Mg 扣 15 µL：仓库 100 → 85，usage 记一条', () => {
    const mg = makeTube({ id: 'mg', name: '1M Mg', type: 'source', remainingVolume: 100 })
    const target = makeTube({ id: 't5', name: '260910-Tube 5', type: 'intermediate' })
    const result = settleExperiment({
      experiment: makeExperiment(
        [mg, target],
        [
          {
            id: 'c1',
            fromTubeId: 'mg',
            toTubeId: 't5',
            volume: 15,
            volumeUnit: 'μL'
          }
        ]
      ),
      warehouse: [mg]
    })

    const mgAfter = result.warehouseAfter.find(t => t.id === 'mg')!
    expect(mgAfter.remainingVolume).toBe(85)
    expect(result.usage).toEqual([
      expect.objectContaining({ reagentId: 'mg', name: '1M Mg', used: 15, before: 100, after: 85, depleted: false })
    ])
    expect(result.created.map(c => c.name)).toContain('260910-Tube 5')
  })

  it('新中间产物入仓，保留画布上的 id 和首次移入体积', () => {
    const src = makeTube({ id: 'e1', name: 'E1', type: 'source', remainingVolume: 20 })
    const mid = makeTube({ id: 'mid-e1', name: '10E1', type: 'intermediate', totalVolume: 0, remainingVolume: 0 })
    const result = settleExperiment({
      experiment: makeExperiment(
        [src, mid],
        [{ id: 'c1', fromTubeId: 'e1', toTubeId: 'mid-e1', volume: 5, volumeUnit: 'μL' }]
      ),
      warehouse: [src]
    })

    const created = result.created.find(c => c.tubeId === 'mid-e1')!
    expect(created).toEqual({
      tubeId: 'mid-e1',
      name: '10E1',
      totalVolume: 5,
      unit: 'μL',
      remainingVolume: 5,
      substances: []
    })
    expect(result.warehouseAfter.some(t => t.id === 'mid-e1')).toBe(true)
  })

  it('扣到 0 → status 变 depleted', () => {
    const src = makeTube({ id: 's', name: 'Tri-a', type: 'source', remainingVolume: 20 })
    const mid = makeTube({ id: 'm', name: 'Tri-a-mix', type: 'intermediate' })
    const result = settleExperiment({
      experiment: makeExperiment(
        [src, mid],
        [{ id: 'c1', fromTubeId: 's', toTubeId: 'm', volume: 20, volumeUnit: 'μL' }]
      ),
      warehouse: [src]
    })

    expect(result.warehouseAfter.find(t => t.id === 's')!.status).toBe('depleted')
    expect(result.depleted).toContain('s')
  })

  it('缓冲液体积不变，也不进 usage', () => {
    const buffer = makeTube({ id: 'b', name: 'PBS', type: 'buffer', remainingVolume: 500 })
    const mid = makeTube({ id: 'm', name: 'mix', type: 'intermediate' })
    const result = settleExperiment({
      experiment: makeExperiment(
        [buffer, mid],
        [{ id: 'c1', fromTubeId: 'b', toTubeId: 'm', volume: 90, volumeUnit: 'μL' }]
      ),
      warehouse: [buffer]
    })

    expect(result.warehouseAfter.find(t => t.id === 'b')!.remainingVolume).toBe(500)
    expect(result.usage.some(u => u.reagentId === 'b')).toBe(false)
  })

  it('上样 / 废液不进仓库', () => {
    const sample = makeTube({ id: 'sp', name: '上样', type: 'sample' })
    const result = settleExperiment({
      experiment: makeExperiment([sample], []),
      warehouse: []
    })
    expect(result.warehouseAfter).toHaveLength(0)
    expect(result.created).toHaveLength(0)
  })

  it('已入仓的中间产物按「仓库余量 − 移出」扣减', () => {
    const midInWarehouse = makeTube({ id: 'm', name: '10E1', type: 'intermediate', remainingVolume: 40 })
    const target = makeTube({ id: 't', name: '10E', type: 'intermediate' })
    const result = settleExperiment({
      experiment: makeExperiment(
        [midInWarehouse, target],
        [{ id: 'c1', fromTubeId: 'm', toTubeId: 't', volume: 10, volumeUnit: 'μL' }]
      ),
      warehouse: [midInWarehouse]
    })

    expect(result.warehouseAfter.find(t => t.id === 'm')!.remainingVolume).toBe(30)
    expect(result.usage.find(u => u.reagentId === 'm')).toEqual(
      expect.objectContaining({ used: 10, before: 40, after: 30 })
    )
  })

  it('不修改传入的仓库数组（纯函数）', () => {
    const src = makeTube({ id: 's', name: 'E1', type: 'source', remainingVolume: 20 })
    const warehouse = [src]
    const snapshot = JSON.stringify(warehouse)
    settleExperiment({
      experiment: makeExperiment([src], []),
      warehouse
    })
    expect(JSON.stringify(warehouse)).toBe(snapshot)
  })

  it('结算结果写盘后再读回来 = 结算后的值（重启不回滚）', () => {
    const src = makeTube({ id: 's', name: '1M Mg', type: 'source', remainingVolume: 100 })
    const target = makeTube({ id: 't', name: 'mix', type: 'intermediate' })
    const result = settleExperiment({
      experiment: makeExperiment(
        [src, target],
        [{ id: 'c1', fromTubeId: 's', toTubeId: 't', volume: 15, volumeUnit: 'μL' }]
      ),
      warehouse: [src]
    })

    // 模拟「写文件 → 下次启动读文件」
    const persisted = JSON.parse(JSON.stringify(result.warehouseAfter)) as Tube[]
    const again = settleExperiment({
      experiment: makeExperiment([src], []),
      warehouse: persisted
    })
    expect(persisted.find(t => t.id === 's')!.remainingVolume).toBe(85)
    expect(again.usage).toEqual([])
  })
})
