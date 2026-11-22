/**
 * 第 7 条：结算遇到找不到的试剂不能静默跳过。
 *
 * 事故形状：画布上 source 管引用的试剂在 仓库.yml 里找不到时，settle 既不更新也不报错，
 * 账就悄悄少算了；界面「检查」也看不见。现在结算是先做引用检查——找不到就拒绝，并列出是哪几管。
 */
import { describe, expect, it } from 'vitest'

import { MissingReagentRefError, missingSourceRefTubes, settleExperiment } from '../../src/core/settle'
import { validateExperiment } from '../../src/core/validate'
import type { Experiment, Tube } from '../../src/core/schema'

function source(id: string, name: string, remaining = 100): Tube {
  return {
    id,
    name,
    type: 'source',
    totalVolume: 100,
    totalVolumeUnit: 'μL',
    remainingVolume: remaining,
    remainingVolumeUnit: 'μL',
    substances: [{ name, concentration: 100, concentrationUnit: 'μM' }],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  } as Tube
}

function target(): Tube {
  return {
    id: 't-1',
    name: '目标管',
    type: 'intermediate',
    totalVolume: 0,
    totalVolumeUnit: 'μL',
    remainingVolume: 0,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  } as Tube
}

function experimentWith(tubes: Tube[]): Experiment {
  return {
    id: 'exp-1',
    name: '引用检查',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'draft',
    tubes,
    tubePositions: [],
    connections: tubes.filter(t => t.type === 'source').map((t, i) => ({
      id: `c-${i}`,
      fromTubeId: t.id,
      toTubeId: 't-1',
      volume: 5,
      volumeUnit: 'μL' as const
    }))
  }
}

describe('missingSourceRefTubes', () => {
  it('找出源试管引用了、但仓库里没有的试剂', () => {
    const missing = missingSourceRefTubes(experimentWith([source('mg', '1M Mg'), source('e1', 'E1'), target()]), [
      source('mg', '1M Mg')
    ])
    expect(missing).toEqual([{ id: 'e1', name: 'E1' }])
  })

  it('全部找得到 → 空数组；缓冲液/上样管不参与', () => {
    const buffer = { ...source('buffer-pbs-t-1', 'PBS'), type: 'buffer' as const }
    expect(missingSourceRefTubes(experimentWith([source('mg', '1M Mg'), buffer, target()]), [source('mg', '1M Mg')])).toEqual([])
  })
})

describe('settleExperiment：引用缺失就拒绝结算', () => {
  it('抛出 MissingReagentRefError，消息里带管名与 id', () => {
    const experiment = experimentWith([source('mg', '1M Mg'), source('e1', 'E1'), target()])
    let caught: unknown
    try {
      settleExperiment({ experiment, warehouse: [source('mg', '1M Mg')] })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(MissingReagentRefError)
    const error = caught as MissingReagentRefError
    expect(error.tubes).toEqual([{ id: 'e1', name: 'E1' }])
    expect(error.message).toContain('拒绝结算')
    expect(error.message).toContain('「E1」')
    expect(error.message).toContain('e1')
    expect(error.message).toContain('1 根')
  })

  it('多根管缺失时逐根列出', () => {
    const experiment = experimentWith([source('mg', '1M Mg'), source('e1', 'E1'), source('e2', 'E2'), target()])
    expect(() => settleExperiment({ experiment, warehouse: [] })).toThrow(MissingReagentRefError)
    try {
      settleExperiment({ experiment, warehouse: [] })
    } catch (error) {
      expect((error as Error).message).toContain('「1M Mg」')
      expect((error as Error).message).toContain('「E1」')
      expect((error as Error).message).toContain('「E2」')
      expect((error as Error).message).toContain('3 根')
    }
  })

  it('引用齐全时照常结算（不误伤）', () => {
    const experiment = experimentWith([source('mg', '1M Mg'), target()])
    const settled = settleExperiment({ experiment, warehouse: [source('mg', '1M Mg')] })
    expect(settled.warehouseAfter.find(t => t.id === 'mg')!.remainingVolume).toBe(95)
  })
})

describe('validate：界面「检查」也能看见同一件事', () => {
  it('报 warehouse_ref_missing，tubeId 指向那根源试管', () => {
    const experiment = experimentWith([source('mg', '1M Mg'), source('e1', 'E1'), target()])
    const issues = validateExperiment({
      tubes: experiment.tubes,
      connections: experiment.connections,
      warehouseTubes: [source('mg', '1M Mg')]
    })
    const missing = issues.filter(issue => issue.code === 'warehouse_ref_missing')
    expect(missing).toHaveLength(1)
    expect(missing[0].tubeId).toBe('e1')
    expect(missing[0].params).toEqual({ reagentId: 'e1' })
  })

  it('引用齐全时不报这条', () => {
    const experiment = experimentWith([source('mg', '1M Mg'), target()])
    const issues = validateExperiment({
      tubes: experiment.tubes,
      connections: experiment.connections,
      warehouseTubes: [source('mg', '1M Mg')]
    })
    expect(issues.filter(issue => issue.code === 'warehouse_ref_missing')).toHaveLength(0)
  })
})
