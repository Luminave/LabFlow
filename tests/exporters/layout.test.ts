import { describe, expect, it } from 'vitest'

import { BUFFER_HEIGHT, BUFFER_MAX_WIDTH, BUFFER_MIN_WIDTH, canvasNodeText, measureLineWidth, measureNode, NODE_FONT_SIZE, NODE_LINE_HEIGHT, NODE_MAX_WIDTH, NODE_MIN_WIDTH, NODE_PAD_X, stripMarkdown } from '../../src/core/exporters/nodeText'
import { computeBounds, DEFAULT_SCALE_X, DEFAULT_SCALE_Y, rectsOverlap, resolveLayout } from '../../src/core/exporters/layout'
import { toProjectYml } from '../../src/core/exporters/yml'
import { toCanvasObject } from '../../src/core/exporters/canvas'
import { fixtures, tube } from '../helpers/fixtures'
import { fixtureInput } from '../helpers/projectInput'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!
const real = fixtures.find(f => f.name.includes('实际实验'))!

/** 取出一个工程里所有缓冲液的名字（只印名字那一类） */
function bufferNames(fixture: (typeof fixtures)[number]): string[] {
  return fixtureInput(fixture)
    .tubes.filter(t => t.type === 'buffer')
    .map(t => t.name || t.id)
}

/** 数一数有多少对节点叠在一起（留 0 空隙即算相交） */
function countOverlaps(nodes: { x: number; y: number; width: number; height: number }[]): number {
  let count = 0
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) if (rectsOverlap(nodes[i], nodes[j], 0)) count++
  }
  return count
}

/** 导出后任意两个节点矩形都不相交（留 0 空隙即算相交） */
function expectNoOverlap(nodes: { id: string; x: number; y: number; width: number; height: number }[]) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      expect(rectsOverlap(a, b, 0), `${a.id} 与 ${b.id} 重叠`).toBe(false)
    }
  }
}

/**
 * 独立反推「Obsidian 实际渲染需要多高」——故意不调用 nodeText 的内部函数，
 * 自己按约定重算一遍：剥掉 Markdown 标记后按 CJK 1.2 / ASCII 0.68 字宽量、粗体 ×1.05，
 * 行高 30、粗体行 +4、上下内边距 24、底部余量 40。
 * 如果实现里把常数改小了，这里会立刻失配。
 */
const TEST_CJK = 16 * 1.2
const TEST_ASCII = 16 * 0.68
const TEST_BOLD = 1.05
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

function plainOf(line: string): string {
  return line.replace(/^\s*[-*+]\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
}

function isBold(line: string): boolean {
  return /^\*\*.*\*\*$/.test(line)
}

function reverseWidth(line: string): number {
  const plain = plainOf(line)
  let width = 0
  for (const char of plain) width += WIDE.test(char) ? TEST_CJK : TEST_ASCII
  return isBold(line) ? width * TEST_BOLD : width
}

function neededHeight(text: string, width: number): number {
  const usable = Math.max(1, width - 12 * 2)
  const lines = text.split('\n')
  const wrapped = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(reverseWidth(line) / usable)), 0)
  const boldLines = lines.filter(isBold).length
  return wrapped * 30 + boldLines * 4 + 24 + 40
}

