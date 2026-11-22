/**
 * 移入 / 移出体积汇总（单位：与连线体积同单位，界面上实际都是 μL）
 *
 * 合并前有 4 份等价副本：
 * - pages/ExperimentPage.tsx 的 calculateEndStateDynamic 内循环
 * - pages/ExperimentPage.tsx 的 handleCheckExperiment 内循环
 * - stores/experimentStore.ts 的 calculateEndState 内循环
 * - stores/experimentStore.ts 的 completeExperiment 内循环
 *
 * 累加顺序与改动前一致（按 connections 数组顺序、跳过 volume <= 0），因此浮点结果逐位相同。
 */

import type { FlowTotals, TransferConnection } from './schema'

/** 汇总只需要连线的三个字段，validate 里会用只含这些字段的临时对象 */
export type FlowConnection = Pick<TransferConnection, 'fromTubeId' | 'toTubeId' | 'volume'>

export function aggregateFlows(connections: FlowConnection[]): FlowTotals {
  const inVolume = new Map<string, number>()
  const outVolume = new Map<string, number>()

  for (const conn of connections) {
    if (conn.volume <= 0) continue
    inVolume.set(conn.toTubeId, (inVolume.get(conn.toTubeId) || 0) + conn.volume)
    outVolume.set(conn.fromTubeId, (outVolume.get(conn.fromTubeId) || 0) + conn.volume)
  }

  return { inVolume, outVolume }
}

/** 某试管移入总量（等价于 aggregateFlows().inVolume.get(id) || 0） */
export function inVolumeOf(totals: FlowTotals, tubeId: string): number {
  return totals.inVolume.get(tubeId) || 0
}

/** 某试管移出总量（等价于 aggregateFlows().outVolume.get(id) || 0） */
export function outVolumeOf(totals: FlowTotals, tubeId: string): number {
  return totals.outVolume.get(tubeId) || 0
}
