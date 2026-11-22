/**
 * 结束状态计算 —— 三版合一，统一采用「查仓库」口径。
 *
 * 合并前三版与差异：
 * 1) stores/experimentStore.ts 的 calculateEndState（原 :73）—— 原料试管用「画布上 tube.remainingVolume」，
 *    不看仓库；仓库里已有的中间产物也被当成新建的（按 移入-移出 算）。（已删）
 * 2) pages/ExperimentPage.tsx 的 calculateEndStateDynamic（原 :93）—— 查 warehouseTubes，数值口径与 3) 相同，
 *    但把 totalVolume 也改成 endVolume。（已删，改用本模块）
 * 3) stores/experimentStore.ts completeExperiment 内联段（原 :1119-1173）—— 查 getWarehouseTubes，
 *    并保留原 totalVolume（新建中间产物时 totalVolume = 首次移入体积）。**本模块采用这一版。**
 *
 * 与 2) 的差别只在 totalVolume：本模块保留首次创建体积，2) 会把 totalVolume 改成结束体积。
 * 页面只用结果里的 remainingVolume 上色/显示，因此这个差别在界面上不可见。
 *
 * 单位（2026-11 修）：所有体积先归一到 µL 再算，算完按**该管自己的单位**写回。
 * 已知缺陷：「5 mL 试剂被 100 µL 抽走就判耗尽」就是没归一化导致的，此次一并修掉。
 */

import type { EndStateInput, Tube, TransferConnection, VolumeUnit } from './schema'
import { aggregateFlows } from './aggregate'
import { denormalizeVolume, normalizeVolume, roundVolume } from './units'

const BASE_VOLUME_UNIT: VolumeUnit = 'μL'

export interface EndStateOptions {
  /**
   * 提供则给每条结果写 updatedAt（与原 completeExperiment 一样，逐管各取一次时间）。
   * 纯计算场景不要传，保证结果可对比。
   */
  now?: () => string
}

/** 把一个「数值 + 单位」折成 µL */
function toBase(value: number, unit: VolumeUnit | undefined): number {
  return normalizeVolume(value, unit || BASE_VOLUME_UNIT)
}

/** 把 µL 结果按目标单位写回（先按 µL 四舍五入到 3 位，再换算，避免 mL 管丢精度） */
function writeBack(baseValue: number, unit: VolumeUnit | undefined): number {
  const rounded = roundVolume(Math.max(0, baseValue))
  return roundVolume(denormalizeVolume(rounded, unit || BASE_VOLUME_UNIT))
}

/**
 * 计算结束状态。
 *
 * 体积口径（与改动前一致，只是全部在 µL 基准上算）：
 * - 原料试管：仓库剩余体积（查不到则用画布上的 remainingVolume）− 移出体积，下限 0
 * - 缓冲液：不变
 * - 中间产物：在仓库里 → 仓库剩余体积 − 移出体积；不在仓库里 → 移入体积 − 移出体积
 * - 其他（上样/废液）：不变
 * 浓度不重算，沿用试管上的设定值。
 */
export function computeEndState(input: EndStateInput, opts: EndStateOptions = {}): Tube[] {
  const { inVolume: inMap, outVolume: outMap } = aggregateFlows(input.connections as TransferConnection[])

  return input.tubes.map(tube => {
    const inVolume = inMap.get(tube.id) || 0
    const outVolume = outMap.get(tube.id) || 0

    let endVolume: number
    if (tube.type === 'source') {
      const whTube = input.warehouseTubes.find(t => t.id === tube.id)
      const initialVolume = whTube
        ? toBase(whTube.remainingVolume, whTube.remainingVolumeUnit)
        : toBase(tube.remainingVolume, tube.remainingVolumeUnit)
      endVolume = writeBack(initialVolume - outVolume, tube.remainingVolumeUnit)
    } else if (tube.type === 'buffer') {
      endVolume = tube.remainingVolume
    } else if (tube.type === 'intermediate') {
      const whTube = input.warehouseTubes.find(t => t.id === tube.id)
      if (whTube) {
        endVolume = writeBack(
          toBase(whTube.remainingVolume, whTube.remainingVolumeUnit) - outVolume,
          tube.remainingVolumeUnit
        )
      } else {
        endVolume = writeBack(inVolume - outVolume, tube.remainingVolumeUnit)
      }
    } else {
      endVolume = tube.remainingVolume
    }

    let preservedTotalVolume = tube.totalVolume
    if (tube.type === 'intermediate' && !input.warehouseTubes.find(t => t.id === tube.id)) {
      preservedTotalVolume =
        inVolume > 0 ? roundVolume(denormalizeVolume(roundVolume(inVolume), tube.totalVolumeUnit || BASE_VOLUME_UNIT)) : tube.totalVolume
    }

    const next: Tube = {
      ...tube,
      remainingVolume: endVolume,
      totalVolume: preservedTotalVolume,
      substances: tube.substances
    }

    if (opts.now) next.updatedAt = opts.now()

    return next
  })
}
