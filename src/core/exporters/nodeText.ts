/**
 * 画布节点里的文字，以及按文字估算节点尺寸。
 *
 * 单独成文件是为了让 layout.ts（算尺寸、排位置）和 canvas.ts（写 .canvas）共用同一份文字，
 * 避免两边各写一遍导致「量出来的高度和画出来的内容不一致」。
 *
 * 排版用 Obsidian canvas 支持的 Markdown（第二版起）：
 *   `**管名**`        粗体，第一眼看到的是名字
 *   `*类型 · 体积*`   斜体，弱化
 *   `- 成分 浓度`     无序列表，逐条一行
 * 量宽高时必须**先剥掉标记符号**（`**`、`*`、`- ` 不占渲染宽度），否则会把框算宽；
 * 但粗体字形本身比常规体稍宽、行高也略高，所以粗体行额外乘一个安全系数。
 *
 * ⚠️ 尺寸常数怎么来的（改之前先看这条）：
 * 全部是在 **Obsidian 1.15 实机**里，把导出的 .canvas 打开、看哪一行被裁，一版一版逼出来的。
 * 早期按「CJK 1 字宽 / ASCII 0.55 字宽、字号 14」估算，结果几乎每个框的最后一行都被裁——
 * 因为 Obsidian 的实际排版比等宽假设宽得多，含数字 + `μ` 的串尤其明显（如 `来源试剂 · 100 μL`）。
 * 现在的系数是留了余量的：CJK 1.2 字宽、ASCII 0.68 字宽、宽度再乘 1.1。
 * 结论：**宁可框略大，也不能裁字**；改小任何一个系数前，先在 Obsidian 里重新验一遍。
 */

import type { Tube } from '../schema'
import { substanceText, tubeTotalText } from './quantity'

/** 试管类型的中文标签（与讲述者页/实验页的说法一致） */
export const TYPE_LABELS: Record<string, string> = {
  source: '来源试剂',
  intermediate: '中间产物',
  buffer: '缓冲液',
  sample: '样本',
  waste: '废液'
}

/** 节点里的一行，带排版角色（决定是否粗体、量宽时怎么算） */
export interface NodeLine {
  /** 写进 .canvas 的文字（含 Markdown 标记） */
  text: string
  /** 量宽度用的纯文字（已剥掉标记符号） */
  plain: string
  bold?: boolean
}

/**
 * 缓冲液判定。
 * 主条件 type === 'buffer'；type 缺失/认不出来时才用 selectedBuffer 兜底。
 * 注意：中间产物也会带 selectedBuffer（记录这一步用的是哪瓶缓冲液），不能当缓冲液。
 */
export function isBufferTube(tube: Tube): boolean {
  if (tube.type === 'buffer') return true
  if (!tube.type || !TYPE_LABELS[tube.type as string]) return !!tube.selectedBuffer
  return false
}

/**
 * 节点内容：
 * - 名字：粗体一行
 * - 类型 · 体积：斜体一行；缓冲液的体积是 0（用量记在连线上，节点本身没有固定体积），此时只印名字
 * - 物质：每条一行无序列表
 */
export function tubeNodeLines(tube: Tube): string[] {
  return nodeLines(tube).map(line => line.text)
}

/** 带排版信息的行（canvas.ts 与 measureNode 共用） */
export function nodeLines(tube: Tube): NodeLine[] {
  const name = tube.name || tube.id
  const lines: NodeLine[] = [{ text: `**${name}**`, plain: name, bold: true }]

  const volume = tubeTotalText(tube)
  const isBuffer = isBufferTube(tube)
  const volumeIsZero = /^0(\.0+)?\s/.test(volume)
  if (!(isBuffer && volumeIsZero)) {
    const meta = [TYPE_LABELS[tube.type] || tube.type, volume].filter(Boolean).join(' · ')
    lines.push({ text: `*${meta}*`, plain: meta })
  }

  for (const sub of tube.substances || []) {
    const substance = substanceText(sub)
    lines.push({ text: `- ${substance}`, plain: substance })
  }
  if (tube.notes) lines.push({ text: tube.notes, plain: tube.notes })
  return lines
}

/** 节点文字（多行，含 Markdown 标记） */
export function canvasNodeText(tube: Tube): string {
  return tubeNodeLines(tube).join('\n')
}

/**
 * 以下参数全部按 Obsidian 1.15 的实测排版，并整体留足余量（见文件头注释）：
 * 字号 16px；字宽 CJK 1.2 字宽、ASCII 0.68 字宽；算出的宽度再乘 1.1。
 */
export const NODE_FONT_SIZE = 16

/** 字宽系数：实测 Obsidian 的 16px 字体比等宽估算宽得多 */
const CJK_WIDTH_RATIO = 1.2
const ASCII_WIDTH_RATIO = 0.68

/** 宽度安全系数 */
const WIDTH_SAFETY = 1.1

