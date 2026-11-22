import { describe, expect, it } from 'vitest'

import { toCanvasObject } from '../../src/core/exporters/canvas'
import {
  CANVAS_PRESETS,
  canvasColorFor,
  nearestPreset,
  parseHexColor,
  presetName
} from '../../src/core/exporters/canvasColor'
import { parseProjectYml, toProjectYml } from '../../src/core/exporters/yml'
import { fixtures, tube } from '../helpers/fixtures'
import { fixtureInput } from '../helpers/projectInput'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!

describe('颜色映射：Obsidian 六个预设色', () => {
  it('预设色就是 1–6，且各自有可解析的 hex', () => {
    expect(CANVAS_PRESETS.map(p => p.key)).toEqual(['1', '2', '3', '4', '5', '6'])
    for (const preset of CANVAS_PRESETS) {
      expect(parseHexColor(preset.hex)).not.toBeNull()
    }
  })

  it('类型默认色：来源=青、中间=绿、缓冲=紫、废液=橙、样本不填', () => {
    expect(canvasColorFor('source')).toBe('5')
    expect(canvasColorFor('intermediate')).toBe('4')
    expect(canvasColorFor('buffer')).toBe('6')
    expect(canvasColorFor('waste')).toBe('2')
    expect(canvasColorFor('sample')).toBeUndefined()
  })

  it('自定义色值按最接近的预设收敛', () => {
    expect(nearestPreset('#fef08a')).toBe('3') // 浅黄 → 黄
    expect(nearestPreset('#44cf6e')).toBe('4') // 官方绿原样 → 绿
    expect(nearestPreset('#c4b5fd')).toBe('6') // 浅紫 → 紫
    expect(nearestPreset('#a5f3fc')).toBe('5') // 浅青 → 青
    expect(nearestPreset('#fca5a5')).toBe('1') // 浅红 → 红
    expect(nearestPreset('#fdba74')).toBe('2') // 浅橙 → 橙
    expect(nearestPreset('不是颜色')).toBeUndefined()
    expect(presetName('4')).toBe('绿')
  })

  it('成分色不再影响画布：一律按类型上色', () => {
    const input = {
      ...fixtureInput(ad52),
      substanceColors: { E1: '#fef08a' }
    }
    const withColors = toCanvasObject(input)
    const withoutColors = toCanvasObject({ ...fixtureInput(ad52), substanceColors: undefined })
    const pick = (canvas: ReturnType<typeof toCanvasObject>) =>
      canvas.nodes.map(n => n.color).join(',')
    // 有没有成分色，画布着色完全一样
    expect(pick(withColors)).toBe(pick(withoutColors))
    const e1 = withColors.nodes.find(n => n.text.startsWith('**E1**'))!
    expect(e1.color).toBe('5') // 来源试剂=青
  })

  it('节点颜色只可能是 1–6，且 .canvas 里不出现自定义键', () => {
    const canvas = toCanvasObject({
      ...fixtureInput(ad52),
      substanceColors: { E1: '#fef08a', Mg: '#c4b5fd' }
    })
    for (const node of canvas.nodes) {
      if (node.color !== undefined) expect(['1', '2', '3', '4', '5', '6']).toContain(node.color)
    }
  })

  it('原色值写进 .yml，往返后颜色不变', () => {
    const input = {
      ...fixtureInput(ad52),
      substanceColors: { E1: '#fef08a' }
    }
    const yml = toProjectYml(input)
    expect(yml).toMatch(/color: '#fef08a'/)

    const parsed = parseProjectYml(yml)
    expect(parsed.input.substanceColors?.E1).toBe('#fef08a')

    const before = toCanvasObject(input).nodes.map(n => `${n.id}:${n.color ?? '-'}`)
    const after = toCanvasObject(parsed.input).nodes.map(n => `${n.id}:${n.color ?? '-'}`)
    expect(after).toEqual(before)
  })

  it('缓冲液管也有颜色（不是一片白）', () => {
    const input = fixtureInput(ad52)
    const canvas = toCanvasObject(input)
    const bufferIds = input.tubes.filter(t => t.type === 'buffer').map(t => t.id)
    expect(bufferIds.length).toBeGreaterThan(0)
    const buffers = canvas.nodes.filter(n => bufferIds.includes(n.id))
    expect(buffers.every(node => node.color === '6')).toBe(true)
  })

  it('按类型统一配色：来源 5 / 中间 4 / 缓冲 6 / 废液 2 / 样本不上色', () => {
    const input = fixtureInput(ad52)
    const canvas = toCanvasObject(input)
    const byId = new Map(canvas.nodes.map(n => [n.id, n.color]))
    for (const tube of input.tubes) {
      const expected = { source: '5', intermediate: '4', buffer: '6', waste: '2', sample: undefined }[tube.type as string]
      expect(byId.get(tube.id), tube.name).toBe(expected)
    }
  })
})
