/**
 * 缺陷 8：单位不归一 —— 5 mL 试剂被 100 µL 一抽就判耗尽。
 *
 * 口径：结算一律在 µL 基准上算，写回时按该管自己的单位换回去。
 * 界面（内存里的 experiment）与 CLI（从工程正本 yml 解析出来再结算）必须同结果。
 */
import { describe, expect, it } from 'vitest'

import { settleExperiment } from '../../src/core/settle'
import { experimentFromProjectFile, projectFileText } from '../../src/core/store/projectFile'
import type { Experiment, Tube } from '../../src/shared/types'

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

/** 5 mL 试剂的全部 4.9 mL 仍是一根「没耗尽」的管子 */
function makeExperiment(): Experiment {
  const stock = makeTube({
    id: 'stock-ml',
    name: 'PBS(5mL)',
    type: 'source',
    totalVolume: 5,
    totalVolumeUnit: 'mL',
    remainingVolume: 5,
    remainingVolumeUnit: 'mL'
  })
  const target = makeTube({ id: 'sample-1', name: '样品1', type: 'sample', remainingVolume: 100 })
  return {
    id: 'exp-ml',
    name: 'mL 单位结算',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'draft',
    tubes: [stock, target],
    tubePositions: [],
    connections: [
      { id: 'c1', fromTubeId: 'stock-ml', toTubeId: 'sample-1', volume: 100, volumeUnit: 'μL' }
    ]
  }
}

describe('单位归一：mL 试剂被 µL 抽走', () => {
  it('5 mL 试剂抽走 100 µL → 不判耗尽，余量写回仍是 4.9 mL', () => {
    const experiment = makeExperiment()
    const stock = experiment.tubes[0]
    const result = settleExperiment({ experiment, warehouse: [stock] })

    const after = result.warehouseAfter.find(t => t.id === 'stock-ml')!
    expect(after.remainingVolume).toBe(4.9)
    expect(after.remainingVolumeUnit).toBe('mL')
    expect(after.status).toBe('active')

    // 结束状态（画布）也是 4.9 mL，不是 0.0049 或 4.9 µL
    const endStock = result.endStateTubes.find(t => t.id === 'stock-ml')!
    expect(endStock.remainingVolume).toBe(4.9)
    expect(endStock.remainingVolumeUnit).toBe('mL')

    // 扣减记账以 µL 为口径：5000 - 4900 = 100
    expect(result.usage).toEqual([
      expect.objectContaining({ reagentId: 'stock-ml', used: 100, unit: 'μL', depleted: false })
    ])
    expect(result.depleted).toEqual([])
  })

  it('抽走 5 mL（整管）才判耗尽', () => {
    const experiment = makeExperiment()
    experiment.connections[0].volume = 5000
    const result = settleExperiment({ experiment, warehouse: [experiment.tubes[0]] })

    const after = result.warehouseAfter.find(t => t.id === 'stock-ml')!
    expect(after.remainingVolume).toBe(0)
    expect(after.status).toBe('depleted')
    expect(result.depleted).toEqual(['stock-ml'])
  })

  it('界面（内存工程）与 CLI（从正本 yml 解析）结算结果在 µL 口径上逐项一致', () => {
    const experiment = makeExperiment()
    const fromFile = experimentFromProjectFile(projectFileText(experiment), experiment).experiment

    const warehouse = [experiment.tubes[0]]
    const uiResult = settleExperiment({ experiment, warehouse })
    // CLI 读的是磁盘上的 工程.yml → 解析后的工程，再走同一个结算函数。
    // 工程 yml 的体积一律写成 µL（既有格式，不改），所以两边按 µL 口径比。
    const cliResult = settleExperiment({ experiment: fromFile, warehouse })
    const base = (t: { remainingVolume: number; remainingVolumeUnit?: string }) => [
      t.remainingVolumeUnit === 'mL' ? t.remainingVolume * 1000 : t.remainingVolume,
      'μL'
    ]

    expect(cliResult.warehouseAfter.map(t => [t.id, ...base(t)])).toEqual(
      uiResult.warehouseAfter.map(t => [t.id, ...base(t)])
    )
    expect(cliResult.usage).toEqual(uiResult.usage)
    expect(cliResult.depleted).toEqual(uiResult.depleted)
    expect(cliResult.created).toEqual(uiResult.created)
    expect(cliResult.endStateTubes.map(t => [t.id, ...base(t)])).toEqual(
      uiResult.endStateTubes.map(t => [t.id, ...base(t)])
    )
    // 界面自己保留原来的 mL 单位显示，只是数值是 4.9
    expect(uiResult.warehouseAfter.find(t => t.id === 'stock-ml')!.remainingVolumeUnit).toBe('mL')
  })
})
