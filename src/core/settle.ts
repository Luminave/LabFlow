/**
 * 结算（结束实验）—— 第 4 步：把「结束实验要扣哪些试剂、哪些中间产物入库」抽成纯函数。
 *
 * 为什么要抽：界面 `completeExperiment()` 和 CLI `labflow complete` 必须**同一套规则**，
 * 否则 Agent 算的账和主人点「结束实验」的账会对不上。
 *
 * 口径（沿用 computeEndState，未改业务规则）：
 * - 源试管：仓库余量 − 移出体积（下限 0），扣完 0 → `depleted`
 * - 中间产物：仓库里已有 → 仓库余量 − 移出；没有 → 入边体积 − 移出，并**新入仓**
 * - 缓冲液：体积不变（当作充足），只记在连线体积里
 * - 上样 / 废液：不进仓库
 *
 * 纯函数：不改传入数组，时间由 `options.now` 提供（不给就不写时间戳）。
 */

import { computeEndState } from './endState'
import type { Experiment, Substance, Tube, TransferConnection, VolumeUnit } from './schema'
import { normalizeVolume, roundVolume } from './units'

export interface SettleOptions {
  /** 提供则给变动过的试管写 updatedAt（界面传真实时间，测试不传保证可对比） */
  now?: () => string
}

/** 一条试剂扣减记录（体积一律换算成 µL 口径的数值，`unit` 固定 'µL'） */
export interface SettleUsage {
  reagentId: string
  name: string
  used: number
  unit: VolumeUnit
  before: number
  after: number
  depleted: boolean
}

/** 一条新入仓的中间产物 */
export interface SettleCreated {
  tubeId: string
  name: string
  totalVolume: number
  unit: VolumeUnit
  remainingVolume: number
  substances: Substance[]
}

export interface SettleResult {
  /** 每根试管结算后的状态（界面用它画结束状态） */
  endStateTubes: Tube[]
  /** 结算后的仓库（= 原仓库逐管替换 + 新入仓的中间产物） */
  warehouseAfter: Tube[]
  /** 仓库里已有、余量/状态需要更新的试管（可直接逐条写库） */
  updated: Tube[]
  /** 需要新入仓的中间产物（保留画布上的 tube.id，不要重新生成） */
  createdTubes: Tube[]
  /** 上面 createdTubes 的摘要，给 CLI / 报告用 */
  created: SettleCreated[]
  /** 扣减明细（源试管 + 仓库里已有的中间产物） */
  usage: SettleUsage[]
  /** 扣完变 0 的试管 id */
  depleted: string[]
}

export interface SettleInput {
  experiment: Pick<Experiment, 'tubes' | 'connections'>
  warehouse: Tube[]
}

const BASE_VOLUME_UNIT: VolumeUnit = 'μL'

function volumeOf(tube: Tube): number {
  return normalizeVolume(tube.remainingVolume, tube.remainingVolumeUnit || BASE_VOLUME_UNIT)
}

function isDepleted(volume: number): boolean {
  return volume <= 0.000001
}

/**
 * 结算：给定工程（试管 + 连线）与当前仓库，算出扣减后的仓库与账目明细。
 * 不写文件、不改库、不碰界面。
 */
export function settleExperiment(input: SettleInput, options: SettleOptions = {}): SettleResult {
  const warehouse = input.warehouse
  const endStateTubes = computeEndState(
    {
      tubes: input.experiment.tubes,
      connections: input.experiment.connections as TransferConnection[],
      warehouseTubes: warehouse
    },
    options.now ? { now: options.now } : {}
  )

  const stamp = options.now ? options.now() : undefined
  const updated: Tube[] = []
  const createdTubes: Tube[] = []
  const usage: SettleUsage[] = []
  const depleted: string[] = []
  const byId = new Map<string, Tube>()

  for (const endTube of endStateTubes) {
    if (endTube.type === 'sample' || endTube.type === 'waste') continue

    const before = warehouse.find(t => t.id === endTube.id)
    const after = roundVolume(endTube.remainingVolume)

    if (before && before.type === 'buffer') {
      // 缓冲液：体积不变（当作充足），不记账、不需要回写
      continue
    } else if (before) {
      // 仓库里已有（源试管，或上一轮实验产生的中间产物）
      const beforeVolume = volumeOf(before)
      const next: Tube = {
        ...before,
        remainingVolume: after,
        totalVolume:
          endTube.type === 'intermediate' ? roundVolume(endTube.totalVolume) : before.totalVolume,
        substances: endTube.substances,
        status: isDepleted(after) ? 'depleted' : 'active'
      }
      if (stamp) next.updatedAt = stamp
      byId.set(next.id, next)
      updated.push(next)

      const used = roundVolume(Math.max(0, beforeVolume - after))
      // 没扣（used = 0）的不进账目，避免「结算两次出两条 0 消耗」的噪音
      if (used > 0) {
        usage.push({
          reagentId: before.id,
          name: before.name,
          used,
          unit: BASE_VOLUME_UNIT,
          before: beforeVolume,
          after,
          depleted: isDepleted(after)
        })
      }
      if (isDepleted(after) && before.status !== 'depleted') depleted.push(before.id)
    } else if (endTube.type === 'intermediate') {
      // 新产生的中间产物：整根入仓，保留画布上的 id
      const next: Tube = {
        ...endTube,
        remainingVolume: after,
        totalVolume: roundVolume(endTube.totalVolume),
        status: isDepleted(after) ? 'depleted' : 'active'
      }
      if (stamp) {
        next.createdAt = next.createdAt || stamp
        next.updatedAt = stamp
      }
      byId.set(next.id, next)
      createdTubes.push(next)
    }
  }

  const warehouseAfter: Tube[] = warehouse.map(tube => byId.get(tube.id) || tube)
  for (const newTube of createdTubes) {
    if (!warehouseAfter.some(t => t.id === newTube.id)) warehouseAfter.push(newTube)
  }

  return {
    endStateTubes,
    warehouseAfter,
    updated,
    createdTubes,
    created: createdTubes.map(tube => ({
      tubeId: tube.id,
      name: tube.name,
      totalVolume: tube.totalVolume,
      unit: tube.totalVolumeUnit || BASE_VOLUME_UNIT,
      remainingVolume: tube.remainingVolume,
      substances: tube.substances
    })),
    usage,
    depleted
  }
}
