/**
 * 画布节点上「文字长什么样」的**唯一**出处。
 *
 * 以前这两处在 `components/TubeNode.tsx` 里裸拼：
 *   `{substance.concentration} {substance.concentrationUnit}`  →  会写出 `1000000 μM`
 *   `${before}/${after} ${tube.remainingVolumeUnit}`            →  会写出 `20/15 μL`（后一格是预计剩余）
 * 现在统一走这里，方便单测，也保证界面与导出/讲述页用的是同一套单位写法。
 */

import type { Substance, Tube } from '@shared/types'
import { formatQuantity, formatQuantityIn, normalizeConcentration, normalizeVolume, pickDisplayUnit } from '@/core/units'

/** 成分浓度：先归一化到 µM，再选最好读的一档（1e6 µM → `1 M`） */
export function concentrationText(substance: Substance): string {
  const base = normalizeConcentration(substance.concentration, substance.concentrationUnit)
  return formatQuantity(base, 'concentration')
}

/**
 * 体积那一格怎么显示。
 *
 * - 缓冲液：`∞`（缓冲液不计量）
 * - 源试管（仓库试剂）：`总量/本轮预计剩余`——总量取**仓库正本**（仓库.yml），
 *   预计剩余 = 总量 − 本轮消耗（由 computeEndState 算好传进来）；没有结束时退回仓库余量
 * - 样本 / 废液：结束状态体积
 * - 中间产物：`目标体积/预计剩余`
 */
export interface VolumeTextInput {
  tube: Tube
  isSource: boolean
  isBuffer?: boolean
  /** 仓库正本里的总量 / 余量（单位同 tube 的 volumeUnit，通常是 µL） */
  warehouseTotalVolume?: number
  warehouseRemainingVolume?: number
  /** 结束状态（预计）剩余体积 */
  endStateVolume?: number
}

export function volumeText(input: VolumeTextInput): string {
  const { tube, isSource, isBuffer, warehouseTotalVolume, warehouseRemainingVolume, endStateVolume } = input
  const unit = tube.remainingVolumeUnit || tube.totalVolumeUnit || 'μL'

  if (isBuffer) return '∞'

  if (isSource) {
    // 总量取仓库正本；第二格是「本轮做完还剩多少」，没有结束时退回仓库余量
    const before = warehouseTotalVolume ?? tube.totalVolume
    const after = endStateVolume ?? warehouseRemainingVolume ?? tube.remainingVolume
    return pairText(before, after, unit)
  }

  if (tube.type === 'sample' || tube.type === 'waste') {
    return singleText(endStateVolume ?? 0, unit)
  }

  const target = tube.totalVolume
  const after = endStateVolume ?? 0
  return pairText(target, after, unit)
}

/** `20/20 μL`（两格共用一个单位，单位按较大的那个值选档） */
export function pairText(before: number, after: number, unit: string): string {
  const beforeBase = normalizeVolume(before, unit)
  const afterBase = normalizeVolume(after, unit)
  const displayUnit = pickDisplayUnit([beforeBase, afterBase], 'volume')
  const left = formatQuantityIn(beforeBase, 'volume', displayUnit).replace(` ${displayUnit}`, '')
  const right = formatQuantityIn(afterBase, 'volume', displayUnit).replace(` ${displayUnit}`, '')
  return `${left}/${right} ${displayUnit}`
}

/** `40 μL` / `∞` */
export function singleText(volume: number, unit: string): string {
  if (!Number.isFinite(volume)) return '∞'
  return formatQuantity(normalizeVolume(volume, unit), 'volume')
}
