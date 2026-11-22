/**
 * `<日期>.md` —— 给人照着配液的 SOP。
 *
 * 数字全部走 units.formatQuantity（`5 mM` / `12.5 μL` / `2.985 mL`），
 * 步骤与讲述者页同源（core/narration.ts），措辞沿用讲述者原有文案。
 */

import type { Experiment, TransferConnection, Tube } from '../schema'
import { buildNarrationSteps, displayNameOf, type NarrationStep } from '../narration'
import { formatQuantity } from '../units'
import { substanceText } from './quantity'
import { projectLinkLine } from '../deepLink'
import type { ProjectInput } from './types'

/** 把导出用的工程数据包成讲述逻辑认得的最小 Experiment 形状 */
function asExperiment(input: ProjectInput): Experiment {
  return {
    id: '',
    name: input.name,
    createdAt: input.createdAt || '',
    updatedAt: input.updatedAt || '',
    completedAt: input.completedAt,
    status: input.status || 'draft',
    tubes: input.tubes,
    tubePositions: input.positions,
    connections: input.connections as TransferConnection[],
    defaultBuffer: input.defaultBuffer
  }
}

/** 表格里的竖线要转义，否则会把 Markdown 表格撑坏 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  completed: '已完成',
  archived: '已归档',
  active: '进行中'
}

interface SubstanceUsage {
  name: string
  /** 累计取用体积，µL */
  volume: number
  /** 出现过的来源试管（按发现顺序） */
  tubes: { name: string; concentrationText: string }[]
  /** 被取用的次数 */
  times: number
}

/** 汇总「每个物质一共要取多少」：按含该物质的来源试管体积累计 */
function summarizeUsage(steps: NarrationStep[]): {
  substances: SubstanceUsage[]
  extras: { tube: Tube; volume: number }[]
} {
  const byName = new Map<string, SubstanceUsage>()
  const extraTubes = new Map<string, { tube: Tube; volume: number }>()

  for (const step of steps) {
    for (const source of step.sources) {
      const hasSubstance = (source.tube.substances || []).length > 0
      if (!hasSubstance) {
        // 纯缓冲液/空管：按「名字」合并（同一瓶缓冲液会被复制成每管一条 buffer- 记录），
        // 否则汇总表里会出现三行一样的 PBS-5Mg
        const key = source.tube.name || source.tube.id
        const existing = extraTubes.get(key) || { tube: source.tube, volume: 0 }
        existing.volume += source.volume
        extraTubes.set(key, existing)
        continue
      }
      for (const sub of source.tube.substances) {
        const existing = byName.get(sub.name) || { name: sub.name, volume: 0, tubes: [], times: 0 }
        existing.volume += source.volume
        existing.times += 1
        const concentrationText = substanceText(sub).replace(`${sub.name} `, '')
        if (!existing.tubes.some(t => t.name === source.tube.name && t.concentrationText === concentrationText)) {
          existing.tubes.push({ name: source.tube.name, concentrationText })
        }
        byName.set(sub.name, existing)
      }
    }
  }

  return { substances: Array.from(byName.values()), extras: Array.from(extraTubes.values()) }
}

function renderStep(step: NarrationStep): string[] {
  const lines: string[] = []
  lines.push(`## Step${step.index}：${displayNameOf(step.tube, false)}`)
  lines.push('')
  lines.push(`- 本步总量：${formatQuantity(step.totalVolume, 'volume')}`)
  if (step.substances.length > 0) {
    lines.push(`- 配好后的浓度：${step.substances.map(sub => `${formatQuantity(sub.concentration, 'concentration')} ${sub.name}`).join('；')}`)
  } else {
    lines.push('- 配好后的浓度：空')
  }
  if (step.tube.notes) lines.push(`- 备注：${step.tube.notes}`)
  lines.push('')
  step.sources.forEach((source, i) => {
    lines.push(
      `${i + 1}. 从「${displayNameOf(source.tube, false)}」取 ${formatQuantity(source.volume, 'volume')}，加到「${displayNameOf(step.tube, false)}」`
    )
  })
  lines.push('')
  return lines
}

/** 生成 SOP 的 Markdown 正文 */
export function toSopMarkdown(input: ProjectInput): string {
  const experiment = asExperiment(input)
  const steps = buildNarrationSteps(experiment)
  const { substances, extras } = summarizeUsage(steps)

  const lines: string[] = []
  lines.push('---')
  lines.push('labflow: sop')
  lines.push(`project: ${JSON.stringify(input.name)}`)
  lines.push(`date: ${JSON.stringify(input.date)}`)
  lines.push(`status: ${input.status || 'draft'}`)
  lines.push('---')
  lines.push('')
  lines.push(`# ${input.name} 操作步骤（SOP）`)
  lines.push('')
  lines.push(`- 日期：${input.date}`)
  lines.push(`- 工程状态：${STATUS_LABELS[input.status || 'draft'] || input.status}`)
  lines.push(`- 试管 ${input.tubes.length} 支，连线 ${input.connections.length} 条`)
  lines.push('- 顺序：中间产物试管按配置序号执行；每一步里的取液按体积从大到小排列')
  lines.push('- 体积与浓度均按好读单位书写（如 `5 mM`、`2.985 mL`）')
  lines.push('')
  // 从笔记里点这一行就能回到 LabFlow 打开这个工程（工程 id 一起带上，同名也不怕）
  lines.push(projectLinkLine(input.name, input.id))
  lines.push('')

  if (steps.length === 0) {
    lines.push('> 这个工程还没有可讲述的步骤：请先在实验模拟里给中间产物试管编号并连线。')
    lines.push('')
  } else {
    for (const step of steps) lines.push(...renderStep(step))
  }

  lines.push('## 用量汇总')
  lines.push('')
  lines.push('| 物质 | 总用量 | 备注 |')
  lines.push('| --- | --- | --- |')
  for (const sub of substances) {
    const from = sub.tubes.map(t => `${t.name}（${t.concentrationText}）`).join('、')
    lines.push(`| ${cell(sub.name)} | ${formatQuantity(sub.volume, 'volume')} | 取自 ${cell(from)}，共取 ${sub.times} 次 |`)
  }
  for (const extra of extras) {
    lines.push(`| ${cell(extra.tube.name)} | ${formatQuantity(extra.volume, 'volume')} | 无成分记录（缓冲液/空管），按步骤中体积累计 |`)
  }
  if (substances.length === 0 && extras.length === 0) {
    lines.push('| — | — | 没有可汇总的用量 |')
  }
  lines.push('')
  lines.push('> 总用量按「含该物质的来源试管体积累计」，同一管在多步中复用会计入多次；按实际取液量核对。')
  lines.push('')

  return lines.join('\n')
}

export type { ProjectInput }
