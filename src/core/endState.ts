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
 */

import type { EndStateInput, Tube, TransferConnection } from './schema'
import { aggregateFlows } from './aggregate'
import { roundVolume } from './units'

export interface EndStateOptions {
  /**
   * 提供则给每条结果写 updatedAt（与原 completeExperiment 一样，逐管各取一次时间）。
   * 纯计算场景不要传，保证结果可对比。
   */
  now?: () => string
}

/**
 * 计算结束状态。
 *
 * 体积口径（与改动前一致）：
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
      const initialVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
      endVolume = roundVolume(Math.max(0, initialVolume - outVolume))
    } else if (tube.type === 'buffer') {
      endVolume = tube.remainingVolume
    } else if (tube.type === 'intermediate') {
      const whTube = input.warehouseTubes.find(t => t.id === tube.id)
      if (whTube) {
        endVolume = roundVolume(Math.max(0, whTube.remainingVolume - outVolume))
      } else {
        endVolume = roundVolume(Math.max(0, inVolume - outVolume))
      }
    } else {
      endVolume = tube.remainingVolume
    }

    let preservedTotalVolume = tube.totalVolume
    if (tube.type === 'intermediate' && !input.warehouseTubes.find(t => t.id === tube.id)) {
      preservedTotalVolume = inVolume > 0 ? inVolume : tube.totalVolume
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
