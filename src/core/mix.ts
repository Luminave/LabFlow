/**
 * 物质混合计算 —— 全仓库唯一的一份。
 *
 * 统一口径：先把浓度归一到 μM、体积归一到 μL（pmol = μM × μL），算完再按调用方要的单位吐出去。
 *
 * 合并前的 7 处（都在算「浓度 × 体积」这条路）：
 * - pages/ExperimentPage.tsx recalculateTargetTube（目标试管成分重算）
 * - pages/ExperimentPage.tsx calculateForTube（按目标浓度反算需要多少体积）
 * - pages/NarratorPage.tsx generateNarration（讲述者步骤里的浓度，原来没做单位归一化 → 本次修掉）
 * - stores/experimentStore.ts calculateEndState 的 tubeInSubstances（死代码，算完从不使用 → 删）
 * - stores/experimentStore.ts completeExperiment 的 tubeInSubstances（同上 → 删）
 * - stores/experimentStore.ts completeExperiment 的 transfer_in 浓度重算（唯一一处写库的）
 * - stores/experimentStore.ts addConnection 的成分名合并（只补名字，不算浓度）
 * 另：src/shared/utils/calculations.ts 的 calculateMixture 也收编到这里。
 *
 * 逐位一致的约定：同单位输入走「同单位短路」，走的是与改动前完全相同的算式，保证浮点逐位相同；
 * 只有单位不一致的输入才会真正归一化后重算 —— 那正是要修的 bug。
 */

import type { ConcentrationUnit, MixSource, MixtureEntry, Substance, Tube } from './schema'
import {
  concentrationFactor,
  normalizeConcentration,
  normalizeVolume,
  roundVolume
} from './units'

/** 摩尔累计结果（单位 pmol = μM·μL） */
export interface MolesAccumulation {
  /** 成分名 -> 累计移入摩尔量 */
  moles: Map<string, number>
  /** 成分名 -> 首次出现时记录的单位（用于按原单位输出） */
  units: Map<string, ConcentrationUnit>
  /** 累计体积（μL） */
  totalVolume: number
}

/**
 * 累加各来源的成分摩尔量（先归一化到 μM·μL）。
 * 来源顺序 = 调用方给的顺序，累加顺序与改动前一致。
 */
export function accumulateMoles(sources: MixSource[]): MolesAccumulation {
  const moles = new Map<string, number>()
  const units = new Map<string, ConcentrationUnit>()
  let totalVolume = 0

  for (const source of sources) {
    const volume = normalizeVolume(source.volume, source.volumeUnit || 'μL')
    totalVolume += volume

    for (const sub of source.substances) {
      const amount = normalizeConcentration(sub.concentration, sub.concentrationUnit) * volume
      const existing = moles.get(sub.name)
      if (existing !== undefined) {
        moles.set(sub.name, existing + amount)
      } else {
        moles.set(sub.name, amount)
        units.set(sub.name, sub.concentrationUnit)
      }
    }
  }

  return { moles, units, totalVolume }
}

/**
 * 计算混合后的各成分浓度。
 *
 * @param sources 来源列表（顺序敏感）
 * @param opts.unitMode 'first' = 每个成分按首次出现的来源单位输出（recalculateTargetTube 的口径）；
 *                      'uM' = 一律输出 μM（讲述者 / calculateMixture 的口径）
 * @param opts.decimals 结果保留小数位，默认 3
 * @param opts.round 是否四舍五入，默认 true；讲述者要原值格式化，传 false
 */
export function computeMixture(
  sources: MixSource[],
  opts: { unitMode?: 'first' | 'uM'; decimals?: number; round?: boolean } = {}
): MixtureEntry[] {
  const unitMode = opts.unitMode || 'first'
  const decimals = opts.decimals === undefined ? 3 : opts.decimals
  const doRound = opts.round === undefined ? true : opts.round
  const { moles, units, totalVolume } = accumulateMoles(sources)

  const result: MixtureEntry[] = []
  if (totalVolume === 0) return result

  moles.forEach((amount, name) => {
    const concentrationUM = amount / totalVolume
    const unit: ConcentrationUnit = unitMode === 'uM' ? 'μM' : (units.get(name) as ConcentrationUnit)
    const value = concentrationUM / concentrationFactor(unit)
    result.push({
      name,
      concentration: doRound ? roundVolume(value, decimals) : value,
      concentrationUnit: unit
    })
  })

  return result
}

