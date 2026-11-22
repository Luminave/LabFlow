/**
 * 画布坐标：**纯比例缩放**（主人 2026-11-22 定，v10）。
 *
 *    newX = minX + (x - minX) × scaleX
 *    newY = minY + (y - minY) × scaleY
 *
 * 以左上角为锚点：1.0× 时逐点等于原坐标，放大后整体向右/向下展开。
 * 节点宽高不变；**不分列、不排行、不聚类、不重排、不对齐网格**——
 * 谁在谁左边、谁在谁上面、彼此的倾斜角度全部保持原样。
 *
 * 唯一的例外是兜底：scale < 1 可能把框压到一起，这时只对**相互重叠的那几对**
 * 做最小位移（间隙 OVERLAP_GAP），其余节点一动不动；scale ≥ 1 绝不触发任何推挤。
 *
 * 同一输入必得同一张图（无随机数）；把导出坐标当输入再导一遍结果不变。
 * 没有任何坐标的管才用确定性的网格兜底（不用 Math.random）。
 */

import type { Tube, TubePosition } from '../schema'
import { measureNode } from './nodeText'
import type { ProjectInput } from './types'

/** 默认比例：1.0× = 完全按白板原样 */
export const DEFAULT_SCALE_X = 1
export const DEFAULT_SCALE_Y = 1

/** 兜底推挤时给的最小间隙（像素） */
export const OVERLAP_GAP = 40

/** 比例设置：两个方向各一个倍数，不传就是 1.0× */
export interface ScaleOptions {
  scaleX?: number
  scaleY?: number
}

/** 节点类型的通用形状（画布与布局都用得到） */
export interface BoxLike {
  x: number
  y: number
  width: number
  height: number
}

/** 整张图的包围盒；没有节点时全是 0 */
export function computeBounds(nodes: BoxLike[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  const minX = Math.min(...nodes.map(node => node.x))
  const minY = Math.min(...nodes.map(node => node.y))
  const maxX = Math.max(...nodes.map(node => node.x + node.width))
  const maxY = Math.max(...nodes.map(node => node.y + node.height))
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** 缺坐标时的兜底网格：每行几个、步长多少 */
export const FALLBACK_COLUMNS = 3
export const FALLBACK_STEP_X = 400
export const FALLBACK_STEP_Y = 260

/** 排布后的节点：试管 + 坐标 + 尺寸 */
export interface LaidOutTube {
  tube: Tube
  x: number
  y: number
  width: number
  height: number
  /** 坐标来源：stored = 有白板原坐标；grid = 原本没有坐标，按网格兜底 */
  source: 'stored' | 'grid'
}

export interface LayoutResult {
  tubes: LaidOutTube[]
  /** 本次写出的坐标 */
  filledPositions: TubePosition[]
}

/** 矩形（画布坐标按左上角记） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 两个矩形是否相交（留 gap 空隙）；边贴边不算相交 */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  )
}

/** 读取工程里存的白板坐标 */
export function storedPosition(positions: TubePosition[], tubeId: string): { x: number; y: number } | null {
  const found = positions.find(p => p.tubeId === tubeId)
  if (!found) return null
  if (!Number.isFinite(found.x) || !Number.isFinite(found.y)) return null
  return { x: found.x, y: found.y }
}

/** 去掉浮点尾巴（缩放会算出 -375.00000000000006 这种），保留 6 位小数 */
function tidy(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6
  return rounded === 0 ? 0 : rounded
}

interface Working {
  tube: Tube
  x: number
  y: number
  width: number
  height: number
  source: 'stored' | 'grid'
}

/**
 * 兜底：只把**相互重叠**的节点对推开一点点（间隙 gap），其余节点不动。
 * 按「左 / 上」的那个为准，把「右 / 下」的那个挪到刚好不重叠的位置；
 * 每轮按固定顺序扫全表，跑到不再变化为止（有上限，绝不死循环）。
 */
function pushApart(nodes: Working[], gap: number): void {
  const order = [...nodes].sort(
    (a, b) => a.x - b.x || a.y - b.y || a.tube.id.localeCompare(b.tube.id)
  )
  const MAX_ROUNDS = 200
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = order[i]
        const b = order[j]
        if (!rectsOverlap(a, b, 0)) continue
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (overlapX <= overlapY) {
          const [left, right] = a.x <= b.x ? [a, b] : [b, a]
          const target = left.x + left.width + gap
          if (right.x < target) {
            right.x = target
            moved = true
          }
        } else {
          const [top, bottom] = a.y <= b.y ? [a, b] : [b, a]
          const target = top.y + top.height + gap
          if (bottom.y < target) {
            bottom.y = target
            moved = true
          }
        }
      }
    }
    if (!moved) break
  }
}

/**
 * 排布：按比例缩放原坐标（宽高不变），scale < 1 时对重叠对做最小位移兜底。
 */
export function resolveLayout(input: ProjectInput, options: ScaleOptions = {}): LayoutResult {
  const scaleX = Number.isFinite(options.scaleX) ? (options.scaleX as number) : DEFAULT_SCALE_X
  const scaleY = Number.isFinite(options.scaleY) ? (options.scaleY as number) : DEFAULT_SCALE_Y

  const working: Working[] = []
  const missing: Working[] = []

  for (const tube of input.tubes) {
    const { width, height } = measureNode(tube)
    const stored = storedPosition(input.positions, tube.id)
    const node: Working = { tube, x: 0, y: 0, width, height, source: 'stored' }
    if (stored) {
      node.x = stored.x
      node.y = stored.y
    } else {
      node.source = 'grid'
      missing.push(node)
    }
    working.push(node)
  }

  // 没有原坐标的管：按确定性格位排（不用随机数），排完当作原坐标参与缩放
  if (missing.length > 0) {
    const anchors = working.filter(node => node.source === 'stored')
    const maxRight = anchors.length > 0 ? Math.max(...anchors.map(node => node.x + node.width)) : 0
    missing.forEach((node, index) => {
      node.x = maxRight + FALLBACK_STEP_X + (index % FALLBACK_COLUMNS) * FALLBACK_STEP_X
      node.y = Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_STEP_Y
    })
  }

  const bounds = computeBounds(working)

  // 纯比例缩放：以左上角为锚，1.0× 就是原样
  for (const node of working) {
    node.x = tidy(bounds.minX + (node.x - bounds.minX) * scaleX)
    node.y = tidy(bounds.minY + (node.y - bounds.minY) * scaleY)
  }

  // 只有缩小时才可能压到一起：只推重叠的那几对，其余不动
  if (scaleX < 1 || scaleY < 1) pushApart(working, OVERLAP_GAP)

  // 输出顺序与 yml 的试管顺序一致，便于人工核对
  const tubes: LaidOutTube[] = working.map(node => ({
    tube: node.tube,
    x: tidy(node.x),
    y: tidy(node.y),
    width: node.width,
    height: node.height,
    source: node.source
  }))

  return {
    tubes,
    filledPositions: tubes.map(node => ({ tubeId: node.tube.id, x: node.x, y: node.y }))
  }
}

/** Obsidian 画布的四条边 */
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * 由两个节点的相对位置决定连线从哪条边出发、进哪条边。
 * 水平距离更大时走左右，否则走上下；相同坐标时默认右→左。
 */
export function connectionSides(
  from: { x: number; y: number; width?: number; height?: number },
  to: { x: number; y: number; width?: number; height?: number }
): { fromSide: CanvasSide; toSide: CanvasSide } {
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' }
  }
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' }
}