/** 粗体字形比常规体略宽，单独再加一点 */
const BOLD_WIDTH_RATIO = 1.05

/** 行高（像素） */
export const NODE_LINE_HEIGHT = 30

/** 粗体行比常规行高一点（实测多出约 4px） */
const BOLD_LINE_EXTRA = 4

/** 左右内边距（像素）；整体放宽后 12 */
export const NODE_PAD_X = 12

/** 上下内边距（每侧 12px）；加上 NODE_EXTRA_HEIGHT 的底部余量，合起来 64px */
export const NODE_PAD_Y = 12
export const NODE_EXTRA_HEIGHT = 40

/** 尺寸上下限：最小宽度 240（`来源试剂 · 100 μL` 这种行才放得下） */
export const NODE_MIN_WIDTH = 240
export const NODE_MAX_WIDTH = 460
export const NODE_MIN_HEIGHT = 96
export const NODE_MAX_HEIGHT = 720

/**
 * 缓冲液的紧凑尺寸（只印名字那一类）。
 * 一个 `PBS` 只占一行字，套用 240×96 的通用下限就成了一个大方块，白板上全是空框，
 * 所以单独按内容收：宽 = 名字宽 + 左右内边距 24 + 余量 8，夹到 100–240；高固定 56（单行）。
 * 名字长（`PBS-5Mg`、`1×TBE`）会按公式自动变宽，上限 240 仍然放得下。
 */
export const BUFFER_MIN_WIDTH = 100
export const BUFFER_MAX_WIDTH = 240
export const BUFFER_HEIGHT = 56
const BUFFER_PAD_X = 24
const BUFFER_WIDTH_SLACK = 8

/** 宽字符（CJK、全角标点）按 1.2 字宽算，其余按 0.68 */
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

/**
 * 剥掉 Markdown 标记，只留下会占宽度的文字。
 * `**粗体**`、`*斜体*`、`- 列表项` 的符号本身不占渲染宽度。
 */
export function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
}

/** 一行文字的估算宽度（像素）：CJK 1.2 字宽，ASCII 0.68 字宽；传含标记的行会自动剥掉 */
export function measureLineWidth(line: string, bold = false): number {
  const plain = stripMarkdown(line)
  let width = 0
  for (const char of plain) {
    width += WIDE_CHAR.test(char)
      ? NODE_FONT_SIZE * CJK_WIDTH_RATIO
      : NODE_FONT_SIZE * ASCII_WIDTH_RATIO
  }
  return bold ? width * BOLD_WIDTH_RATIO : width
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 按给定宽度折行后占几行（Obsidian 中文会按框宽折行） */
export function wrappedLineCount(widths: number[], width: number): number {
  const usable = Math.max(1, width - NODE_PAD_X * 2)
  return widths.reduce((sum, lineWidth) => sum + Math.max(1, Math.ceil(lineWidth / usable)), 0)
}

/** 内容在给定行数下需要的高度：行数 × 30 + 64（上下内边距 + 底部余量） */
export function requiredHeight(lineCount: number, boldLines = 0): number {
  return lineCount * NODE_LINE_HEIGHT + boldLines * BOLD_LINE_EXTRA + NODE_PAD_Y * 2 + NODE_EXTRA_HEIGHT
}

/**
 * 按内容算节点尺寸。
 * - 宽度 = 最长一行（剥掉标记后）× 1.1 + 左右内边距（夹到 240–460）
 * - 高度 = **折行后的行数** × 30 + 粗体行的额外行高 + 64
 *   宽度被上限夹住时长行会折行，所以高度按折行后的行数算，否则字会溢出框外。
 * 同一根试管每次算出来都一样，不掺随机数。
 */
export function measureNode(tube: Tube): { width: number; height: number; lines: string[] } {
  const lines = nodeLines(tube)
  const widths = lines.map(line => measureLineWidth(line.plain, line.bold))
  const longest = widths.reduce((max, value) => Math.max(max, value), 0)

  // 缓冲液只有名字一行：按内容收尺寸，不套通用下限
  if (isBufferTube(tube) && lines.length === 1) {
    const width = clamp(longest + BUFFER_PAD_X + BUFFER_WIDTH_SLACK, BUFFER_MIN_WIDTH, BUFFER_MAX_WIDTH)
    return { width, height: BUFFER_HEIGHT, lines: lines.map(line => line.text) }
  }

  const width = clamp(longest * WIDTH_SAFETY + NODE_PAD_X * 2, NODE_MIN_WIDTH, NODE_MAX_WIDTH)
  const boldLines = lines.filter(line => line.bold).length
  const height = clamp(
    requiredHeight(wrappedLineCount(widths, width), boldLines),
    NODE_MIN_HEIGHT,
    NODE_MAX_HEIGHT
  )
  return { width, height, lines: lines.map(line => line.text) }
}
