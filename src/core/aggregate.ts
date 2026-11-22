/**
 * 移入 / 移出体积汇总（**一律以 µL 为基准单位**）
 *
 * 合并前有 4 份等价副本：
 * - pages/ExperimentPage.tsx 的 calculateEndStateDynamic 内循环
 * - pages/ExperimentPage.tsx 的 handleCheckExperiment 内循环
 * - stores/experimentStore.ts 的 calculateEndState 内循环
 * - stores/experimentStore.ts 的 completeExperiment 内循环
 *
 * 累加顺序与改动前一致（按 connections 数组顺序、跳过 volume <= 0），因此浮点结果逐位相同。
 *
 * 单位（2026-11 修）：每条连线的 `volume` 先按自己的 `volumeUnit` 归一到 µL 再加。
 * 历史数据都是 µL，归一化后数值不变；缺 `volumeUnit` 时按 µL 处理（老调用方兼容）。
 */

import type { FlowTotals, TransferConnection, VolumeUnit } from './schema'
import { normalizeVolume } from './units'

/** 汇总只需要连线的这几个字段，validate 里会用只含这些字段的临时对象 */
export type FlowConnection = Pick<TransferConnection, 'fromTubeId' | 'toTubeId' | 'volume'> & {
  volumeUnit?: VolumeUnit
}

const BASE_VOLUME_UNIT = 'μL'

/** 一条连线折成 µL 的移液体积 */
export function baseFlowVolume(conn: FlowConnection): number {
  return normalizeVolume(conn.volume, conn.volumeUnit || BASE_VOLUME_UNIT)
}

export function aggregateFlows(connections: FlowConnection[]): FlowTotals {
  const inVolume = new Map<string, number>()
  const outVolume = new Map<string, number>()

  for (const conn of connections) {
    if (conn.volume <= 0) continue
    const volume = baseFlowVolume(conn)
    inVolume.set(conn.toTubeId, (inVolume.get(conn.toTubeId) || 0) + volume)
    outVolume.set(conn.fromTubeId, (outVolume.get(conn.fromTubeId) || 0) + volume)
  }

  return { inVolume, outVolume }
}

/** 某试管移入总量（µL，等价于 aggregateFlows().inVolume.get(id) || 0） */
export function inVolumeOf(totals: FlowTotals, tubeId: string): number {
  return totals.inVolume.get(tubeId) || 0
}

/** 某试管移出总量（µL，等价于 aggregateFlows().outVolume.get(id) || 0） */
export function outVolumeOf(totals: FlowTotals, tubeId: string): number {
  return totals.outVolume.get(tubeId) || 0
}
