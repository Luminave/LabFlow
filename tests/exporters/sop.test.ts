import { describe, expect, it } from 'vitest'

import { toSopMarkdown } from '../../src/core/exporters/sop'
import { parseProjectLink } from '../../src/core/deepLink'
import { buildNarrationSteps, narrationText, stepTitle } from '../../src/core/narration'
import type { Experiment } from '../../src/shared/types'
import { conn, fixtures, tube } from '../helpers/fixtures'
import { fixtureInput } from '../helpers/projectInput'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!

/** fixture -> Experiment（讲述逻辑吃 Experiment） */
function asExperiment(input = fixtureInput(ad52)): Experiment {
  return {
    id: 'x',
    name: input.name,
    createdAt: input.createdAt || '',
    updatedAt: input.updatedAt || '',
    status: 'completed',
    tubes: input.tubes,
    tubePositions: input.positions,
    connections: input.connections
  } as Experiment
}

describe('讲述逻辑（讲述者页与 SOP 共用）', () => {
  it('步骤顺序按配置序号，取液按体积从大到小', () => {
    const experiment = asExperiment()
    const steps = buildNarrationSteps(experiment)
    expect(steps.length).toBeGreaterThan(0)

    const orders = steps.map(s => s.tube.configOrder || 999999)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)

    for (const step of steps) {
      const volumes = step.sources.map(s => s.volume)
      expect([...volumes].sort((a, b) => b - a)).toEqual(volumes)
    }
  })

  it('标题行格式与改动前一致，只是数字走 formatQuantity', () => {
    const step = buildNarrationSteps(asExperiment())[0]
    const title = stepTitle(step, false)
    expect(title).toMatch(/^Step1: .+ {3}-?[\d.]+ (nL|μL|mL) {3}\(.*\)$/)
  })

  it('浓度不再出现 5000.0000 µM 这种写法', () => {
    const text = narrationText(asExperiment(), false)
    expect(text).not.toMatch(/\d0000 /)
    expect(text).not.toMatch(/\.0+ ?μM/)
  })

  it('用管号开关生效', () => {
    const experiment = asExperiment()
    const step = buildNarrationSteps(experiment)[0]
    if (step.tube.tubeNumber) {
      expect(stepTitle(step, true)).toContain('#')
    }
  })
})

describe('SOP —— 头部的工程深链接', () => {
  it('头部带一行「在 LabFlow 中打开」，名字与链接都按 UTF-8 编码', () => {
    const input = { ...fixtureInput(ad52), name: '261118-实际实验', id: 'exp-1' }
    const md = toSopMarkdown(input)
    expect(md).toContain('> 在 LabFlow 中打开：[261118-实际实验](labflow://open?project=261118-%E5%AE%9E%E9%99%85%E5%AE%9E%E9%AA%8C&id=exp-1)')
  })

  it('没有 id 时只带工程名', () => {
    const input = { ...fixtureInput(ad52), name: 'AD-5.2', id: undefined }
    const md = toSopMarkdown(input)
    expect(md).toContain('> 在 LabFlow 中打开：[AD-5.2](labflow://open?project=AD-5.2)')
  })

  it('头部那一行的链接能被自己的解析器解开', () => {
    const input = { ...fixtureInput(ad52), name: '中文 工程', id: undefined }
    const md = toSopMarkdown(input)
    const line = md.split('\n').find(l => l.startsWith('> 在 LabFlow 中打开：'))!
    const link = line.slice(line.indexOf('](') + 2, -1)
    const parsed = parseProjectLink(link)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.project).toBe('中文 工程')
  })
})

describe('SOP —— <日期>.md', () => {
  const input = fixtureInput(ad52)
  const md = toSopMarkdown(input)

  it('开头有 Obsidian front matter 与工程信息', () => {
    expect(md.startsWith('---\nlabflow: sop\n')).toBe(true)
    expect(md).toContain(`date: ${JSON.stringify(input.date)}`)
    expect(md).toContain(`# ${input.name} 操作步骤（SOP）`)
  })

  it('步骤编号，每步写清取多少体积、加到哪管', () => {
    const steps = buildNarrationSteps(asExperiment(input))
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) {
      expect(md).toContain(`## Step${step.index}：`)
    }
    expect(md).toMatch(/^\d+\. 从「.+」取 -?[\d.]+ (nL|μL|mL)，加到「.+」$/m)
  })

  it('每步写目标浓度，走好读单位', () => {
    expect(md).toMatch(/配好后的浓度：.*\d+ (nM|μM|mM) /)
    expect(md).toMatch(/- 本步总量：[\d.]+ (nL|μL|mL)/)
  })

  it('末尾有「物质 / 总用量 / 备注」汇总表', () => {
    const idx = md.indexOf('## 用量汇总')
    expect(idx).toBeGreaterThan(0)
    const table = md.slice(idx)
    expect(table).toContain('| 物质 | 总用量 | 备注 |')
    expect(table).toMatch(/\| .+ \| [\d.]+ (nL|μL|mL) \| .+ \|/)
  })

  it('不出现 5000 这种一串 0 的写法', () => {
    expect(md).not.toMatch(/5000 μM/)
    expect(md).not.toMatch(/\.0000/)
  })

  it('空工程也能生成，并给出提示', () => {
    const mdEmpty = toSopMarkdown({ name: '空工程', date: '2026-11-18', tubes: [], connections: [], positions: [] })
    expect(mdEmpty).toContain('还没有可讲述的步骤')
    expect(mdEmpty).toContain('## 用量汇总')
  })

  it('纯缓冲液来源会在汇总表里单独列出', () => {
    const tubes = [
      tube({ id: 'buf', type: 'buffer', name: 'PBS 缓冲液', totalVolume: 5000 }),
      tube({ id: 'tgt', type: 'intermediate', name: '混合管', configOrder: 1 })
    ]
    const mdBuffer = toSopMarkdown({
      name: '缓冲液测试',
      date: '2026-11-18',
      tubes,
      connections: [conn('buf', 'tgt', 2985)],
      positions: []
    })
    expect(mdBuffer).toContain('PBS 缓冲液')
    expect(mdBuffer).toContain('2.985 mL')
  })
})
