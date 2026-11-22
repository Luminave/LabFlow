import { describe, expect, it } from 'vitest'

import { validateExperiment } from '../src/core/validate'
import { formatCheckIssues } from '../src/renderer/src/pages/experimentCheckMessages'
import type { Tube } from '../src/shared/types'
import { legacyCheckExperiment } from './fixtures/legacy/legacyValidate'
import { conn, fixtures, tube } from './helpers/fixtures'

describe('validateExperiment —— 实验校验（返回结构化错误，无中文）', () => {
  it('真实工程：中文与英文文案与改动前逐字一致', () => {
    for (const fixture of fixtures) {
      const { tubes, connections, defaultBuffer } = fixture.experiment
      for (const language of ['zh', 'en'] as const) {
        const legacy = legacyCheckExperiment(tubes, connections, fixture.warehouseTubes, defaultBuffer, language)
        const next = formatCheckIssues(
          validateExperiment({
            tubes,
            connections,
            warehouseTubes: fixture.warehouseTubes,
            defaultBuffer
          }),
          tubes,
          language
        )
        expect(next).toEqual(legacy)
      }
    }
  })

  it('内核输出里没有中文文案，只有 code/tubeId/params', () => {
    for (const fixture of fixtures) {
      const issues = validateExperiment({
        tubes: fixture.experiment.tubes,
        connections: fixture.experiment.connections,
        warehouseTubes: fixture.warehouseTubes
      })
      for (const issue of issues) {
        expect(Object.keys(issue).sort()).toEqual(['code', 'params', 'tubeId'])
        expect(JSON.stringify(issue)).not.toMatch(/[\u4e00-\u9fa5]/)
      }
    }
  })

  it('体积超出：原料看仓库、仓库中间产物看仓库、新建中间产物看输入', () => {
    const tubes = [
      tube({ id: 'src', type: 'source', remainingVolume: 10 }),
      tube({ id: 'wh', type: 'intermediate', remainingVolume: 5 }),
      tube({ id: 'fresh', type: 'intermediate', remainingVolume: 0 }),
      tube({ id: 'o1', type: 'waste' }),
      tube({ id: 'o2', type: 'waste' }),
      tube({ id: 'o3', type: 'waste' })
    ]
    const issues = validateExperiment({
      tubes,
      connections: [conn('src', 'o1', 20), conn('wh', 'o2', 20), conn('fresh', 'o3', 20)],
      warehouseTubes: [tube({ id: 'wh', type: 'intermediate', remainingVolume: 5 })]
    })
    const volumeIssues = issues.filter(i => i.code.startsWith('volume_exceed'))
    expect(volumeIssues.map(i => i.code)).toEqual([
      'volume_exceed_source',
      'volume_exceed_intermediate_warehouse',
      'volume_exceed_intermediate_input'
    ])
    expect(volumeIssues[0].params).toEqual({ outVolume: 20, availableVolume: 10 })
    expect(volumeIssues[1].params).toEqual({ outVolume: 20, availableVolume: 5 })
    expect(volumeIssues[2].params).toEqual({ outVolume: 20, inVolume: 0 })
  })

  it('缓冲液缺失：给出缺口体积', () => {
    const tubes = [tube({ id: 'i', type: 'intermediate', totalVolume: 100, remainingVolume: 0 })]
    const issues = validateExperiment({ tubes, connections: [], warehouseTubes: [] })
    const issue = issues.find(i => i.code === 'buffer_missing')
    expect(issue?.params).toEqual({ shortage: 100 })
  })

  it('设置了 defaultBuffer 就不报缓冲液缺失', () => {
    const tubes = [tube({ id: 'i', type: 'intermediate', totalVolume: 100 })]
    const issues = validateExperiment({
      tubes,
      connections: [],
      warehouseTubes: [],
      defaultBuffer: '2ce4bb82-8f0c-4073-a62c-bf7d980e2203'
    })
    expect(issues.some(i => i.code === 'buffer_missing')).toBe(false)
  })

  it('成分找不到来源；浓度为 0 也报', () => {
    const tubes = [
      tube({ id: 'i', type: 'intermediate', totalVolume: 10, selectedBuffer: 'x', substances: [
        { name: 'X', concentration: 10, concentrationUnit: 'μM' },
        { name: 'Y', concentration: 0, concentrationUnit: 'μM' }
      ] })
    ]
    const issues = validateExperiment({ tubes, connections: [], warehouseTubes: [] })
    expect(issues.find(i => i.code === 'substance_source_missing')?.params).toEqual({ substanceName: 'X' })
    expect(issues.find(i => i.code === 'zero_concentration')?.params).toEqual({ substanceName: 'Y' })
  })

  it('目标体积与输入体积差 > 0.1 才报计算错误', () => {
    const base = [tube({ id: 'i', type: 'intermediate', totalVolume: 100, selectedBuffer: 'x' })]
    const near = validateExperiment({ tubes: base, connections: [conn('s', 'i', 99.95)], warehouseTubes: [] })
    const far = validateExperiment({ tubes: base, connections: [conn('s', 'i', 99)], warehouseTubes: [] })
    expect(near.some(i => i.code === 'calculation_error')).toBe(false)
    expect(far.find(i => i.code === 'calculation_error')?.params).toEqual({
      targetVolume: 100,
      inputVolume: 99
    })
  })

  it('配置序号：未设置 / 非正整数 / 重复 / 跳号', () => {
    const tubes: Tube[] = [
      tube({ id: 'a', type: 'intermediate', configOrder: undefined }),
      tube({ id: 'b', type: 'intermediate', configOrder: 1.5 }),
      tube({ id: 'c', type: 'intermediate', configOrder: 2 }),
      tube({ id: 'd', type: 'intermediate', configOrder: 2 }),
      tube({ id: 'e', type: 'intermediate', configOrder: 5 })
    ]
    const issues = validateExperiment({ tubes, connections: [], warehouseTubes: [] })
    const codes = issues.map(i => i.code).filter(c => c.startsWith('config_order'))
    expect(codes).toEqual([
      'config_order_missing',
      'config_order_invalid',
      'config_order_duplicate',
      'config_order_gap'
    ])
    expect(issues.find(i => i.code === 'config_order_invalid')?.params).toEqual({ configOrder: 1.5 })
    expect(issues.find(i => i.code === 'config_order_gap')?.params).toEqual({ from: 2, to: 5 })
  })

  it('asisSource 的中间产物跳过体积、成分与计算检查（缓冲液检查仍照旧执行）', () => {
    const tubes = [tube({ id: 'i', type: 'intermediate', asSource: true, totalVolume: 100, substances: [
      { name: 'X', concentration: 10, concentrationUnit: 'μM' }
    ] })]
    const issues = validateExperiment({ tubes, connections: [conn('i', 'o', 500)], warehouseTubes: [] })
    // 与改动前一致：asSource 只跳过第 1/3/4 项，第 2 项（缓冲液补足）仍然会检查
    expect(issues.map(i => i.code)).toEqual(['buffer_missing'])
  })
})