describe('节点尺寸：按内容自适应，且一定放得下', () => {
  it('所有工程：高度 ≥ 折行行数 × 30 + 粗体加高 + 64', () => {
    for (const fixture of fixtures) {
      const canvas = toCanvasObject(fixtureInput(fixture))
      for (const node of canvas.nodes) {
        // 缓冲液只印一行名字，按紧凑尺寸（56 高），单独在下面验证不裁字
        if (node.text.split('\n').length === 1) continue
        const need = neededHeight(node.text, node.width)
        expect(node.height, `${fixture.name} / ${node.text.split('\n')[0]} 需要 ${need}px，实际 ${node.height}px`).toBeGreaterThanOrEqual(need)
        expect(node.width).toBeGreaterThanOrEqual(NODE_MIN_WIDTH)
        expect(node.width).toBeLessThanOrEqual(NODE_MAX_WIDTH)
      }
    }
  })

  it('最新工程 261118-实际实验 逐框核对：没有一行被切', () => {
    const canvas = toCanvasObject(fixtureInput(real))
    expect(canvas.nodes.length).toBe(31)
    for (const node of canvas.nodes) {
      if (node.text.split('\n').length === 1) continue
      expect(node.height, `${node.text.split('\n')[0]} 需要 ${neededHeight(node.text, node.width)}px`).toBeGreaterThanOrEqual(
        neededHeight(node.text, node.width)
      )
    }
  })

  it('曾报裁的三处 + 1M Mg 都放得下', () => {
    // 1. 缓冲液管：体积是 0，只印名字（不再有「缓冲液 · 0 μL」）
    const buffer = measureNode(tube({ id: 'b', type: 'buffer', name: 'PBS-5Mg', totalVolume: 0 }) as any)
    expect(buffer.lines).toEqual(['**PBS-5Mg**'])
    // 缓冲液是紧凑尺寸：宽度够放下名字（不裁字），高度固定 56
    expect(buffer.width).toBeGreaterThanOrEqual(measureLineWidth('PBS-5Mg', true) + 24)
    expect(buffer.width).toBeLessThanOrEqual(BUFFER_MAX_WIDTH)
    expect(buffer.height).toBe(BUFFER_HEIGHT)

    // 2. 10E：名字 + 类型行 + 两条成分
    const tenE = measureNode(
      tube({
        id: 'e',
        type: 'intermediate',
        name: '10E',
        totalVolume: 20,
        substances: [
          { name: 'E1', concentration: 1, concentrationUnit: 'μM' },
          { name: 'E2', concentration: 1, concentrationUnit: 'μM' }
        ]
      }) as any
    )
    expect(tenE.lines.length).toBe(4)
    expect(tenE.height).toBeGreaterThanOrEqual(
      neededHeight('**10E**\n*中间产物 · 20 μL*\n- E1 1 μM\n- E2 1 μM', tenE.width)
    )

    // 3. 260910-Tube 5：长名字曾被折成两行
    const tube5 = measureNode(
      tube({ id: 't5', type: 'intermediate', name: '260910-Tube 5', totalVolume: 3000 }) as any
    )
    expect(tube5.height).toBeGreaterThanOrEqual(neededHeight('**260910-Tube 5**\n*中间产物 · 3 mL*', tube5.width))

    // 4. 1M Mg：`来源试剂 · 100 μL` 曾在 Obsidian 里折成两行
    const mgTube = tube({
      id: 'mg',
      type: 'source',
      name: '1M Mg',
      totalVolume: 100,
      substances: [{ name: 'Mg', concentration: 1000, concentrationUnit: 'mM' }]
    }) as any
    const mg = measureNode(mgTube)
    const mgText = '**1M Mg**\n*来源试剂 · 100 μL*\n- Mg 1 M'
    expect(canvasNodeText(mgTube)).toBe(mgText)
    expect(mg.height).toBeGreaterThanOrEqual(neededHeight(mgText, mg.width))
    // 「来源试剂 · 100 μL」这一行本身也要能单行放下（否则渲染时一定折行）
    expect(measureLineWidth('来源试剂 · 100 μL')).toBeLessThanOrEqual(mg.width - NODE_PAD_X * 2)
  })

  it('Markdown 标记不参与量宽，粗体行额外加高', () => {
    // 剥标记后宽度一致
    expect(measureLineWidth('**PBS-5Mg**')).toBeCloseTo(measureLineWidth('PBS-5Mg'), 5)
    expect(measureLineWidth('- E1 1 μM')).toBeCloseTo(measureLineWidth('E1 1 μM'), 5)
    expect(stripMarkdown('*中间产物 · 3 mL*')).toBe('中间产物 · 3 mL')
    // 粗体确实更宽（×1.05），因此粗体行的宽度严格大于同文字常规体
    expect(measureLineWidth('PBS-5Mg', true)).toBeGreaterThan(measureLineWidth('PBS-5Mg'))
  })

  it('字宽系数与行高按实机放大值', () => {
    expect(NODE_FONT_SIZE).toBe(16)
    expect(NODE_LINE_HEIGHT).toBe(30)
    // 「缓冲液」3 个 CJK 字：3 × 16 × 1.2 = 57.6px
    expect(measureLineWidth('缓冲液')).toBeCloseTo(57.6, 1)
    // 8 个 ASCII 字符：8 × 16 × 0.68 = 87.04px
    expect(measureLineWidth('ABCDEFGH')).toBeCloseTo(87.04, 1)
    // 缓冲液按内容收尺寸（见「缓冲液：按内容收尺寸」那组）
    const buffer = measureNode(tube({ id: 'b', type: 'buffer', name: 'PBS-5Mg', totalVolume: 0 }) as any)
    expect(buffer.height).toBe(BUFFER_HEIGHT)
    expect(buffer.width).toBeLessThanOrEqual(BUFFER_MAX_WIDTH)
  })
})

