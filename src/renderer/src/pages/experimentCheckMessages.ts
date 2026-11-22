/**
 * 校验错误的文案层（UI 侧）。
 *
 * 计算内核只给 { code, tubeId, params }；中英文文案在这里拼，界面结构（tubeName / type / message）
 * 与改动前逐字一致，因此页面渲染代码不用动。
 */

import type { Tube } from '@shared/types'
import type { ValidationIssue } from '@/core/schema'

export interface CheckError {
  tubeId: string
  tubeName: string
  /** 面板上的类型标签用的 type（与改动前一致） */
  type: string
  message: string
}

const TYPE_BY_CODE: Record<ValidationIssue['code'], string> = {
  volume_exceed_source: 'volume_exceed',
  volume_exceed_intermediate_warehouse: 'volume_exceed',
  volume_exceed_intermediate_input: 'volume_exceed',
  buffer_missing: 'buffer_missing',
  substance_source_missing: 'substance_source_missing',
  calculation_error: 'calculation_error',
  zero_concentration: 'zero_concentration',
  config_order_missing: 'config_order_missing',
  config_order_invalid: 'config_order_invalid',
  config_order_duplicate: 'config_order_duplicate',
  config_order_gap: 'config_order_gap',
  warehouse_ref_missing: 'warehouse_ref_missing'
}

function num(value: string | number | string[] | undefined): number {
  return typeof value === 'number' ? value : Number(value) || 0
}

function str(value: string | number | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ')
  return value === undefined ? '' : String(value)
}

/** 把结构化错误拼成页面要的 { tubeId, tubeName, type, message } */
export function formatCheckIssues(
  issues: ValidationIssue[],
  tubes: Tube[],
  language: 'zh' | 'en'
): CheckError[] {
  const zh = language === 'zh'

  return issues.map(issue => {
    const { code, tubeId, params } = issue

    let tubeName = ''
    if (tubeId) {
      tubeName = tubes.find(t => t.id === tubeId)?.name || ''
    } else if (Array.isArray(params.tubeNames)) {
      tubeName = params.tubeNames.join(', ')
    }

    let message: string
    switch (code) {
      case 'volume_exceed_source':
        message = `${zh ? '原料试管输出体积' : 'Source output volume'}(${num(params.outVolume).toFixed(2)})${zh ? '大于可用体积' : 'exceeds available'}(${num(params.availableVolume).toFixed(2)})`
        break
      case 'volume_exceed_intermediate_warehouse':
        message = `${zh ? '中间产物试管输出体积' : 'Intermediate output volume'}(${num(params.outVolume).toFixed(2)})${zh ? '大于仓库中可用体积' : 'exceeds warehouse available'}(${num(params.availableVolume).toFixed(2)})`
        break
      case 'volume_exceed_intermediate_input':
        message = `${zh ? '中间产物试管输出体积' : 'Intermediate output volume'}(${num(params.outVolume).toFixed(2)})${zh ? '大于输入体积' : 'exceeds input volume'}(${num(params.inVolume).toFixed(2)})`
        break
      case 'buffer_missing':
        message = `${zh ? '中间产物需要缓冲液补足' : 'Intermediate needs buffer fill'}(${num(params.shortage).toFixed(2)}),${zh ? '但未连接缓冲液' : 'but no buffer connected'}`
        break
      case 'substance_source_missing':
        message = `${zh ? '需要成分' : 'Needs substance'}"${str(params.substanceName)}",${zh ? '但没有连线到含有该成分的源试管' : 'but no connection to tube containing it'}`
        break
      case 'calculation_error':
        message = `${zh ? '目标体积' : 'Target volume'}(${str(params.targetVolume)})${zh ? '与实际输入体积' : 'vs actual input'}(${num(params.inputVolume).toFixed(2)})${zh ? '不匹配' : 'mismatch'}`
        break
      case 'zero_concentration':
        message = `${zh ? '定义了成分' : 'Substance'}"${str(params.substanceName)}"${zh ? '但浓度为0' : 'has zero concentration'}`
        break
      case 'config_order_missing':
        message = zh ? '中间产物试管未设置配置序号（讲述者需要）' : 'Intermediate tube has no config order (required by Narrator)'
        break
      case 'config_order_invalid':
        message = `${zh ? '配置序号必须是正整数，当前值:' : 'Config order must be positive integer, current:'} ${str(params.configOrder)}`
        break
      case 'config_order_duplicate':
        message = `${zh ? '配置序号' : 'Config order'} ${str(params.order)} ${zh ? '重复使用（' : 'duplicated ('}${str(params.tubeNames)}${zh ? '）' : ')'}`
        break
      case 'config_order_gap':
        message = `${zh ? '配置序号有跳过：从' : 'Config order gap: from'} ${str(params.from)} ${zh ? '跳到' : 'to'} ${str(params.to)}`
        break
      case 'warehouse_ref_missing':
        message = zh
          ? `这根试管引用的仓库试剂在仓库里找不到（id:${str(params.reagentId)}），结算会被拒绝；请先在仓库里补上或删掉这根管`
          : `Referenced reagent is missing from the warehouse (id:${str(params.reagentId)}); settling will be refused`
        break
      default:
        message = ''
        break
    }

    return { tubeId, tubeName, type: TYPE_BY_CODE[code], message }
  })
}
