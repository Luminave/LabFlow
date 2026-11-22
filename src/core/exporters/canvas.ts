/**
 * `项目.canvas` —— Obsidian 画布格式（JSON Canvas 1.0 的子集）。
 *
 * 严格只写 Obsidian 认识的键：
 *   nodes: { id, type: 'text', x, y, width, height, text, color? }
 *   edges: { id, fromNode, toNode, fromSide, toSide, label }
 * `color` 是 Obsidian 自己的预设色字段（"1"–"6"），合法键，不算自定义字段。
 * 除这七个键外不往节点里塞任何东西 —— Obsidian 重新保存会把未知键丢掉，
 * 数据真相源始终是 `项目.yml`，画布只是给人看的一张图。
 *
 * 坐标由 layout.ts 算：白板原坐标按倍数等比缩放（1.0× 就是原样），只在缩小时对重叠对做最小位移。
 */

import type { Tube } from '../schema'
import { connectionVolumeText } from './quantity'
import { canvasColorFor } from './canvasColor'
import { resolveLayout, connectionSides, type ScaleOptions } from './layout'
import { canvasNodeText, tubeNodeLines } from './nodeText'
import type { ProjectInput } from './types'

export { TYPE_LABELS, canvasNodeText, tubeNodeLines } from './nodeText'
export { tubeSubstanceColor } from './canvasColor'

export interface CanvasNode {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  text: string
  /** Obsidian 预设色 "1"–"6"；样本这类不上色的就不写这个键 */
  color?: string
}

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide: string
  toSide: string
  label: string
}

export interface CanvasFile {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** 把工程数据转成画布对象（纯数据，便于测试） */
export function toCanvasObject(input: ProjectInput, scale: ScaleOptions = {}): CanvasFile {
  const layout = resolveLayout(input, scale)
  const nodeById = new Map(layout.tubes.map(node => [node.tube.id, node]))

  const nodes: CanvasNode[] = layout.tubes.map(({ tube, x, y, width, height }) => {
    const node: CanvasNode = {
      id: tube.id,
      type: 'text',
      x,
      y,
      width,
      height,
      text: canvasNodeText(tube)
    }
    // 只按类型上色；成分色不再影响画布（.yml 里仍记原值备查）
    const color = canvasColorFor(tube.type)
    if (color) node.color = color
    return node
  })

  const edges: CanvasEdge[] = []
  for (const conn of input.connections) {
    const from = nodeById.get(conn.fromTubeId)
    const to = nodeById.get(conn.toTubeId)
    // 连线两端必须都是画布上存在的节点，否则 Obsidian 会当成坏文件
    if (!from || !to) continue
    const sides = connectionSides(from, to)
    edges.push({
      id: conn.id || `${conn.fromTubeId}->${conn.toTubeId}`,
      fromNode: conn.fromTubeId,
      toNode: conn.toTubeId,
      fromSide: sides.fromSide,
      toSide: sides.toSide,
      label: connectionVolumeText(conn)
    })
  }

  return { nodes, edges }
}

/** 生成 `项目.canvas` 文本（Obsidian 习惯 2 空格缩进） */
export function toCanvasFile(input: ProjectInput, scale: ScaleOptions = {}): string {
  return `${JSON.stringify(toCanvasObject(input, scale), null, 2)}\n`
}

/** 读回画布，只用于校验与测试（真相源是 .yml，不从画布反向载入工程） */
export function parseCanvas(text: string): CanvasFile {
  const raw = JSON.parse(text) as CanvasFile
  return raw
}
