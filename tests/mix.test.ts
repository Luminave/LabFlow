import { describe, expect, it } from 'vitest'

import {
  accumulateMoles,
  blendConcentration,
  computeMixture,
  mergeSubstancePlaceholders,
  solveRequiredVolumes,
  sourcesIntoTube
} from '../src/core/mix'
import { legacyAddConnectionMerge, legacyCalculateForTubeSolve, legacyTransferInBlend } from './fixtures/legacy/legacyMix'
import { conn, fixtures, tube } from './helpers/fixtures'

const sub = (name: string, concentration: number, concentrationUnit: any = 'μM') => ({
  name,
  concentration,
  concentrationUnit
})

describe('computeMixture —— 单位归一化（这是本次唯一的行为改动）', () => {
  it('10 mM 混 10 μM 不再差 1000 倍', () => {
    // 10 μL 的 10 mM + 10 μL 的 10 μM，总体积 20 μL
    const sources = [
      { substances: [sub('X', 10, 'mM')], volume: 10 },
      { substances: [sub('X', 10, 'μM')], volume: 10 }
    ]
    const next = computeMixture(sources, { unitMode: 'uM' })[0]

    // 正确值：(10 000 μM × 10 μL + 10 μM × 10 μL) / 20 μL = 5005 μM
    expect(next.concentration).toBe(5005)
    expect(next.concentrationUnit).toBe('μM')

    // 改之前的算法（不归一化，直接把数字相加）= (10×10 + 10×10)/20 = 10，并把单位当 mM
    const legacyValue = 10
    expect(next.concentration / legacyValue).toBeCloseTo(500.5, 6)
    expect(next.concentration).not.toBe(legacyValue)
  })

  it('同单位输入：结果与改动前的算式逐位一致', () => {
    const sources = [
      { substances: [sub('X', 100)], volume: 16.666666666666668 },
      { substances: [sub('X', 25)], volume: 36.66666666666666 }
    ]
    const next = computeMixture(sources, { unitMode: 'uM' })[0]
    // 旧算法：(100×16.666666666666668 + 25×36.66666666666666)/(16.666666666666668+36.66666666666666)
    const legacy =
      Math.round(
        ((100 * 16.666666666666668 + 25 * 36.66666666666666) / (16.666666666666668 + 36.66666666666666)) * 1000
      ) / 1000
    expect(next.concentration).toBe(legacy)
  })

  it('unitMode 默认 first：按成分首次出现的单位输出', () => {
    const sources = [{ substances: [sub('X', 5, 'mM')], volume: 10 }]
    const entry = computeMixture(sources)[0]
    expect(entry.concentrationUnit).toBe('mM')
    expect(entry.concentration).toBe(5)
  })

  it('总体积为 0 时返回空数组', () => {
    expect(computeMixture([])).toEqual([])
    expect(computeMixture([{ substances: [sub('X', 10)], volume: 0 }])).toEqual([])
  })

  it('round: false 时给原值（讲述者要自己格式化）', () => {
    const sources = [{ substances: [sub('X', 100)], volume: 3 }]
    const entry = computeMixture(sources, { unitMode: 'uM', round: false })[0]
    expect(entry.concentration).toBe(100)
  })

  it('accumulateMoles 的摩尔量按 μM·μL 累计', () => {
    const acc = accumulateMoles([
      { substances: [sub('X', 1, 'mM')], volume: 2 },
      { substances: [sub('X', 100, 'μM')], volume: 3 }
    ])
    // 1 mM = 1000 μM → 1000×2 + 100×3 = 2300 pmol
    expect(acc.moles.get('X')).toBe(2300)
    expect(acc.totalVolume).toBe(5)
  })
})

describe('blendConcentration —— 写库口径的浓度混合', () => {
  it('同单位：与改动前的算式逐位一致', () => {
    const a = sub('X', 100)
    const b = sub('X', 25)
    const next = blendConcentration(a, 16.666666666666668, b, 36.66666666666666, 'μM')
    const legacy = Math.round(
      ((100 * 16.666666666666668 + 25 * 36.66666666666666) / (16.666666666666668 + 36.66666666666666)) * 1000
    ) / 1000
    expect(next).toBe(legacy)
  })

  it('不同单位：归一化后再算（原来是直接拿数字相加）', () => {
    const a = sub('X', 10, 'mM') // 10 000 μM
    const b = sub('X', 10, 'μM')
    const next = blendConcentration(a, 10, b, 10, 'μM')
    expect(next).toBe(5005)

    const legacy = Math.round(((10 * 10 + 10 * 10) / 20) * 1000) / 1000 // = 10（还被当成 mM）
    expect(next).not.toBe(legacy)
  })

  it('输出单位不同于两者：结果换回目标单位', () => {
    const a = sub('X', 5, 'mM')
    const next = blendConcentration(a, 10, sub('X', 0), 0, 'μM')
    expect(next).toBe(5000)
  })

  it('与 legacy 在「全部同单位」时逐位一致（三种典型组合）', () => {
    const cases: [number, number, number, number][] = [
      [20, 5, 30, 15],
      [0, 10, 100, 90],
      [16.666666666666668, 3, 36.66666666666666, 7.5]
    ]
    for (const [ca, va, cb, vb] of cases) {
      const legacy = legacyTransferInBlend([sub('X', ca)], va, [sub('X', cb)], vb, false, [], false)[0]
      expect(blendConcentration(sub('X', ca), va, sub('X', cb), vb, 'μM')).toBe(legacy.concentration)
    }
  })
})

