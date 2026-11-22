/**
 * 改动前的「实验校验」实现快照（对拍基线，勿改）。
 *
 * 逐字取自 git HEAD: src/renderer/src/pages/ExperimentPage.tsx:148 handleCheckExperiment，
 * 只做了两处机械改动：闭包变量改为参数（currentTubes/connections/warehouseTubes/defaultBuffer/language），
 * `setCheckErrors(errors); setShowCheckResult(true)` 改为 `return errors`。
 */
import type { Tube, TransferConnection } from '../../../../src/shared/types'

export interface LegacyCheckError {
  tubeId: string
  tubeName: string
  type: string
  message: string
}

export function legacyCheckExperiment(
  currentTubes: Tube[],
  connections: TransferConnection[],
  warehouseTubes: Tube[],
  defaultBuffer: string | undefined,
  language: 'zh' | 'en'
): LegacyCheckError[] {
  const errors: { tubeId: string; tubeName: string; type: string; message: string }[] = []

  // 计算每个试管的移入和移出体积
  const tubeInVolume = new Map<string, number>()
  const tubeOutVolume = new Map<string, number>()

  for (const conn of connections) {
    if (conn.volume <= 0) continue
    tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
    tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
  }

  // 1. 检查试管输出体积是否大于输入体积,或原料试管输出是否大于剩余体积
  for (const tube of currentTubes) {
    const outVolume = tubeOutVolume.get(tube.id) || 0
    const inVolume = tubeInVolume.get(tube.id) || 0

    if (tube.type === 'source') {
      // 原料试管:检查输出是否大于仓库中的剩余体积
      const whTube = warehouseTubes.find(t => t.id === tube.id)
      const availableVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
      if (outVolume > availableVolume) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'volume_exceed',
          message: `${language === 'zh' ? '原料试管输出体积' : 'Source output volume'}(${outVolume.toFixed(2)})${language === 'zh' ? '大于可用体积' : 'exceeds available'}(${availableVolume.toFixed(2)})`
        })
      }
    } else if (tube.type === 'intermediate') {
      // 如果试管标记为"作为原料",跳过体积检查(因为它没有输入是正常的)
      if (tube.asSource) continue

      // 中间产物:检查是否是从仓库添加的
      const whTube = warehouseTubes.find(t => t.id === tube.id)
      if (whTube) {
        // 从仓库添加的中间产物:当作原料处理
        if (outVolume > whTube.remainingVolume) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'volume_exceed',
            message: `${language === 'zh' ? '中间产物试管输出体积' : 'Intermediate output volume'}(${outVolume.toFixed(2)})${language === 'zh' ? '大于仓库中可用体积' : 'exceeds warehouse available'}(${whTube.remainingVolume.toFixed(2)})`
          })
        }
      } else {
        // 新创建的中间产物:检查输出是否大于输入
        if (outVolume > inVolume) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'volume_exceed',
            message: `${language === 'zh' ? '中间产物试管输出体积' : 'Intermediate output volume'}(${outVolume.toFixed(2)})${language === 'zh' ? '大于输入体积' : 'exceeds input volume'}(${inVolume.toFixed(2)})`
          })
        }
      }
    }
  }

  // 2. 检查中间产物是否需要缓冲液补足但没有缓冲液
  for (const tube of currentTubes) {
    if (tube.type !== 'intermediate') continue

    // 检查是否有缓冲液连线
    const hasBufferConnection = connections.some(c => {
      const fromTube = currentTubes.find(t => t.id === c.fromTubeId)
      return c.toTubeId === tube.id && fromTube?.type === 'buffer' && c.volume > 0
    })

    // 检查是否设置了缓冲液
    const hasSelectedBuffer = tube.selectedBuffer || defaultBuffer

    // 计算总输入体积和目标体积
    const inVolume = tubeInVolume.get(tube.id) || 0
    const targetVolume = tube.totalVolume || 0

    // 如果目标体积大于输入体积,需要缓冲液补足
    if (targetVolume > inVolume && !hasBufferConnection && !hasSelectedBuffer) {
      errors.push({
        tubeId: tube.id,
        tubeName: tube.name,
        type: 'buffer_missing',
        message: `${language === 'zh' ? '中间产物需要缓冲液补足' : 'Intermediate needs buffer fill'}(${(targetVolume - inVolume).toFixed(2)}),${language === 'zh' ? '但未连接缓冲液' : 'but no buffer connected'}`
      })
    }
  }

  // 3. 检查子试管是否需要某种成分但没有连线到含有该成分的父试管
  for (const tube of currentTubes) {
    if (tube.type !== 'intermediate' || tube.substances.length === 0) continue

    // 如果试管标记为"作为原料",跳过成分来源检查
    if (tube.asSource) continue

    // 获取连接到此试管的所有源试管
    const incomingConns = connections.filter(c => c.toTubeId === tube.id)
    const sourceTubes = incomingConns
      .map(c => currentTubes.find(t => t.id === c.fromTubeId))
      .filter(t => t && t.type !== 'buffer') as Tube[]

    // 检查每种目标物质是否有来源
    for (const targetSub of tube.substances) {
      if (!targetSub.name || targetSub.concentration <= 0) continue

      const hasSource = sourceTubes.some(sourceTube =>
        sourceTube.substances.some(s => s.name === targetSub.name)
      )

      if (!hasSource) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'substance_source_missing',
          message: `${language === 'zh' ? '需要成分' : 'Needs substance'}"${targetSub.name}",${language === 'zh' ? '但没有连线到含有该成分的源试管' : 'but no connection to tube containing it'}`
        })
      }
    }
  }

  // 4. 检查所有试管计算是否正确
  for (const tube of currentTubes) {
    if (tube.type === 'sample' || tube.type === 'waste') continue

    // 如果试管标记为"作为原料",跳过计算检查(因为它没有输入是正常的)
    if (tube.asSource) continue

    const incomingConns = connections.filter(c => c.toTubeId === tube.id)

    // 计算所有输入连线的体积总和
    const totalInputFromConnections = incomingConns.reduce((sum, c) => sum + (c.volume || 0), 0)

    // 对于中间产物,检查连线体积是否与目标体积匹配
    if (tube.type === 'intermediate' && tube.totalVolume > 0) {
      // 如果目标体积与实际输入不匹配(且差异超过0.1)
      if (Math.abs(totalInputFromConnections - tube.totalVolume) > 0.1) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'calculation_error',
          message: `${language === 'zh' ? '目标体积' : 'Target volume'}(${tube.totalVolume})${language === 'zh' ? '与实际输入体积' : 'vs actual input'}(${totalInputFromConnections.toFixed(2)})${language === 'zh' ? '不匹配' : 'mismatch'}`
        })
      }
    }
  }

  // 5. 检查是否有试管定义了成分但浓度为0
  for (const tube of currentTubes) {
    for (const sub of tube.substances) {
      if (sub.name && sub.name.trim() !== '' && sub.concentration === 0) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'zero_concentration',
          message: `${language === 'zh' ? '定义了成分' : 'Substance'}"${sub.name}"${language === 'zh' ? '但浓度为0' : 'has zero concentration'}`
        })
      }
    }
  }

  // 6. 检查配置序号（讲述者功能需要）
  const intermediateTubes = currentTubes.filter(
    t => t.type === 'intermediate' && !t.asSource
  )

  // 检查是否有未设置序号的中间产物
  for (const tube of intermediateTubes) {
    if (!tube.configOrder) {
      errors.push({
        tubeId: tube.id,
        tubeName: tube.name,
        type: 'config_order_missing',
        message: language === 'zh' ? '中间产物试管未设置配置序号（讲述者需要）' : 'Intermediate tube has no config order (required by Narrator)'
      })
    } else if (tube.configOrder <= 0 || !Number.isInteger(tube.configOrder)) {
      errors.push({
        tubeId: tube.id,
        tubeName: tube.name,
        type: 'config_order_invalid',
        message: `${language === 'zh' ? '配置序号必须是正整数，当前值:' : 'Config order must be positive integer, current:'} ${tube.configOrder}`
      })
    }
  }

  // 检查序号是否有重复
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
      errors.push({
        tubeId: '',
        tubeName: tubeNames.join(', '),
        type: 'config_order_duplicate',
        message: `${language === 'zh' ? '配置序号' : 'Config order'} ${order} ${language === 'zh' ? '重复使用（' : 'duplicated ('}${tubeNames.join(', ')}${language === 'zh' ? '）' : ')'}`
      })
    }
  }

  // 检查序号是否有跳过
  if (intermediateTubes.length > 0 && orderCounts.size > 0) {
    const orders = Array.from(orderCounts.keys()).sort((a, b) => a - b)
    for (let i = 1; i < orders.length; i++) {
      if (orders[i] - orders[i - 1] > 1) {
        errors.push({
          tubeId: '',
          tubeName: '',
          type: 'config_order_gap',
          message: `${language === 'zh' ? '配置序号有跳过：从' : 'Config order gap: from'} ${orders[i - 1]} ${language === 'zh' ? '跳到' : 'to'} ${orders[i]}`
        })
      }
    }
  }

  return errors
}