/**
 * 从连线里挑出「移入某试管」的来源（recalculateTargetTube 的口径）。
 *
 * 与改动前逐字一致：按连线顺序、跳过体积恰为 0 的连线、跳过不存在的源试管和缓冲液。
 * 注意是 `vol === 0`（不是 <= 0），负数体积在改动前也会被计入，这里保持原样。
 */
export function sourcesIntoTube(
  connections: { toTubeId: string; fromTubeId: string; volume: number; volumeUnit?: Tube['totalVolumeUnit'] }[],
  tubes: Tube[],
  targetTubeId: string
): MixSource[] {
  const sources: MixSource[] = []
  for (const conn of connections) {
    if (conn.toTubeId !== targetTubeId) continue
    const vol = conn.volume
    if (vol === 0) continue
    const sourceTube = tubes.find(t => t.id === conn.fromTubeId)
    if (!sourceTube || sourceTube.type === 'buffer') continue
    sources.push({
      substances: sourceTube.substances,
      volume: vol,
      // 与改动前一致：不按连线单位换算，直接用数值
      volumeUnit: undefined
    })
  }
  return sources
}

/**
 * 两股液体混合后的浓度（写库口径：completeExperiment 的 transfer_in）。
 *
 * 同单位短路：a 与 b 单位相同、且输出也用这个单位时，算式与改动前完全相同，浮点逐位一致。
 * 单位不一致时先归一到 μM 再算 —— 这是修的 bug（原来 10 mM 当 10 μM 直接相加）。
 *
 * 不返回单位，单位由调用方决定（写库处保持原有的 concentrationUnit 不变）。
 */
export function blendConcentration(
  a: Substance,
  volumeA: number,
  b: Substance,
  volumeB: number,
  outputUnit?: ConcentrationUnit
): number {
  const unitA = concentrationFactor(a.concentrationUnit)
  const unitB = concentrationFactor(b.concentrationUnit)
  const unitOut = concentrationFactor(outputUnit || a.concentrationUnit)
  const totalVolume = volumeA + volumeB

  // 同单位短路：与原实现同一条算式
  if (unitA === unitB && unitA === unitOut) {
    return roundVolume(((a.concentration * volumeA) + (b.concentration * volumeB)) / totalVolume, 3)
  }

  const totalAmount = (a.concentration * unitA) * volumeA + (b.concentration * unitB) * volumeB
  return roundVolume((totalAmount / totalVolume) / unitOut, 3)
}

/** 反算结果：每个源试管需要的移液体积 + 找不到来源的成分名 */
export interface SolvedVolumes {
  volumes: Map<string, number>
  missingSubstances: string[]
}

/**
 * 按目标浓度反算每个源试管需要的移液体积（calculateForTube 的口径）。
 *
 * 对每种目标成分：按连线顺序找第一个含该成分的非缓冲液源试管，算出所需体积，
 * 同一源试管多次命中取最大值。与改动前一致：每个成分只认第一个命中源。
 */
export function solveRequiredVolumes(input: {
  targetSubstances: Substance[]
  targetVolume: number
  /** 来源列表，顺序 = 连线顺序 */
  sources: { tubeId: string; type: Tube['type']; substances: Substance[] }[]
}): SolvedVolumes {
  const volumes = new Map<string, number>()
  const missingSubstances: string[] = []

  for (const targetSub of input.targetSubstances) {
    if (!targetSub.name || targetSub.concentration <= 0) continue

    let foundSource = false
    for (const source of input.sources) {
      if (source.type === 'buffer') continue

      const sourceSub = source.substances.find(s => s.name === targetSub.name)
      if (!sourceSub) continue

      const targetConcUM = normalizeConcentration(targetSub.concentration, targetSub.concentrationUnit)
      const sourceConcUM = normalizeConcentration(sourceSub.concentration, sourceSub.concentrationUnit)
      const requiredVolume = (targetConcUM * input.targetVolume) / sourceConcUM

      const existingVolume = volumes.get(source.tubeId) || 0
      volumes.set(source.tubeId, Math.max(existingVolume, requiredVolume))

      foundSource = true
      break
    }

    if (!foundSource) missingSubstances.push(targetSub.name)
  }

  return { volumes, missingSubstances }
}

/**
 * 把源试管的成分名补进目标试管（addConnection 的口径：只补名字，浓度暂为 0）。
 * 返回新数组，不改原数组。
 */
export function mergeSubstancePlaceholders(existing: Substance[], incoming: Substance[]): Substance[] {
  const merged = [...existing]
  for (const sub of incoming) {
    if (!merged.find(s => s.name === sub.name)) {
      merged.push({
        name: sub.name,
        concentration: 0,
        concentrationUnit: sub.concentrationUnit
      })
    }
  }
  return merged
}