type Node = { id: string; x: number; y: number; width: number; height: number; text: string }

/** 按 x 把导出结果还原成「列」（同一列的 x 完全相同） */
function columnsOf(nodes: Node[]): Node[][] {
  const xs = [...new Set(nodes.map(node => node.x))].sort((a, b) => a - b)
  return xs.map(x => nodes.filter(node => node.x === x).sort((a, b) => a.y - b.y))
}

/** 相邻两列之间的横向净空（逐行比对，返回最小与最大值；没有纵向重叠时返回 null） */
function horizontalGaps(nodes: Node[]): { min: number; max: number } | null {
  const columns = columnsOf(nodes)
  const gaps: number[] = []
  for (let index = 0; index + 1 < columns.length; index++) {
    for (const left of columns[index]) {
      for (const right of columns[index + 1]) {
        const verticalOverlap = left.y < right.y + right.height && right.y < left.y + left.height
        if (!verticalOverlap) continue
        gaps.push(right.x - (left.x + left.width))
      }
    }
  }
  if (gaps.length === 0) return null
  return { min: Math.min(...gaps), max: Math.max(...gaps) }
}

/** 同一列里相邻两个节点的纵向净空 */
function verticalGaps(nodes: Node[]): { min: number; max: number } | null {
  const gaps: number[] = []
  for (const column of columnsOf(nodes)) {
    for (let index = 0; index + 1 < column.length; index++) {
      gaps.push(column[index + 1].y - (column[index].y + column[index].height))
    }
  }
  if (gaps.length === 0) return null
  return { min: Math.min(...gaps), max: Math.max(...gaps) }
}

describe('缓冲液：按内容收尺寸（v11）', () => {
  const bufferTube = (name: string) => tube({ id: 'b-' + name, type: 'buffer', name, totalVolume: 0 }) as any

  it('高度固定 56，不再是 96 的大方块', () => {
    for (const name of ['PBS', 'PBS-5Mg', '1×TBE', 'Tris-HCl pH7.4']) {
      expect(measureNode(bufferTube(name)).height, name).toBe(BUFFER_HEIGHT)
    }
    expect(BUFFER_HEIGHT).toBe(56)
  })

  it('宽度 = 名字宽 + 32（±20），且夹在 100–240 之间', () => {
    for (const name of ['PBS', 'PBS-5Mg', '1×TBE', 'Tris-HCl pH7.4']) {
      const node = measureNode(bufferTube(name))
      const textWidth = measureLineWidth(name, true)
      expect(node.width, name).toBeGreaterThanOrEqual(BUFFER_MIN_WIDTH)
      expect(node.width, name).toBeLessThanOrEqual(BUFFER_MAX_WIDTH)
      // 公式：名字宽 + 32，再夹到 100–240（夹住时以边界为准）
      const expected = Math.min(BUFFER_MAX_WIDTH, Math.max(BUFFER_MIN_WIDTH, textWidth + 32))
      expect(Math.abs(node.width - expected), name).toBeLessThanOrEqual(20)
    }
    // 名字越长越宽（没到 240 上限时）
    expect(measureNode(bufferTube('PBS-5Mg')).width).toBeGreaterThan(measureNode(bufferTube('PBS')).width)
  })

  it('现样例里所有缓冲液名字都不裁字：宽度 ≥ 文字宽 + 24', () => {
    for (const fixture of fixtures) {
      for (const name of bufferNames(fixture)) {
        const node = measureNode(bufferTube(name))
        // 独立反推：粗体 × 1.05，CJK 1.2 字宽 / ASCII 0.68 字宽
        let textWidth = 0
        for (const char of name) textWidth += WIDE.test(char) ? TEST_CJK : TEST_ASCII
        textWidth *= TEST_BOLD
        expect(node.width - textWidth, `${fixture.name} / ${name} 宽度不够`).toBeGreaterThanOrEqual(24)
      }
    }
  })

  it('导出结果里缓冲液节点的宽高就是这套紧凑尺寸', () => {
    const nodes = toCanvasObject(fixtureInput(real)).nodes as unknown as CanvasNode[]
    const buffers = nodes.filter(node => node.text.split('\n').length === 1)
    expect(buffers.length).toBeGreaterThan(0)
    for (const node of buffers) {
      expect(node.height, node.text).toBe(BUFFER_HEIGHT)
      expect(node.width, node.text).toBeLessThanOrEqual(BUFFER_MAX_WIDTH)
    }
  })

  it('非缓冲液节点规则不变：仍然最小 240 宽、按折行行数算高', () => {
    for (const fixture of fixtures) {
      const nodes = toCanvasObject(fixtureInput(fixture)).nodes as unknown as CanvasNode[]
      for (const node of nodes) {
        if (node.text.split('\n').length === 1) continue
        expect(node.width, node.text).toBeGreaterThanOrEqual(NODE_MIN_WIDTH)
        expect(node.height, node.text).toBeGreaterThanOrEqual(neededHeight(node.text, node.width))
      }
    }
  })
})