describe('sourcesIntoTube —— 从连线挑来源（recalculateTargetTube 口径）', () => {
  it('跳过缓冲液、跳过体积为 0 的连线', () => {
    const tubes = [tube({ id: 's1', type: 'source' }), tube({ id: 'buf', type: 'buffer' })]
    const sources = sourcesIntoTube([conn('s1', 't', 5), conn('buf', 't', 7), conn('s1', 't', 0)], tubes, 't')
    expect(sources).toHaveLength(1)
    expect(sources[0].volume).toBe(5)
  })

  it('源试管不存在时跳过', () => {
    const sources = sourcesIntoTube([conn('ghost', 't', 5)], [], 't')
    expect(sources).toEqual([])
  })
})

describe('solveRequiredVolumes —— 反算移液体积', () => {
  it('mM 目标用 μM 源：需要的体积是 1000 倍关系', () => {
    const result = solveRequiredVolumes({
      targetSubstances: [sub('X', 10, 'mM')],
      targetVolume: 100,
      sources: [{ tubeId: 's1', type: 'source', substances: [sub('X', 10, 'μM')] }]
    })
    // 目标 10 mM = 10 000 μM，100 μL → 需要 1e6 pmol；源 10 μM → 100 000 μL
    expect(result.volumes.get('s1')).toBe(100000)
    expect(result.missingSubstances).toEqual([])
  })

  it('同一源命中多个成分取最大值', () => {
    const result = solveRequiredVolumes({
      targetSubstances: [sub('X', 10), sub('Y', 50)],
      targetVolume: 100,
      sources: [{ tubeId: 's1', type: 'source', substances: [sub('X', 100), sub('Y', 100)] }]
    })
    expect(result.volumes.get('s1')).toBe(50)
  })

  it('找不到来源的成分进 missingSubstances', () => {
    const result = solveRequiredVolumes({
      targetSubstances: [sub('Z', 10)],
      targetVolume: 10,
      sources: [{ tubeId: 's1', type: 'source', substances: [sub('X', 100)] }]
    })
    expect(result.missingSubstances).toEqual(['Z'])
  })

  it('跳过浓度为 0 的目标成分', () => {
    const result = solveRequiredVolumes({
      targetSubstances: [sub('X', 0)],
      targetVolume: 10,
      sources: []
    })
    expect(result.volumes.size).toBe(0)
    expect(result.missingSubstances).toEqual([])
  })

  it('真实工程：与改动前的反算逐位一致', () => {
    for (const fixture of fixtures) {
      const { tubes, connections } = fixture.experiment
      for (const target of tubes) {
        const incoming = connections.filter(c => c.toTubeId === target.id)
        if (incoming.length === 0) continue
        const legacy = legacyCalculateForTubeSolve(target.substances, target.totalVolume, incoming, tubes)
        const next = solveRequiredVolumes({
          targetSubstances: target.substances,
          targetVolume: target.totalVolume,
          sources: incoming.map(c => {
            const sourceTube = tubes.find(t => t.id === c.fromTubeId)
            return {
              tubeId: c.fromTubeId,
              type: (sourceTube?.type || 'source') as any,
              substances: sourceTube?.substances || []
            }
          })
        })
        expect([...next.volumes.entries()]).toEqual([...legacy.sourceTubeVolumes.entries()])
        expect(next.missingSubstances).toEqual(legacy.missingSubstances)
      }
    }
  })
})

describe('mergeSubstancePlaceholders —— 连线补占位', () => {
  it('与改动前一致：只补不存在的名字，浓度 0', () => {
    const existing = [sub('X', 10)]
    const incoming = [sub('X', 99), sub('Y', 5, 'mM')]
    expect(mergeSubstancePlaceholders(existing, incoming)).toEqual(legacyAddConnectionMerge(existing, incoming))
    expect(mergeSubstancePlaceholders(existing, incoming)).toEqual([sub('X', 10), sub('Y', 0, 'mM')])
  })

  it('不改原数组', () => {
    const existing = [sub('X', 10)]
    mergeSubstancePlaceholders(existing, [sub('Y', 5)])
    expect(existing).toHaveLength(1)
  })
})
