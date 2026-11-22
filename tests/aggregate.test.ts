import { describe, expect, it } from 'vitest'

import { aggregateFlows, inVolumeOf, outVolumeOf } from '../src/core/aggregate'
import { legacyAggregate } from './fixtures/legacy/legacyAggregate'
import { conn, fixtures, tube } from './helpers/fixtures'

describe('aggregateFlows —— 移入移出汇总（4 份副本合一）', () => {
  it('真实工程：与改动前的实现逐位一致', () => {
    for (const fixture of fixtures) {
      const legacy = legacyAggregate(fixture.experiment.connections)
      const next = aggregateFlows(fixture.experiment.connections)

      expect([...next.inVolume.entries()]).toEqual([...legacy.tubeInVolume.entries()])
      expect([...next.outVolume.entries()]).toEqual([...legacy.tubeOutVolume.entries()])
    }
  })

  it('跳过体积 <= 0 的连线', () => {
    const flows = aggregateFlows([conn('a', 'b', 0), conn('a', 'b', -5), conn('a', 'b', 10)])
    expect(inVolumeOf(flows, 'b')).toBe(10)
    expect(outVolumeOf(flows, 'a')).toBe(10)
  })

  it('同一对试管多条连线按顺序累加', () => {
    const flows = aggregateFlows([conn('a', 'b', 0.1), conn('a', 'b', 0.2), conn('c', 'b', 0.3)])
    expect(inVolumeOf(flows, 'b')).toBe(0.1 + 0.2 + 0.3)
    expect(outVolumeOf(flows, 'a')).toBe(0.1 + 0.2)
  })

  it('空连线：两个 Map 都是空', () => {
    const flows = aggregateFlows([])
    expect(flows.inVolume.size).toBe(0)
    expect(flows.outVolume.size).toBe(0)
    expect(inVolumeOf(flows, 'nope')).toBe(0)
  })

  it('未出现的试管读出来是 0（不是 undefined）', () => {
    const flows = aggregateFlows([conn('a', 'b', 5)])
    expect(inVolumeOf(flows, 'x')).toBe(0)
    expect(outVolumeOf(flows, 'x')).toBe(0)
  })

  it('测试用的最小试管工厂可用', () => {
    expect(tube({ id: 't1', type: 'source' }).type).toBe('source')
  })
})
