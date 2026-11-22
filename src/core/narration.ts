/**
 * 讲述逻辑（讲述者页 + SOP 导出共用一份）。
 *
 * 为什么抽出来：讲述者页显示的和导出的 SOP 必须是同一套步骤、同一套数字，
 * 否则「屏幕上是 5000 µM、文件里是 5 mM」这种账对不上。口径照旧：
 * 中间产物试管按 configOrder 升序，每管的移入连线按体积从大到小，浓度走 computeMixture 的 µM 口径。
 */

import { computeMixture } from './mix'
import type { Experiment, Tube } from './schema'
import { formatQuantity, normalizeVolume } from './units'

export interface NarrationSource {
  tube: Tube
  /** 移入体积，µL */
  volume: number
}

export interface NarrationSubstance {
  name: string
  /** 混合后浓度，µM */
  concentration: number
  /** 好读的写法，如 `5 mM` */
  text: string
}

export interface NarrationStep {
  /** 从 1 开始的步骤号 */
  index: number
  tube: Tube
  /** 本步总移入体积，µL */
  totalVolume: number
  substances: NarrationSubstance[]
  sources: NarrationSource[]
}

/** 讲述顺序：中间产物且不是原料的试管，按配置序号升序（未设序号的排最后） */
export function narrationTubes(experiment: Experiment): Tube[] {
  return experiment.tubes
    .filter(tube => tube.type === 'intermediate' && !tube.asSource)
    .sort((a, b) => (a.configOrder || 999999) - (b.configOrder || 999999))
}

function toBaseVolume(conn: { volume: number; volumeUnit?: string }): number {
  return normalizeVolume(conn.volume, (conn.volumeUnit as any) || 'μL')
}

/** 生成讲述步骤（没有移入连线的试管会被跳过，与改动前的行为一致） */
export function buildNarrationSteps(experiment: Experiment): NarrationStep[] {
  const steps: NarrationStep[] = []

  for (const tube of narrationTubes(experiment)) {
    const incoming = experiment.connections
      .filter(conn => conn.toTubeId === tube.id)
      // 按归一化后的体积排序（连线可能用 mL 记，直接比原始数字会排错）
      .sort((a, b) => toBaseVolume(b) - toBaseVolume(a))
    if (incoming.length === 0) continue

    const sources: NarrationSource[] = incoming
      .map(conn => ({
        tube: experiment.tubes.find(t => t.id === conn.fromTubeId),
        volume: normalizeVolume(conn.volume, conn.volumeUnit || 'μL')
      }))
      .filter((item): item is NarrationSource => !!item.tube)

    const totalVolume = sources.reduce((sum, s) => sum + s.volume, 0)
    const mixture = computeMixture(
      sources.map(s => ({ substances: s.tube.substances, volume: s.volume })),
      { unitMode: 'uM', round: false }
    )

    const substances: NarrationSubstance[] = mixture.map(sub => ({
      name: sub.name,
      concentration: sub.concentration,
      text: formatQuantity(sub.concentration, 'concentration')
    }))

    steps.push({ index: steps.length + 1, tube, totalVolume, substances, sources })
  }

  return steps
}

/** 试管显示名：可选用管号替代名称（讲述者页的「使用管号」开关） */
export function displayNameOf(tube: { name: string; tubeNumber?: string }, useTubeNumber: boolean): string {
  if (useTubeNumber && tube.tubeNumber) {
    return tube.tubeNumber.startsWith('#') ? tube.tubeNumber : `#${tube.tubeNumber}`
  }
  return tube.name
}

/** 一步的标题行（与改动前逐字同格式，只是数字改走 formatQuantity） */
export function stepTitle(step: NarrationStep, useTubeNumber: boolean, emptyLabel = '空'): string {
  const volume = formatQuantity(step.totalVolume, 'volume')
  const substances = step.substances.length > 0
    ? step.substances.map(sub => `${sub.text} ${sub.name}`).join(';')
    : emptyLabel
  return `Step${step.index}: ${displayNameOf(step.tube, useTubeNumber)}   ${volume}   (${substances})`
}

/** 一步里的小步骤：从哪管取多少、加到哪管 */
export function stepSourceLines(step: NarrationStep, useTubeNumber: boolean): string[] {
  return step.sources.map(
    (source, i) =>
      `(${i + 1}) ${displayNameOf(source.tube, useTubeNumber)}→${formatQuantity(source.volume, 'volume')}→${displayNameOf(step.tube, useTubeNumber)}`
  )
}

/** 讲述者页展示的纯文本（与改动前一致的段落结构） */
export function narrationText(experiment: Experiment, useTubeNumber: boolean, emptyLabel = '空'): string {
  const lines: string[] = []
  for (const step of buildNarrationSteps(experiment)) {
    lines.push(stepTitle(step, useTubeNumber, emptyLabel))
    lines.push(...stepSourceLines(step, useTubeNumber))
    lines.push('')
  }
  return lines.join('\n').trim()
}
