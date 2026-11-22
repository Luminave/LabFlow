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
import { aggregateFlows } from './aggregate'
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

/** 一管「引用了仓库里不存在的试剂」的来源试管 */
export interface MissingReagentRef {
  id: string
  name: string
}

/**
 * 结算前的引用检查（第 7 条）。
 *
 * 以前源试管的 id 在仓库里找不到时，结算循环既不更新也不报错——账悄悄少算一笔。
 * 现在**拒绝结算**并点名是哪几管，让人先把仓库补回来（或者把画布上那根管删掉）。
 *
 * 只查 source：中间产物不在仓库里是正常的（本次实验新入仓），缓冲液不记体积。
 */
export function missingSourceRefTubes(
  experiment: Pick<Experiment, 'tubes'>,
  warehouse: readonly Tube[]
): MissingReagentRef[] {
  const known = new Set(warehouse.map(tube => tube.id))
  return experiment.tubes
    .filter(tube => tube.type === 'source' && !known.has(tube.id))
    .map(tube => ({ id: tube.id, name: tube.name }))
}

/** 结算被「引用的试剂找不到」挡住（调用方 catch 它给中文原因，不要当未知异常） */
export class MissingReagentRefError extends Error {
  readonly tubes: MissingReagentRef[]

  constructor(tubes: MissingReagentRef[]) {
    const names = tubes.map(tube => `「${tube.name}」（${tube.id}）`).join('、')
    super(
      `拒绝结算：画布上 ${tubes.length} 根源试管引用的试剂在仓库里找不到：${names}。` +
        '请先在仓库里补上这些试剂（或把这几根管从画布上删掉）再结算'
    )
    this.name = 'MissingReagentRefError'
    this.tubes = tubes
  }
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
  // 结算前先做引用检查：源试管引用的试剂找不到就整笔拒绝（账不能悄悄少算）
  const missingRefs = missingSourceRefTubes(input.experiment, warehouse)
  if (missingRefs.length > 0) throw new MissingReagentRefError(missingRefs)

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

// ============================== 回退（结算的反向） ==============================

/** 回退需要看到的工程字段（快照类字段只用来判断「这根中间产物是不是本工程新入仓的」） */
export interface RevertInput {
  experiment: Pick<Experiment, 'tubes' | 'connections' | 'warehouseSnapshot' | 'endStateTubes'>
  /** 仓库**当前**全集（仓库.yml 正本那份）；不是建工程时的快照 */
  warehouse: readonly Tube[]
}

/** 一根加回体积的试剂 */
export interface RevertRestored {
  tubeId: string
  name: string
  /** 加回的体积（µL 口径，与 settle 的 `usage.used` 对称） */
  added: number
  /** 实际写回仓库时按那根管自己的单位 */
  unit: VolumeUnit
  /** 加回前 / 后的余量（µL） */
  before: number
  after: number
}

/** 想动但没动的条目（必须原样报给用户，不许悄悄放过） */
export interface RevertSkipped {
  tubeId: string
  name: string
  reason: string
}

export interface RevertResult {
  /** 回退后的仓库（= 当前仓库逐管加回 + 删掉本工程新入仓的中间产物） */
  warehouseAfter: Tube[]
  /** 余量/状态被改过的条目（可直接逐条写库） */
  updated: Tube[]
  /** 加回明细（与 settle 的 usage 对称） */
  restored: RevertRestored[]
  /** 本工程新入仓、这次要删掉的中间产物 */
  removedCreatedTubes: Tube[]
  /** 要删的 id（截断护栏的 explicitDelete 只放行这些） */
  deleteIds: string[]
  /** 没动的原因（调用方必须提示，不能当作「都改好了」） */
  skipped: RevertSkipped[]
}

/**
 * 回退工程量：把**本工程结算时扣掉的量**加回当前仓库（必修 1）。
 *
 * 为什么不能再用 `experiment.warehouseSnapshot` 整份覆盖：
 * 快照只在建工程那一刻写一次，从建工程到回退之间仓库的任何变化（别的工程结算、新加试剂）
 * 都会被整份抹掉。这里改成与 `settleExperiment` 完全对称的做法：
 *
 * - 基底 = 传入的**当前**仓库（调用方用 `mergeWarehouseBase(仓库.yml, 内存)` 拼）；
 * - 加回量 = 本工程画布连线的移出体积（settle 里 `used = before − (before − out)`，也就是 out）；
 * - 只碰本工程画布上真的用到的管子：源试管照量加回；仓库里原本就有的中间产物照量加回；
 * - 本工程新入仓的中间产物（画布上有、建工程时的快照里没有）：只有当前余量与结算后的
 *   结束状态**完全一致**（说明结算后没被别人动过）才删，否则跳过并说明原因；
 * - 其余条目**原样保留（同一个对象引用、顺序不变）**。
 *
 * 纯函数：不改传入数组，时间由 `options.now` 提供。
 */
export function revertExperimentUsage(
  input: RevertInput,
  options: SettleOptions = {}
): RevertResult {
  const warehouse = input.warehouse
  const stamp = options.now ? options.now() : undefined
  const { outVolume } = aggregateFlows(input.experiment.connections as TransferConnection[])

  const snapshotIds = input.experiment.warehouseSnapshot
    ? new Set(input.experiment.warehouseSnapshot.map(tube => tube.id))
    : null
  const endById = new Map<string, Tube>()
  for (const tube of input.experiment.endStateTubes || []) endById.set(tube.id, tube)

  const byId = new Map<string, Tube>()
  const updated: Tube[] = []
  const restored: RevertRestored[] = []
  const removedCreatedTubes: Tube[] = []
  const skipped: RevertSkipped[] = []

  /** 加回 out（µL），中间产物的上限是它自己的总量 */
  const addBack = (current: Tube, out: number, cap?: number): void => {
    const before = volumeOf(current)
    let target = before + out
    if (typeof cap === 'number' && cap > 0) target = Math.min(target, cap)
    const after = roundVolume(target)
    if (after <= before + 0.000001) return
    const next: Tube = {
      ...current,
      remainingVolume: writeBack(after, current.remainingVolumeUnit),
      status: isDepleted(after) ? 'depleted' : 'active'
    }
    if (stamp) next.updatedAt = stamp
    byId.set(next.id, next)
    updated.push(next)
    restored.push({
      tubeId: current.id,
      name: current.name,
      added: roundVolume(after - before),
      unit: current.remainingVolumeUnit || BASE_VOLUME_UNIT,
      before,
      after
    })
  }

  for (const tube of input.experiment.tubes) {
    // 缓冲液不记体积；上样/废液不进仓库
    if (tube.type === 'buffer' || tube.type === 'sample' || tube.type === 'waste') continue

    const current = warehouse.find(item => item.id === tube.id)
    const out = roundVolume(outVolume.get(tube.id) || 0)

    if (!current) {
      // 画布上有、仓库里已经没有了：不能凭空加回一根
      if (tube.type === 'source') {
        skipped.push({
          tubeId: tube.id,
          name: tube.name,
          reason: '仓库里已经没有这根试剂，没法把体积加回去，请手工补'
        })
      }
      continue
    }

    if (tube.type === 'intermediate' && snapshotIds && !snapshotIds.has(tube.id)) {
      // 本工程新入仓的中间产物：结算后没被别人动过才敢删
      const end = endById.get(tube.id)
      const untouched = Boolean(end) && Math.abs(roundVolume(volumeOf(current)) - roundVolume(volumeOf(end!))) < 0.000001
      if (!untouched) {
        skipped.push({
          tubeId: tube.id,
          name: tube.name,
          reason: end
            ? '这是本工程新入仓的中间产物，但结算后余量又变过（可能被后面的实验动过），没删，请手工确认'
            : '这是本工程新入仓的中间产物，但没有结算后的结束状态可比对，没删，请手工确认'
        })
        continue
      }
      removedCreatedTubes.push(current)
      continue
    }

    if (tube.type === 'intermediate' && !snapshotIds) {
      skipped.push({
        tubeId: tube.id,
        name: tube.name,
        reason: '没有建工程时的仓库快照，分不清这根中间产物是不是本工程新入仓的，没动'
      })
      continue
    }

    if (out <= 0) continue
    addBack(current, out, tube.type === 'intermediate' ? toBase(current.totalVolume, current.totalVolumeUnit) : undefined)
  }

  const removedIds = new Set(removedCreatedTubes.map(tube => tube.id))
  const warehouseAfter: Tube[] = []
  for (const tube of warehouse) {
    if (removedIds.has(tube.id)) continue
    warehouseAfter.push(byId.get(tube.id) || tube)
  }

  return {
    warehouseAfter,
    updated,
    restored,
    removedCreatedTubes,
    deleteIds: removedCreatedTubes.map(tube => tube.id),
    skipped
  }
}
