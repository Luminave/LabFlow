/**
 * 实验校验 —— 从 pages/ExperimentPage.tsx 的 handleCheckExperiment 抽出。
 *
 * 只返回结构化错误 { code, tubeId, params }，**不含任何中文/英文文案**；
 * 文案由 UI 层（src/renderer/src/pages/experimentCheckMessages.ts）用 code + params 拼。
 *
 * 六项检查及其顺序与改动前完全一致（顺序决定错误列表的显示次序）：
 * 1. 输出体积 vs 可用体积（原料看仓库、仓库里的中间产物看仓库、新建中间产物看输入）
 *    —— 顺带：源试管引用的试剂在仓库里找不到时另报 `warehouse_ref_missing`（第 7 条）
 * 2. 中间产物需要缓冲液补足但没有缓冲液
 * 3. 中间产物需要的成分没有任何源试管含它
 * 4. 中间产物目标体积与连线输入体积不匹配（差 > 0.1 μL）
 * 5. 定义了成分但浓度为 0
 * 6. 讲述者用的配置序号：未设置 / 非正整数 / 重复 / 跳号
 */

import type { Tube, ValidationInput, ValidationIssue } from './schema'
import { aggregateFlows } from './aggregate'
import { normalizeVolume } from './units'

const BASE_VOLUME_UNIT = 'μL'

/** 校验一律在 µL 基准上比；参数也一律是 µL（与结算/结束状态同口径） */
function baseVolume(value: number | undefined, unit: string | undefined): number {
  return normalizeVolume(value || 0, unit || BASE_VOLUME_UNIT)
}

