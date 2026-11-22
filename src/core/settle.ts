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
 *
 * 2026-11-23 修（阻断：真机点「结束实验」被截断护栏拒绝）：
 * `input.warehouse` 必须是**仓库全集**（仓库.yml 的正本内容），不是「本实验用到的试管」。
 * 以前界面调用方把数据库 `status != 'discarded'` 的子集（39 种里只剩 13 种）当全集传进来，
 * 结算结果就只含这 13 条，没参与的 26 种被整批丢掉 → 护栏判定「试剂少了 26 条」拒写。
 * 现在合并规则写死在本函数里：只有本实验真的碰到（`usage` / `createdTubes`）的条目会被替换，
 * 其余条目**原样保留（同一个对象引用、顺序不变）**，最后才追加新入仓的中间产物。
 * 调用方若手里只有子集，先用 `mergeWarehouseBase()` 拼成全量再传进来。
 */

import { computeEndState } from './endState'
import type { Experiment, Substance, Tube, TransferConnection, VolumeUnit } from './schema'
import { denormalizeVolume, normalizeVolume, roundVolume } from './units'

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
  /** 仓库**全集**（仓库.yml 正本那份），不是本实验用到的试管；子集请先用 mergeWarehouseBase() 拼全 */
  warehouse: Tube[]
}

const BASE_VOLUME_UNIT: VolumeUnit = 'μL'

function volumeOf(tube: Tube): number {
  return normalizeVolume(tube.remainingVolume, tube.remainingVolumeUnit || BASE_VOLUME_UNIT)
}

/** µL 结果按目标试管自己的单位写回（先按 µL 舍入，避免 mL 管丢精度） */
function writeBack(baseVolume: number, unit: VolumeUnit | undefined): number {
  return roundVolume(denormalizeVolume(roundVolume(baseVolume), unit || BASE_VOLUME_UNIT))
}

/** 把一个「数值 + 单位」折成 µL */
function toBase(value: number, unit: VolumeUnit | undefined): number {
  return normalizeVolume(value, unit || BASE_VOLUME_UNIT)
}

function isDepleted(volume: number): boolean {
  return volume <= 0.000001
}

/**
 * 拼一份「仓库全集」当结算基底。
 *
 * 为什么要它：界面内存里的试剂列表可能是子集（启动只读数据库的 `status != 'discarded'`、
 * 溯源页又用临时列表顶替过内存），拿它当全集结算就会把没参与的试剂丢掉。
 * 仓库.yml 是真相，所以：
 * - 以文件那份的**顺序**为骨架；
 * - 内存里同 id 的条目覆盖上去（内存可能是刚改过余量的那份）；
 * - 内存里有、文件里没有的追加在后面（还没落盘的新增，不能丢）。
 *
 * 文件里没被覆盖的条目保持**原对象引用**，方便调用方/测试确认「真的没动」。
 */
export function mergeWarehouseBase(fileReagents: readonly Tube[], memoryReagents: readonly Tube[]): Tube[] {
  const memoryById = new Map<string, Tube>()
  for (const tube of memoryReagents) memoryById.set(tube.id, tube)

  const merged: Tube[] = fileReagents.map(tube => memoryById.get(tube.id) ?? tube)
  const known = new Set(merged.map(tube => tube.id))
  for (const tube of memoryReagents) {
    if (known.has(tube.id)) continue
    merged.push(tube)
    known.add(tube.id)
  }
  return merged
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
    // 结算一律在 µL 基准上做：endTube.remainingVolume 是「按它自己单位」写回的，
    // 先折回 µL 再比、再记账；写库时再按仓库那根管自己的单位换回去。
    const after = roundVolume(volumeOf(endTube))

    if (before && before.type === 'buffer') {
      // 缓冲液：体积不变（当作充足），不记账、不需要回写
      continue
    } else if (before) {
      // 仓库里已有（源试管，或上一轮实验产生的中间产物）
      const beforeVolume = volumeOf(before)
      const next: Tube = {
        ...before,
        remainingVolume: writeBack(after, before.remainingVolumeUnit),
        totalVolume:
          endTube.type === 'intermediate'
            ? writeBack(toBase(endTube.totalVolume, endTube.totalVolumeUnit), before.totalVolumeUnit)
            : before.totalVolume,
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
        remainingVolume: writeBack(after, endTube.remainingVolumeUnit),
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

  // 以传入的仓库全集为基底逐管替换：byId 里只有「本实验真的碰到」的条目，
  // 其余条目原样带过去（同一个引用、顺序不变、批次/时间戳都不动）。
  const warehouseAfter: Tube[] = warehouse.map(tube => byId.get(tube.id) || tube)
  // 新入仓的中间产物追加在末尾（id 已存在就不重复追加）
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
