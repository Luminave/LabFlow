import { describe, expect, it } from 'vitest'

import { computeEndState } from '../src/core/endState'
import type { Tube } from '../src/shared/types'
import { legacyEndStateFromPage, legacyEndStateFromStore, legacyEndStateFromStoreFn } from './fixtures/legacy/legacyEndState'
import { conn, fixtures, tube } from './helpers/fixtures'

/** 去掉时间戳，只比数值 */
function stripTimes(tubes: Tube[]): Omit<Tube, 'updatedAt'>[] {
  return tubes.map(({ updatedAt, ...rest }) => rest)
}

describe('computeEndState —— 结束状态（3 版合一，采用查仓库口径）', () => {
  it('真实工程：与改动前 completeExperiment 内联段逐位一致', () => {
    for (const fixture of fixtures) {
      const legacy = legacyEndStateFromStore(
        fixture.experiment.tubes,
        fixture.experiment.connections,
        fixture.warehouseTubes
      )
      const next = computeEndState({
        tubes: fixture.experiment.tubes,
        connections: fixture.experiment.connections,
        warehouseTubes: fixture.warehouseTubes
      })
      expect(stripTimes(next)).toEqual(stripTimes(legacy))
    }
  })

  it('传 now 时逐管写 updatedAt，与原实现一样', () => {
    let calls = 0
    const next = computeEndState(
      { tubes: [tube({ id: 'a', type: 'source', remainingVolume: 10 })], connections: [], warehouseTubes: [] },
      { now: () => `t-${++calls}` }
    )
    expect(next[0].updatedAt).toBe('t-1')
  })

  it('原料：仓库剩余体积 − 移出体积，下限 0', () => {
    const tubes = [tube({ id: 's', type: 'source', remainingVolume: 100 })]
    const next = computeEndState({
      tubes,
      connections: [conn('s', 'x', 30)],
      warehouseTubes: [tube({ id: 's', type: 'source', remainingVolume: 60 })]
    })
    // 画布上 100，仓库里 60 → 用仓库的 60 − 30 = 30
    expect(next[0].remainingVolume).toBe(30)
  })

  it('仓库里查不到原料时退回画布上的 remainingVolume', () => {
    const next = computeEndState({
      tubes: [tube({ id: 's', type: 'source', remainingVolume: 100 })],
      connections: [conn('s', 'x', 30)],
      warehouseTubes: []
    })
    expect(next[0].remainingVolume).toBe(70)
  })

  it('移出超过可用体积时下限为 0，不出现负数', () => {
    const next = computeEndState({
      tubes: [tube({ id: 's', type: 'source', remainingVolume: 10 })],
      connections: [conn('s', 'x', 50)],
      warehouseTubes: []
    })
    expect(next[0].remainingVolume).toBe(0)
  })

  it('中间产物：在仓库里按「仓库 − 移出」，不在仓库按「移入 − 移出」', () => {
    const tubes = [
      tube({ id: 'inWh', type: 'intermediate', remainingVolume: 500, totalVolume: 500 }),
      tube({ id: 'fresh', type: 'intermediate', remainingVolume: 0, totalVolume: 0 })
    ]
    const connections = [conn('inWh', 'o', 20), conn('s', 'fresh', 12), conn('fresh', 'o2', 2)]
    const next = computeEndState({
      tubes,
      connections,
      warehouseTubes: [tube({ id: 'inWh', type: 'intermediate', remainingVolume: 500 })]
    })
    expect(next[0].remainingVolume).toBe(480)
    expect(next[1].remainingVolume).toBe(10)
  })

  it('缓冲液保持不变（不扣体积）', () => {
    const next = computeEndState({
      tubes: [tube({ id: 'b', type: 'buffer', remainingVolume: 1000 })],
      connections: [conn('b', 'x', 100)],
      warehouseTubes: []
    })
    expect(next[0].remainingVolume).toBe(1000)
  })

  it('新建中间产物的 totalVolume 记首次移入体积；仓库里的保留原值', () => {
    const tubes = [
      tube({ id: 'fresh', type: 'intermediate', totalVolume: 0 }),
      tube({ id: 'inWh', type: 'intermediate', totalVolume: 300 })
    ]
    const connections = [conn('s', 'fresh', 45), conn('fresh', 'o', 5), conn('inWh', 'o2', 5)]
    const next = computeEndState({
      tubes,
      connections,
      warehouseTubes: [tube({ id: 'inWh', type: 'intermediate', remainingVolume: 300 })]
    })
    expect(next[0].totalVolume).toBe(45)
    expect(next[1].totalVolume).toBe(300)
  })

  it('浓度不重算，沿用试管上的设定值', () => {
    const substances = [{ name: 'X', concentration: 5, concentrationUnit: 'mM' as const }]
    const next = computeEndState({
      tubes: [tube({ id: 'i', type: 'intermediate', substances })],
      connections: [conn('s', 'i', 10)],
      warehouseTubes: []
    })
    expect(next[0].substances).toEqual(substances)
  })

  it('被删掉的两版与采用版的差异（记录用）', () => {
    // 找一个画布 remainingVolume 与仓库不一致的真实原料试管
    const fixture = fixtures[0]
    const storeFn = legacyEndStateFromStoreFn(fixture.experiment.tubes, fixture.experiment.connections)
    const page = legacyEndStateFromPage(
      fixture.experiment.tubes,
      fixture.experiment.connections,
      fixture.warehouseTubes
    )
    const adopted = computeEndState({
      tubes: fixture.experiment.tubes,
      connections: fixture.experiment.connections,
      warehouseTubes: fixture.warehouseTubes
    })

    // page 版把所有试管的 totalVolume 改成结束体积 → 必然有大面积差异
    const pageVolumeDiffs = adopted.filter((t, i) => t.totalVolume !== page[i].totalVolume).length
    expect(pageVolumeDiffs).toBeGreaterThan(0)

    // store 模块级版不看仓库 → 原料试管体积可能不同
    const storeFnVolumeDiffs = adopted.filter((t, i) => t.remainingVolume !== storeFn[i].remainingVolume).length
    expect(storeFnVolumeDiffs).toBeGreaterThanOrEqual(0)

    // 三版在 remainingVolume 上的口径：采用版应与 page 版一致
    expect(adopted.map(t => t.remainingVolume)).toEqual(page.map(t => t.remainingVolume))
  })
})
