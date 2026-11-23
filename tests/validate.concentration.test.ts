import { describe, expect, it } from 'vitest'

import { validateExperiment } from '../src/core/validate'
import { formatCheckIssues } from '../src/renderer/src/pages/experimentCheckMessages'
import { conn, tube } from './helpers/fixtures'

/**
 * 标称浓度 vs 可达浓度（主人 2026-11-23）：
 * 手工和在 yml 里手写的目标浓度，如果按现有连线体积配不出来，检查必须当场报错，
 * 不能让它安静显示在页面上。
 */
describe('concentration_mismatch —— 标称浓度配不出来就报错', () => {
  const source = tube({
    id: 'src',
    type: 'source',
    name: 'Tri-c 原液',
    totalVolume: 100,
    remainingVolume: 100,
    substances: [{ name: 'Tri-c', concentration: 10 } as never]
  })

  const makeTarget = (declared: number) =>
    tube({
      id: 'dst',
      type: 'intermediate',
      name: '挂发卡A-H3',
      configOrder: 1,
      totalVolume: 20,
      remainingVolume: 20,
      substances: [{ name: 'Tri-c', concentration: declared } as never]
    })

  // 10 µM × 2 µL 进 20 µL → 只能配出 1 µM
  const connections = [conn('src', 'dst', 2)]

  const run = (declared: number) =>
    validateExperiment({
      tubes: [source, makeTarget(declared)],
      connections,
      warehouseTubes: []
    })

  it('标称与可达一致时不报错', () => {
    expect(run(1).filter(i => i.code === 'concentration_mismatch')).toHaveLength(0)
  })

  it('标称 1.5 µM、只能配出 1 µM 时报 concentration_mismatch', () => {
    const hit = run(1.5).find(i => i.code === 'concentration_mismatch')
    expect(hit).toBeTruthy()
    expect(hit?.tubeId).toBe('dst')
    expect(hit?.params.substanceName).toBe('Tri-c')
    expect(hit?.params.declared).toBe(1.5)
    expect(hit?.params.attainable).toBeCloseTo(1, 6)
  })

  it('界面文案说清「标称 X、只能配出 Y」', () => {
    const issues = run(1.5).filter(i => i.code === 'concentration_mismatch')
    const [msg] = formatCheckIssues(issues, [source, makeTarget(1.5)], 'zh')
    expect(msg.message).toContain('只能配出 1 μM')
  })
})
