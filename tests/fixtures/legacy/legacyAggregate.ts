/**
 * 改动前的「移入移出体积汇总」实现快照（对拍基线，勿改）。
 *
 * 逐字取自 git HEAD 的以下三处（三处循环体完全相同，此处取其一份）：
 * - src/renderer/src/pages/ExperimentPage.tsx  calculateEndStateDynamic 内循环
 * - src/renderer/src/stores/experimentStore.ts  calculateEndState / completeExperiment 内循环
 */
export interface LegacyFlows {
  tubeInVolume: Map<string, number>
  tubeOutVolume: Map<string, number>
}

export function legacyAggregate(
  connections: { fromTubeId: string; toTubeId: string; volume: number }[]
): LegacyFlows {
  const tubeInVolume = new Map<string, number>()
  const tubeOutVolume = new Map<string, number>()

  for (const conn of connections) {
    if (conn.volume <= 0) continue
    // 移入
    tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
    // 移出
    tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
  }

  return { tubeInVolume, tubeOutVolume }
}
