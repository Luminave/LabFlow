/**
 * 导出器输入模型。
 *
 * 三个导出器（.yml / .canvas / SOP）都只吃这一份纯数据，不碰 React / Electron / 数据库，
 * 这样它们既能被页面调用，也能被测试和将来的 Agent CLI（第 2 步）直接调用。
 */

import type { Experiment, Tube, TubePosition, TransferConnection } from '../schema'

/** 一次导出所需的全部工程数据（单位已按 μM / μL 归一化前的原始值，导出时再统一格式化） */
export interface ProjectInput {
  /** 工程 id（深链接 labflow://open?id=… 用它精确定位） */
  id?: string
  /** 工程名（用户命名）；正本文件名也用它 */
  name: string
  /** 工程备注 */
  description?: string
  /** 耗损实验标记 */
  isWaste?: boolean
  /** 工程日期，YYYY-MM-DD */
  date: string
  status?: Experiment['status']
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  /** 工程默认缓冲液试管 ID */
  defaultBuffer?: string
  tubes: Tube[]
  connections: TransferConnection[]
  /** 画布坐标；缺失的试管由 layout.ts 按网格补齐，不使用随机数 */
  positions: TubePosition[]
  /** 仓库试剂快照（用来标出「这根管来自仓库」）；没有就只靠 buffer-… 的 ID 前缀识别 */
  warehouseTubes?: Tube[]
  /**
   * 成分背景色（成分名 → #rrggbb）。来自 substanceColorStore；
   * 画布用它按最接近的预设色上色，原色值同时写进 .yml 的 `color`。
   */
  substanceColors?: Record<string, string>
}

/** 从一条实验记录生成导出输入 */
export function projectInputFromExperiment(experiment: Experiment): ProjectInput {
  return {
    id: experiment.id,
    name: experiment.name || '未命名工程',
    description: experiment.description,
    isWaste: experiment.isWaste,
    date: projectDate(experiment),
    status: experiment.status,
    createdAt: experiment.createdAt,
    updatedAt: experiment.updatedAt,
    completedAt: experiment.completedAt,
    defaultBuffer: experiment.defaultBuffer,
    tubes: experiment.tubes || [],
    connections: experiment.connections || [],
    positions: experiment.tubePositions || [],
    warehouseTubes: experiment.warehouseSnapshot
  }
}

/** 工程日期口径：完成日 > 更新日 > 创建日；取不到的用今天 */
export function projectDate(experiment: {
  completedAt?: string
  updatedAt?: string
  createdAt?: string
}): string {
  const source = experiment.completedAt || experiment.updatedAt || experiment.createdAt
  if (!source) return todayISO()
  const parsed = new Date(source)
  if (Number.isNaN(parsed.getTime())) return todayISO()
  return toISODate(parsed)
}

/** Date -> YYYY-MM-DD（本地时区，避免半夜导出跑到前一天） */
export function toISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function todayISO(): string {
  return toISODate(new Date())
}