describe('布局：纯比例缩放（v10）', () => {
  type CanvasNode = { id: string; x: number; y: number; width: number; height: number; text: string }

  const canvasOf = (fixture: (typeof fixtures)[number], scale = {}) =>
    toCanvasObject(fixtureInput(fixture), scale).nodes as unknown as CanvasNode[]

  it('默认比例是 1.0× / 1.0×', () => {
    expect(DEFAULT_SCALE_X).toBe(1)
    expect(DEFAULT_SCALE_Y).toBe(1)
  })

  it('任意两点：x 先后顺序与原坐标一致，且 (Δ新 / Δ原) 对所有点对都等于 scaleX', () => {
    const input = fixtureInput(real)
    const board = new Map(input.positions.map(p => [p.tubeId, p]))
    // 只验证「放大」档：0.5× 会触发兜底推挤，Delta 比值自然不再是常数
    for (const scaleX of [1, 1.6, 2, 3, 4]) {
      const nodes = canvasOf(real, { scaleX, scaleY: 1 })
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const ax = board.get(nodes[i].id)!.x
          const bx = board.get(nodes[j].id)!.x
          // 先后顺序不变
          expect(Math.sign(nodes[i].x - nodes[j].x), `${nodes[i].id} vs ${nodes[j].id} 顺序变了`).toBe(
            Math.sign(ax - bx)
          )
          // 差值比值恒等于倍数（原差为 0 时新差也必须为 0）
          if (ax === bx) {
            expect(nodes[i].x).toBe(nodes[j].x)
          } else {
            expect((nodes[i].x - nodes[j].x) / (ax - bx)).toBeCloseTo(scaleX, 6)
          }
        }
      }
    }
  })

  it('纵向同理：y 顺序不变、Δy 比值等于 scaleY', () => {
    const input = fixtureInput(real)
    const board = new Map(input.positions.map(p => [p.tubeId, p]))
    for (const scaleY of [1, 2, 4]) {
      const nodes = canvasOf(real, { scaleX: 1, scaleY })
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const ay = board.get(nodes[i].id)!.y
          const by = board.get(nodes[j].id)!.y
          expect(Math.sign(nodes[i].y - nodes[j].y)).toBe(Math.sign(ay - by))
          if (ay !== by) expect((nodes[i].y - nodes[j].y) / (ay - by)).toBeCloseTo(scaleY, 6)
        }
      }
    }
  })

  it('1.0× 时导出的坐标逐点等于白板原坐标（宽高也不变）', () => {
    for (const fixture of fixtures) {
      const input = fixtureInput(fixture)
      const nodes = canvasOf(fixture)
      for (const node of nodes) {
        const board = input.positions.find(p => p.tubeId === node.id)!
        expect(node.x, `${fixture.name} / ${node.id} x`).toBe(board.x)
        expect(node.y, `${fixture.name} / ${node.id} y`).toBe(board.y)
        const measured = measureNode(input.tubes.find(t => t.id === node.id)!)
        expect(node.width).toBe(measured.width)
        expect(node.height).toBe(measured.height)
      }
    }
  })

  it('包围盒随比例单调变化：横向只管宽、纵向只管高', () => {
    for (const fixture of fixtures) {
      const input = fixtureInput(fixture)
      const widths = [1, 2, 3].map(scaleX => computeBounds(resolveLayout(input, { scaleX, scaleY: 1 }).tubes).width)
      expect(widths[0]).toBeLessThan(widths[1])
      expect(widths[1]).toBeLessThan(widths[2])

      const heights = [1, 2, 3].map(scaleY => computeBounds(resolveLayout(input, { scaleX: 1, scaleY }).tubes).height)
      expect(heights[0]).toBeLessThan(heights[1])
      expect(heights[1]).toBeLessThan(heights[2])
    }
  })

  // 白板原坐标本身就有互叠（261118-实际实验 34 对，框宽 240 而原 x 差只有十几像素）。
  // 纯比例缩放不挪相对关系，所以放大只会「减少」重叠，3× 时归零。
  it('放大不会新增重叠：3× 时完全无重叠', () => {
    for (const fixture of fixtures) {
      const base = countOverlaps(canvasOf(fixture))
      for (const scale of [2, 3]) {
        const nodes = canvasOf(fixture, { scaleX: scale, scaleY: scale })
        expect(countOverlaps(nodes)).toBeLessThanOrEqual(base)
      }
      expectNoOverlap(canvasOf(fixture, { scaleX: 3, scaleY: 3 }))
    }
  })

  it('缩到 0.5× 也不会重叠（只推开重叠的那几对）', () => {
    for (const fixture of fixtures) {
      const nodes = canvasOf(fixture, { scaleX: 0.5, scaleY: 0.5 })
      expectNoOverlap(nodes)
    }
  })

  it('两次导出完全一致', () => {
    for (const fixture of fixtures) {
      expect(canvasOf(fixture, { scaleX: 1.7, scaleY: 1.3 })).toEqual(canvasOf(fixture, { scaleX: 1.7, scaleY: 1.3 }))
    }
  })

  it('幂等：把 2× 导出的坐标当输入、再按 1.0× 导出，结果不变', () => {
    for (const fixture of fixtures) {
      const input = fixtureInput(fixture)
      const first = canvasOf(fixture, { scaleX: 2, scaleY: 2 })
      const again = toCanvasObject({
        ...input,
        positions: first.map(node => ({ tubeId: node.id, x: node.x, y: node.y }))
      }).nodes as unknown as CanvasNode[]
      expect(again.map(node => ({ id: node.id, x: node.x, y: node.y }))).toEqual(
        first.map(node => ({ id: node.id, x: node.x, y: node.y }))
      )
    }
  })

  it('261118-实际实验 在 1.0 / 2.0 / 3.0× 的包围盒（写进测试防回归）', () => {
    const input = fixtureInput(real)
    const table = [1, 2, 3].map(scale => {
      const nodes = canvasOf(real, { scaleX: scale, scaleY: scale })
      const bounds = computeBounds(nodes)
      return { scale, width: bounds.width, height: bounds.height }
    })
    expect(table.map(row => row.width)).toEqual([1095, 1950, 2805])
    expect(table.map(row => row.height)).toEqual([1448, 2738, 4028])
  })

  it('抽查 5 个节点：2.0× 的坐标 == 原坐标按比例折算', () => {
    const input = fixtureInput(real)
    const nodes = canvasOf(real, { scaleX: 2, scaleY: 2 })
    const bounds = computeBounds(
      resolveLayout(input, { scaleX: 1, scaleY: 1 }).tubes
    )
    const samples = nodes.slice(0, 5)
    for (const node of samples) {
      const board = input.positions.find(p => p.tubeId === node.id)!
      expect(node.x).toBeCloseTo(bounds.minX + (board.x - bounds.minX) * 2, 1)
      expect(node.y).toBeCloseTo(bounds.minY + (board.y - bounds.minY) * 2, 1)
    }
  })

  it('白板原坐标写进 .yml 备查', () => {
    const yml = toProjectYml(fixtureInput(real))
    expect(yml).toMatch(/boardX: /)
    expect(yml).toMatch(/boardY: /)
  })
})
