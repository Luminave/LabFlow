/**
 * 改动前的「物质混合」相关实现快照（对拍基线，勿改）。
 *
 * 逐字取自 git HEAD 的五处：
 * 1. legacyRecalculateTargetTube —— src/renderer/src/pages/ExperimentPage.tsx:767（用本地 concToUM 单位表）
 * 2. legacyCalculateForTubeSolve —— src/renderer/src/pages/ExperimentPage.tsx:945（反算每支源试管体积）
 * 3. legacyNarratorMixture       —— src/renderer/src/pages/NarratorPage.tsx:80（无单位归一化，此处就是 bug）
 * 4. legacyTransferInBlend       —— src/renderer/src/stores/experimentStore.ts:1030（tube_histories 浓度混合）
 * 5. legacyAddConnectionMerge    —— src/renderer/src/stores/experimentStore.ts:866（连线时补 0 浓度占位）
 */
import type { ConcentrationUnit, Substance, Tube, TransferConnection } from '../../../../src/shared/types'

/** 改动前的页面本地单位表（ExperimentPage.tsx:764） */
const concToUM: Record<string, number> = {
  nM: 0.001,
  'μM': 1,
  mM: 1000,
  M: 1000000
}

/** 1. 目标试管混合浓度重算（页面 recalculateTargetTube 的纯计算部分） */
export function legacyRecalculateTargetTube(
  connections: TransferConnection[],
  currentTubes: Tube[],
  targetId: string
): { newSubstances: Substance[]; totalVolume: number } {
  const incomingConns = connections.filter(c => c.toTubeId === targetId)

  let totalVolume = 0
  const substanceMap = new Map<string, { moles: number; unit: string }>()

  for (const conn of incomingConns) {
    const vol = conn.volume
    if (vol === 0) continue

    const sourceTube = currentTubes.find(t => t.id === conn.fromTubeId)
    if (!sourceTube || sourceTube.type === 'buffer') continue

    totalVolume += vol

    for (const sub of sourceTube.substances) {
      const concInUM = sub.concentration * (concToUM[sub.concentrationUnit] || 1)
      const moles = concInUM * vol
      const existing = substanceMap.get(sub.name)
      if (existing) {
        existing.moles += moles
      } else {
        substanceMap.set(sub.name, { moles, unit: sub.concentrationUnit })
      }
    }
  }

  const newSubstances: Substance[] = []
  substanceMap.forEach((data, name) => {
    const finalConcUM = data.moles / totalVolume
    const factor = concToUM[data.unit as string] || 1
    newSubstances.push({
      name,
      concentration: Math.round((finalConcUM / factor) * 1000) / 1000,
      concentrationUnit: data.unit as ConcentrationUnit
    })
  })

  return { newSubstances, totalVolume }
}

/** 2. 反算每支源试管需要的体积（页面 calculateForTube 的纯计算部分） */
export function legacyCalculateForTubeSolve(
  targetSubstances: Substance[],
  targetVolume: number,
  incomingConns: TransferConnection[],
  freshCurrentTubes: Tube[]
): { sourceTubeVolumes: Map<string, number>; missingSubstances: string[] } {
  const sourceTubeVolumes = new Map<string, number>()
  const missingSubstances: string[] = []

  for (const targetSub of targetSubstances) {
    if (!targetSub.name || targetSub.concentration <= 0) continue

    let foundSource = false
    for (const conn of incomingConns) {
      const sourceTube = freshCurrentTubes.find(t => t.id === conn.fromTubeId)
      if (!sourceTube || sourceTube.type === 'buffer') continue

      const sourceSub = sourceTube.substances.find(s => s.name === targetSub.name)
      if (!sourceSub) continue

      // 标准化浓度到μM再计算
      const targetConcUM = targetSub.concentration * (concToUM[targetSub.concentrationUnit] || 1)
      const sourceConcUM = sourceSub.concentration * (concToUM[sourceSub.concentrationUnit] || 1)
      const requiredVolume = (targetConcUM * targetVolume) / sourceConcUM
      const existingVolume = sourceTubeVolumes.get(conn.fromTubeId) || 0
      sourceTubeVolumes.set(conn.fromTubeId, Math.max(existingVolume, requiredVolume))

      foundSource = true
      break
    }

    if (!foundSource) {
      missingSubstances.push(targetSub.name)
    }
  }

  return { sourceTubeVolumes, missingSubstances }
}

