import { describe, expect, it } from 'vitest'

import { canvasNodeText, parseCanvas, toCanvasFile, toCanvasObject } from '../../src/core/exporters/canvas'
import { fixtures, tube } from '../helpers/fixtures'
import { fixtureInput } from '../helpers/projectInput'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!
const NODE_KEYS = ['id', 'type', 'x', 'y', 'width', 'height', 'text']
/** color 是 Obsidian 自己的预设色字段（合法键），有就多这一个，别的自定义键一律不许 */
const NODE_OPTIONAL_KEYS = ['color']
const EDGE_KEYS = ['id', 'fromNode', 'toNode', 'fromSide', 'toSide', 'label']

describe('项目.canvas —— Obsidian 结构合法', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}：节点/连线只有 Obsidian 认识的键`, () => {
      const canvas = parseCanvas(toCanvasFile(fixtureInput(fixture)))

      expect(Object.keys(canvas).sort()).toEqual(['edges', 'nodes'])
      for (const node of canvas.nodes) {
        const keys = Object.keys(node).sort()
        expect(NODE_KEYS.every(key => keys.includes(key))).toBe(true)
        expect(keys.filter(key => !NODE_KEYS.includes(key)).filter(key => !NODE_OPTIONAL_KEYS.includes(key))).toEqual([])
        if ('color' in node) expect(['1', '2', '3', '4', '5', '6']).toContain(node.color)
        expect(node.type).toBe('text')
        expect(typeof node.text).toBe('string')
        expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true)
      }
      for (const edge of canvas.edges) {
        expect(Object.keys(edge).sort()).toEqual([...EDGE_KEYS].sort())
        expect(['top', 'right', 'bottom', 'left']).toContain(edge.fromSide)
        expect(['top', 'right', 'bottom', 'left']).toContain(edge.toSide)
      }
    })
  }

  it('连线两端都指向真实节点（Obsidian 不认悬空连线）', () => {
    const input = fixtureInput(ad52)
    const canvas = toCanvasObject(input)
    const ids = new Set(canvas.nodes.map(n => n.id))
    for (const edge of canvas.edges) {
      expect(ids.has(edge.fromNode)).toBe(true)
      expect(ids.has(edge.toNode)).toBe(true)
    }
    expect(canvas.edges.length).toBe(input.connections.length)
  })

  it('节点 id 原样用试管 id，连线 label 写用量', () => {
    const input = fixtureInput(ad52)
    const canvas = toCanvasObject(input)
    expect(canvas.nodes.map(n => n.id)).toEqual(input.tubes.map(t => t.id))
    for (const edge of canvas.edges) {
      expect(edge.label).toMatch(/^-?[\d.]+ (nL|μL|mL)$/)
    }
  })

  it('浓度写进节点文字：先按单位归一再挑好读单位（1000 mM 母液写成 1 M（不能写成 1 mM，也不能写成 1000000 μM））', () => {
    const input = fixtureInput(ad52)
    const canvas = toCanvasObject(input)
    const text = canvas.nodes.map(n => n.text).join('\n')
    // 「1M Mg」母液存的是 1000 mM，归一化后仍是 1000 mM——不能写成 1 mM（差 1000 倍）
    expect(text).toMatch(/Mg 1 M/)
    // 由 1000 mM 母液稀释来的中间产物是 5 mM（库里存 concentration:5 + mM）
    expect(text).toMatch(/Mg 5 mM/)
    expect(text).not.toMatch(/1000 μM/)
    expect(text).toMatch(/100 μM/)
    expect(text).toMatch(/1 μM/)
  })

  it('缺坐标时按固定网格排，结果可复现（不用 Math.random）', () => {
    const input = { ...fixtureInput(ad52), positions: [] }
    const first = toCanvasFile(input)
    const second = toCanvasFile(input)
    expect(first).toBe(second)

    const coords = parseCanvas(first).nodes.map(n => `${n.x},${n.y}`)
    expect(new Set(coords).size).toBe(coords.length)
  })
})

describe('canvasNodeText', () => {
  it('名称粗体 / 类型体积斜体 / 每条物质一行列表', () => {
    const text = canvasNodeText(
      tube({
        id: 't1',
        type: 'source',
        name: '探针储备液',
        totalVolume: 500,
        substances: [{ name: 'MgCl₂', concentration: 100, concentrationUnit: 'μM' }]
      }) as any
    )
    expect(text.split('\n')).toEqual(['**探针储备液**', '*来源试剂 · 500 μL*', '- MgCl₂ 100 μM'])
  })

  it('物质浓度按 5 mM 写（内部统一按 µM 存，导出时换档）', () => {
    const text = canvasNodeText(
      tube({
        id: 't2',
        type: 'buffer',
        name: '缓冲液',
        totalVolume: 1000,
        substances: [{ name: 'MgCl₂', concentration: 5000, concentrationUnit: 'μM' }]
      })
    )
    expect(text).toContain('MgCl₂ 5 mM')
    expect(text).toContain('1 mL')
  })
})