/** 校验实验，返回结构化错误列表（顺序与改动前一致） */
export function validateExperiment(input: ValidationInput): ValidationIssue[] {
  const { tubes, connections, warehouseTubes, defaultBuffer } = input
  const issues: ValidationIssue[] = []
  const { inVolume: inMap, outVolume: outMap } = aggregateFlows(connections)

  // 1. 输出体积是否超出可用体积
  for (const tube of tubes) {
    const outVolume = outMap.get(tube.id) || 0
    const inVolume = inMap.get(tube.id) || 0

    if (tube.type === 'source') {
      const whTube = warehouseTubes.find(t => t.id === tube.id)
      // 引用的试剂在仓库里找不到：单独报一条（结算也会因此拒绝），体积那条照旧按工程里的余量兜底
      if (!whTube) {
        issues.push({
          code: 'warehouse_ref_missing',
          tubeId: tube.id,
          params: { reagentId: tube.id }
        })
      }
      const availableVolume = whTube
        ? baseVolume(whTube.remainingVolume, whTube.remainingVolumeUnit)
        : baseVolume(tube.remainingVolume, tube.remainingVolumeUnit)
      if (outVolume > availableVolume) {
        issues.push({
          code: 'volume_exceed_source',
          tubeId: tube.id,
          params: { outVolume, availableVolume }
        })
      }
    } else if (tube.type === 'intermediate') {
      // 标记为「作为原料」的中间产物没有输入是正常的，跳过体积检查
      if (tube.asSource) continue

      const whTube = warehouseTubes.find(t => t.id === tube.id)
      if (whTube) {
        const availableVolume = baseVolume(whTube.remainingVolume, whTube.remainingVolumeUnit)
        if (outVolume > availableVolume) {
          issues.push({
            code: 'volume_exceed_intermediate_warehouse',
            tubeId: tube.id,
            params: { outVolume, availableVolume }
          })
        }
      } else {
        if (outVolume > inVolume) {
          issues.push({
            code: 'volume_exceed_intermediate_input',
            tubeId: tube.id,
            params: { outVolume, inVolume }
          })
        }
      }
    }
  }

  // 2. 中间产物需要缓冲液补足但没有缓冲液
  for (const tube of tubes) {
    if (tube.type !== 'intermediate') continue

    const hasBufferConnection = connections.some(c => {
      const fromTube = tubes.find(t => t.id === c.fromTubeId)
      return c.toTubeId === tube.id && fromTube?.type === 'buffer' && c.volume > 0
    })

    const hasSelectedBuffer = tube.selectedBuffer || defaultBuffer

    const inVolume = inMap.get(tube.id) || 0
    const targetVolume = baseVolume(tube.totalVolume, tube.totalVolumeUnit)

    if (targetVolume > inVolume && !hasBufferConnection && !hasSelectedBuffer) {
      issues.push({
        code: 'buffer_missing',
        tubeId: tube.id,
        params: { shortage: targetVolume - inVolume }
      })
    }
  }

  // 3. 中间产物需要的成分找不到来源
  for (const tube of tubes) {
    if (tube.type !== 'intermediate' || tube.substances.length === 0) continue
    if (tube.asSource) continue

    const incomingConns = connections.filter(c => c.toTubeId === tube.id)
    const sourceTubes = incomingConns
      .map(c => tubes.find(t => t.id === c.fromTubeId))
      .filter(t => t && t.type !== 'buffer') as Tube[]

    for (const targetSub of tube.substances) {
      if (!targetSub.name || targetSub.concentration <= 0) continue

      const hasSource = sourceTubes.some(sourceTube =>
        sourceTube.substances.some(s => s.name === targetSub.name)
      )

      if (!hasSource) {
        issues.push({
          code: 'substance_source_missing',
          tubeId: tube.id,
          params: { substanceName: targetSub.name }
        })
      }
    }
  }

  // 4. 目标体积与连线输入体积是否匹配
  for (const tube of tubes) {
    if (tube.type === 'sample' || tube.type === 'waste') continue
    if (tube.asSource) continue

    const incomingConns = connections.filter(c => c.toTubeId === tube.id)
    const totalInputFromConnections = incomingConns.reduce(
      (sum, c) => sum + baseVolume(c.volume, (c as { volumeUnit?: string }).volumeUnit),
      0
    )
    const targetVolume = baseVolume(tube.totalVolume, tube.totalVolumeUnit)

    if (tube.type === 'intermediate' && targetVolume > 0) {
      if (Math.abs(totalInputFromConnections - targetVolume) > 0.1) {
        issues.push({
          code: 'calculation_error',
          tubeId: tube.id,
          params: { targetVolume, inputVolume: totalInputFromConnections }
        })
      }
    }
  }

  // 5. 定义了成分但浓度为 0
  for (const tube of tubes) {
    for (const sub of tube.substances) {
      if (sub.name && sub.name.trim() !== '' && sub.concentration === 0) {
        issues.push({
          code: 'zero_concentration',
          tubeId: tube.id,
          params: { substanceName: sub.name }
        })
      }
    }
  }

  // 6. 配置序号（讲述者需要）
  const intermediateTubes = tubes.filter(t => t.type === 'intermediate' && !t.asSource)

  for (const tube of intermediateTubes) {
    if (!tube.configOrder) {
      issues.push({ code: 'config_order_missing', tubeId: tube.id, params: {} })
    } else if (tube.configOrder <= 0 || !Number.isInteger(tube.configOrder)) {
      issues.push({
        code: 'config_order_invalid',
        tubeId: tube.id,
        params: { configOrder: tube.configOrder }
      })
    }
  }

  const orderCounts = new Map<number, string[]>()
  for (const tube of intermediateTubes) {
    if (tube.configOrder) {
      const existing = orderCounts.get(tube.configOrder) || []
      existing.push(tube.name)
      orderCounts.set(tube.configOrder, existing)
    }
  }
  for (const [order, tubeNames] of orderCounts) {
    if (tubeNames.length > 1) {
      issues.push({
        code: 'config_order_duplicate',
        tubeId: '',
        params: { order, tubeNames }
      })
    }
  }

  if (intermediateTubes.length > 0 && orderCounts.size > 0) {
    const orders = Array.from(orderCounts.keys()).sort((a, b) => a - b)
    for (let i = 1; i < orders.length; i++) {
      if (orders[i] - orders[i - 1] > 1) {
        issues.push({
          code: 'config_order_gap',
          tubeId: '',
          params: { from: orders[i - 1], to: orders[i] }
        })
      }
    }
  }

  return issues
}
