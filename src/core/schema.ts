/**
 * LabFlow 计算内核 - 数据结构与版本
 *
 * 约定：
 * - 领域类型不在这里另起一套，统一从 src/shared/types/index.ts 重导出。
 * - 内核只依赖纯数据，不依赖 React / Electron / window / localStorage。
 */

export * from '../shared/types'

import type { ConcentrationUnit, Substance, Tube, VolumeUnit } from '../shared/types'

/**
 * 工程数据结构的版本号。
 *
 * AI 提出，未确认：现有数据库里没有版本字段，这个常量是为后续 .canvas / .yml 导出准备的，
 * 取值 1 是本次重构的第一步，等第 1 步定义 .canvas 格式时由主人确认后可能调整。
 */
export const SCHEMA_VERSION = 1

/** 移入 / 移出体积汇总结果（单位：与连接线体积同单位，界面上实际都是 μL） */
export interface FlowTotals {
  /** tubeId -> 移入总体积 */
  inVolume: Map<string, number>
  /** tubeId -> 移出总体积 */
  outVolume: Map<string, number>
}

/** 一次混合计算中的一个来源（一条移液连线的源试管 + 移液体积） */
export interface MixSource {
  substances: Substance[]
  volume: number
  /** 缺省按 μL 处理 */
  volumeUnit?: VolumeUnit
}

/** 混合计算结果中的一项 */
export interface MixtureEntry {
  name: string
  concentration: number
  concentrationUnit: ConcentrationUnit
}

/** 结束状态计算输入 */
export interface EndStateInput {
  tubes: Tube[]
  connections: { fromTubeId: string; toTubeId: string; volume: number }[]
  /** 仓库里的试管（用于原料试管的初始体积）；对应「查仓库」口径 */
  warehouseTubes: Tube[]
}

/** 校验错误码。内核只给码，中文文案由 UI 层拼。 */
export type ValidationCode =
  | 'volume_exceed_source'
  | 'volume_exceed_intermediate_warehouse'
  | 'volume_exceed_intermediate_input'
  | 'buffer_missing'
  | 'substance_source_missing'
  | 'calculation_error'
  | 'zero_concentration'
  | 'config_order_missing'
  | 'config_order_invalid'
  | 'config_order_duplicate'
  | 'config_order_gap'
  /** 源试管引用的仓库试剂在 仓库.yml 里找不到（结算会因此被拒绝） */
  | 'warehouse_ref_missing'

/** 结构化校验错误：{ code, tubeId, params }，不含任何自然语言文案 */
export interface ValidationIssue {
  code: ValidationCode
  /** 相关试管 ID；与具体试管无关时为空串 */
  tubeId: string
  /** 拼文案需要的数值与名称（名称是用户数据，不是界面文案） */
  params: Record<string, string | number | string[]>
}

/** 校验输入 */
export interface ValidationInput {
  tubes: Tube[]
  connections: { fromTubeId: string; toTubeId: string; volume: number }[]
  /** 仓库里的试管（用于原料试管可用体积判断） */
  warehouseTubes: Tube[]
  /** 工程默认缓冲液 ID */
  defaultBuffer?: string
}
