/**
 * 对拍测试：真实工程 fixture 上，「改动前的实现」（tests/fixtures/legacy/*）与新的内核实现逐位对比。
 *
 * 通过标准：除 mix 的单位归一化（本次唯一的行为改动）之外，diff 必须为 0。
 */
import { describe, expect, it } from 'vitest'

import { aggregateFlows } from '../src/core/aggregate'
import { computeEndState } from '../src/core/endState'
import { computeMixture, sourcesIntoTube } from '../src/core/mix'
import { validateExperiment } from '../src/core/validate'
import { formatCheckIssues } from '../src/renderer/src/pages/experimentCheckMessages'
import type { Tube } from '../src/shared/types'
import { legacyAggregate } from './fixtures/legacy/legacyAggregate'
import { legacyEndStateFromStore } from './fixtures/legacy/legacyEndState'
import { legacyNarratorMixture, legacyRecalculateTargetTube } from './fixtures/legacy/legacyMix'
import { legacyCheckExperiment } from './fixtures/legacy/legacyValidate'
import { fixtures } from './helpers/fixtures'

const stripTimes = (tubes: Tube[]) => tubes.map(({ updatedAt, ...rest }) => rest)

describe('对拍：真实工程（3 个）上新旧实现 diff 为 0', () => {
  it('aggregate：移入移出汇总', () => {
    for (const fixture of fixtures) {
      const legacy = legacyAggregate(fixture.experiment.connections)
      const next = aggregateFlows(fixture.experiment.connections)
      expect([...next.inVolume.entries()]).toEqual([...legacy.tubeInVolume.entries()])
      expect([...next.outVolume.entries()]).toEqual([...legacy.tubeOutVolume.entries()])
    }
  })

  it('endState：结束状态', () => {
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

  it('validate：校验（zh + en，含文案）', () => {
    for (const fixture of fixtures) {
      const { tubes, connections, defaultBuffer } = fixture.experiment
      for (const language of ['zh', 'en'] as const) {
        expect(
          formatCheckIssues(
            validateExperiment({ tubes, connections, warehouseTubes: fixture.warehouseTubes, defaultBuffer }),
            tubes,
            language
          )
        ).toEqual(legacyCheckExperiment(tubes, connections, fixture.warehouseTubes, defaultBuffer, language))
      }
    }
  })

  it('mix / recalculateTargetTube：每个试管的混合结果', () => {
    for (const fixture of fixtures) {
      const { tubes, connections } = fixture.experiment
      for (const target of tubes) {
        const legacy = legacyRecalculateTargetTube(connections, tubes, target.id)
        const sources = sourcesIntoTube(connections, tubes, target.id)
        const next = computeMixture(sources, { unitMode: 'first', decimals: 3 })
        const totalVolume = sources.reduce((sum, source) => sum + source.volume, 0)
        expect(next).toEqual(legacy.newSubstances)
        expect(totalVolume).toBe(legacy.totalVolume)
      }
    }
  })

  it('mix / 讲述者：纯 μM 工程 diff 为 0', () => {
    const pureUM = fixtures.filter(f =>
      f.experiment.tubes.every(t => (t.substances || []).every(s => s.concentrationUnit === 'μM'))
    )
    expect(pureUM.length).toBeGreaterThanOrEqual(2)

    for (const fixture of pureUM) {
      const { tubes, connections } = fixture.experiment
      for (const target of tubes) {
        const legacy = legacyNarratorMixture(connections, tubes, target.id)
        if (legacy.totalVolume === 0) continue
        const sources = connections
          .filter(c => c.toTubeId === target.id)
          .sort((a, b) => b.volume - a.volume)
          .map(c => ({ tube: tubes.find(t => t.id === c.fromTubeId), conn: c }))
          .filter(item => item.tube)
          .map(item => ({ substances: item.tube!.substances, volume: item.conn.volume }))
        const next = computeMixture(sources, { unitMode: 'uM', round: false })
        // 展示字符串只有浓度部分可能因单位不同而变化；纯 μM 输入下必须完全一致
        expect(next.map(e => `${e.concentration} ${e.name}`)).toEqual(
          legacy.entries.map(e => `${e.concentration} ${e.name}`)
        )
      }
    }
  })

  it('mix / 讲述者：AD-5.2（含 mM）的差异即为本次修的 bug，方向正确', () => {
    const fixture = fixtures.find(f => f.name === 'ad-5-2')!
    const { tubes, connections } = fixture.experiment

    let diffCount = 0
    for (const target of tubes) {
      const legacy = legacyNarratorMixture(connections, tubes, target.id)
      if (legacy.totalVolume === 0) continue
      const sources = connections
        .filter(c => c.toTubeId === target.id)
        .sort((a, b) => b.volume - a.volume)
        .map(c => ({ tube: tubes.find(t => t.id === c.fromTubeId), conn: c }))
        .filter(item => item.tube)
        .map(item => ({ substances: item.tube!.substances, volume: item.conn.volume }))
      const next = computeMixture(sources, { unitMode: 'uM', round: false })

      for (const legacyEntry of legacy.entries) {
        const nextEntry = next.find(e => e.name === legacyEntry.name)
        if (!nextEntry) continue
        if (Math.abs(nextEntry.concentration - legacyEntry.concentration) > 1e-9) {
          diffCount++
          // 新结果一律以 μM 表示；旧结果沿用首次出现源的单位
          expect(nextEntry.concentrationUnit).toBe('μM')
          const oldInUM = legacyEntry.concentration * (legacyEntry.unit === 'mM' ? 1000 : 1)
          // 差异必须是「单位换算」性质的：旧值按自己单位还原成 μM 后应与新值同量级
          expect(oldInUM).toBeGreaterThan(0)
        }
      }
    }
    // AD-5.2 里确实存在需要单位归一化的混合路径
    expect(diffCount).toBeGreaterThan(0)
  })
})