export interface LegacyNarratorMixture {
  totalVolume: number
  /** 与 NarratorPage 的显示字符串一一对应：`浓度字符串 成分名` */
  substanceInfo: string[]
  /** 结构化结果，便于断言浓度数值 */
  entries: { name: string; totalAmount: number; unit: string; concentration: number }[]
}

/** 3. 讲述者页面的混合计算 + 浓度格式化（无单位归一化） */
export function legacyNarratorMixture(
  connections: TransferConnection[],
  tubes: Tube[],
  narratorTubeId: string
): LegacyNarratorMixture {
  const incomingConnections = connections
    .filter(conn => conn.toTubeId === narratorTubeId)
    .sort((a, b) => b.volume - a.volume) // 大体积优先

  let totalVolume = 0
  const substanceMap = new Map<string, { name: string; totalAmount: number; unit: string }>()

  incomingConnections.forEach(conn => {
    const sourceTube = tubes.find(t => t.id === conn.fromTubeId)
    if (!sourceTube) return

    totalVolume += conn.volume

    sourceTube.substances.forEach(sub => {
      const amount = sub.concentration * conn.volume
      const existing = substanceMap.get(sub.name)
      if (existing) {
        existing.totalAmount += amount
      } else {
        substanceMap.set(sub.name, {
          name: sub.name,
          totalAmount: amount,
          unit: sub.concentrationUnit
        })
      }
    })
  })

  const substanceInfo: string[] = []
  const entries: { name: string; totalAmount: number; unit: string; concentration: number }[] = []
  substanceMap.forEach(sub => {
    if (totalVolume > 0) {
      const finalConcentration = sub.totalAmount / totalVolume
      let concStr = ''
      if (finalConcentration >= 1) {
        concStr = `${finalConcentration.toFixed(1)}${sub.unit}`
      } else if (finalConcentration >= 0.001) {
        concStr = `${(finalConcentration * 1000).toFixed(1)}n${sub.unit.substring(1)}`
      } else {
        concStr = `${finalConcentration.toFixed(4)}${sub.unit}`
      }
      substanceInfo.push(`${concStr} ${sub.name}`)
      entries.push({
        name: sub.name,
        totalAmount: sub.totalAmount,
        unit: sub.unit,
        concentration: finalConcentration
      })
    }
  })

  return { totalVolume, substanceInfo, entries }
}

/** 4. tube_histories 的 transfer_in 浓度混合 */
export function legacyTransferInBlend(
  currentSubstances: Substance[],
  currentVolume: number,
  sourceSubstances: Substance[],
  connVolume: number,
  targetIsIntermediate: boolean,
  targetTubeSubstances: Substance[],
  sourceIsBuffer: boolean
): Substance[] {
  let newSubstances = currentSubstances

  if (targetIsIntermediate) {
    newSubstances = targetTubeSubstances
  } else if (!sourceIsBuffer && sourceSubstances.length > 0) {
    newSubstances = [...currentSubstances]
    for (const sub of sourceSubstances) {
      const existing = newSubstances.find(s => s.name === sub.name)
      if (existing) {
        const totalMoles = existing.concentration * currentVolume + sub.concentration * connVolume
        existing.concentration = Math.round(totalMoles / (currentVolume + connVolume) * 1000) / 1000
      } else {
        newSubstances.push({
          name: sub.name,
          concentration: Math.round((sub.concentration * connVolume) / (currentVolume + connVolume) * 1000) / 1000,
          concentrationUnit: sub.concentrationUnit
        })
      }
    }
  }

  return newSubstances
}

/** 5. 连线时给目标中间产物补 0 浓度占位 */
export function legacyAddConnectionMerge(targetSubstances: Substance[], sourceSubstances: Substance[]): Substance[] {
  const existingSubstances = [...targetSubstances]
  for (const sub of sourceSubstances) {
    const existing = existingSubstances.find(s => s.name === sub.name)
    if (!existing) {
      existingSubstances.push({
        name: sub.name,
        concentration: 0,
        concentrationUnit: sub.concentrationUnit
      })
    }
  }
  return existingSubstances
}
