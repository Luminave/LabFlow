/**
 * 改动前的「结束状态」实现快照（对拍基线，勿改）。
 *
 * 三个不一致版本，逐字取自 git HEAD：
 * 1. legacyEndStateFromStore   —— src/renderer/src/stores/experimentStore.ts:1119-1173（completeExperiment 内联，查仓库口径）★ 内核采用这一版
 * 2. legacyEndStateFromStoreFn —— src/renderer/src/stores/experimentStore.ts:73 模块级 calculateEndState（用 tube.remainingVolume）
 * 3. legacyEndStateFromPage    —— src/renderer/src/pages/ExperimentPage.tsx:93 calculateEndStateDynamic（查仓库，且把 totalVolume 改成 endVolume）
 */
import type { Tube, TransferConnection } from '../../../../src/shared/types'

/** 改动前的 roundVolume（src/shared/utils/calculations.ts） */
function roundVolume(volume: number): number {
  if (!isFinite(volume)) return volume
  return Math.round(volume * 1000) / 1000
}

/** ★ 内核采用的版本：查仓库口径 */
export function legacyEndStateFromStore(
  currentTubes: Tube[],
  connections: TransferConnection[],
  warehouseTubesForInit: Tube[]
): Tube[] {
  // 计算结束状态
  const tubeInVolume = new Map<string, number>()
  const tubeOutVolume = new Map<string, number>()

  for (const conn of connections) {
    if (conn.volume <= 0) continue
    tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
    tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
  }

  return currentTubes.map(tube => {
    const inVolume = tubeInVolume.get(tube.id) || 0
    const outVolume = tubeOutVolume.get(tube.id) || 0

    // 计算结束体积
    let endVolume: number
    if (tube.type === 'source') {
      // 原料试管：使用仓库中的初始体积 - 移出体积
      const whTube = warehouseTubesForInit.find(t => t.id === tube.id)
      const initialVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
      endVolume = roundVolume(Math.max(0, initialVolume - outVolume))
    } else if (tube.type === 'buffer') {
      // 缓冲液：保持不变
      endVolume = tube.remainingVolume
    } else if (tube.type === 'intermediate') {
      // 中间产物：判断是从仓库添加的还是新创建的
      const whTube = warehouseTubesForInit.find(t => t.id === tube.id)
      const isInWarehouse = !!whTube

      if (isInWarehouse) {
        // 从仓库添加的中间产物：当作原料处理
        const initialVolume = whTube.remainingVolume
        endVolume = roundVolume(Math.max(0, initialVolume - outVolume))
      } else {
        // 新创建的中间产物：移入体积 - 移出体积
        endVolume = roundVolume(Math.max(0, inVolume - outVolume))
      }
    } else {
      endVolume = tube.remainingVolume
    }

    // 浓度保持不变（用户设定的值）
    const endSubstances = tube.substances

    // totalVolume：保留首次创建体积
    let preservedTotalVolume = tube.totalVolume
    if (tube.type === 'intermediate') {
      const whTube = warehouseTubesForInit.find(t => t.id === tube.id)
      if (!whTube) {
        // 新创建的中间产物：totalVolume = 移入体积
        preservedTotalVolume = inVolume > 0 ? inVolume : tube.totalVolume
      }
    }

    return {
      ...tube,
      remainingVolume: endVolume,
      totalVolume: preservedTotalVolume,
      substances: endSubstances,
      updatedAt: new Date().toISOString()
    }
  })
}

/** 版本 2：store 模块级 calculateEndState（用 tube.remainingVolume，不看仓库） */
export function legacyEndStateFromStoreFn(tubes: Tube[], connections: TransferConnection[]): Tube[] {
  const tubeInVolume = new Map<string, number>()
  const tubeOutVolume = new Map<string, number>()

  for (const conn of connections) {
    if (conn.volume <= 0) continue
    tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
    tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
  }

  return tubes.map(tube => {
    const inVolume = tubeInVolume.get(tube.id) || 0
    const outVolume = tubeOutVolume.get(tube.id) || 0

    let endVolume: number
    if (tube.type === 'source') {
      endVolume = roundVolume(Math.max(0, tube.remainingVolume - outVolume))
    } else if (tube.type === 'buffer') {
      endVolume = tube.remainingVolume
    } else {
      endVolume = roundVolume(Math.max(0, inVolume - outVolume))
    }

    const endSubstances = tube.substances
    const preservedTotalVolume = tube.totalVolume

    return {
      ...tube,
      remainingVolume: endVolume,
      totalVolume: preservedTotalVolume,
      substances: endSubstances
    }
  })
}

/** 版本 3：页面版 calculateEndStateDynamic（查仓库，totalVolume 改成 endVolume） */
export function legacyEndStateFromPage(
  tubes: Tube[],
  conns: TransferConnection[],
  warehouseTubes: Tube[]
): Tube[] {
  const tubeInVolume = new Map<string, number>()
  const tubeOutVolume = new Map<string, number>()

  for (const conn of conns) {
    if (conn.volume <= 0) continue
    tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
    tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
  }

  return tubes.map(tube => {
    const inVolume = tubeInVolume.get(tube.id) || 0
    const outVolume = tubeOutVolume.get(tube.id) || 0

    // 计算结束体积
    let endVolume: number
    if (tube.type === 'source') {
      // 原料试管:使用仓库中的初始体积 - 移出体积
      const whTube = warehouseTubes.find(t => t.id === tube.id)
      const initialVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
      endVolume = roundVolume(Math.max(0, initialVolume - outVolume))
    } else if (tube.type === 'buffer') {
      // 缓冲液:保持不变
      endVolume = tube.remainingVolume
    } else if (tube.type === 'intermediate') {
      // 中间产物:判断是从仓库添加的还是新创建的
      const whTube = warehouseTubes.find(t => t.id === tube.id)
      const isInWarehouse = !!whTube

      if (isInWarehouse) {
        // 从仓库添加的中间产物:当作原料处理
        const initialVolume = whTube.remainingVolume
        endVolume = roundVolume(Math.max(0, initialVolume - outVolume))
      } else {
        // 新创建的中间产物:移入体积 - 移出体积
        endVolume = roundVolume(Math.max(0, inVolume - outVolume))
      }
    } else {
      endVolume = tube.remainingVolume
    }

    // 浓度保持不变
    return {
      ...tube,
      remainingVolume: endVolume,
      totalVolume: endVolume
    }
  })
}
