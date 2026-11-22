/**
 * 仓库正本的读写编排：`仓库.yml`
 *
 * 与工程正本同一套思路：文件是真相，数据库是缓存。
 * 这里只管「什么时候写」，内容序列化在 `src/core/store/warehouseFile.ts`。
 *
 * 2026-11 修（三条）：
 * 1. 文件存在但**解析失败**时不再当成「没有文件」——返回 state:'broken'，调用方只读内存、绝不写回。
 * 2. 写盘带上「上次读到的 mtime/size」做 expect，外部改过就 conflict、不覆盖。
 * 3. 截断护栏改成「减少必须来自显式删除动作」，正常删试剂能落盘。
 */

import type { SubstanceColor, Tube, TubeGroup } from '@shared/types'
import { parseWarehouseYml, toWarehouseYml, type WarehouseSnapshot } from '@/core/store/warehouseFile'
import { resetWarehouseReagentsCache } from './projectSource'

/** 上次读/写仓库文件时看到的 stat（写盘 expect 用；null = 还没读过）。hash 见第 6 条 */
type WarehouseFileStat = { mtimeMs: number; size: number; hash?: string }

let warehouseFileStat: WarehouseFileStat | null = null

/** 测试用：清掉 stat 记忆 */
export function resetWarehouseFileStat(): void {
  warehouseFileStat = null
}

export function warehouseFileStatSnapshot(): WarehouseFileStat | null {
  return warehouseFileStat
}

function api() {
  return typeof window !== 'undefined' ? window.electronAPI?.dataRoot : undefined
}

export function isWarehouseFileAvailable(): boolean {
  return Boolean(api())
}

/** 解析出问题时 parseWarehouseYml 的 warning 首句（不改解析器，只认这两句） */
const BROKEN_WARNINGS = ['YAML 解析失败', '文件内容不是 YAML 映射']

export function isBrokenWarehouseParse(warnings: string[]): boolean {
  return warnings.some(message => BROKEN_WARNINGS.some(prefix => message.startsWith(prefix)))
}

/** 读仓库文件的三种结果：正常 / 不存在 / 存在但读不懂 */
export interface WarehouseFileRead {
  state: 'ok' | 'missing' | 'broken'
  /** 原文（备份留证要用） */
  text?: string
  snapshot?: WarehouseSnapshot
  warnings: string[]
  error?: string
}

export interface WarehouseGuardOptions {
  /**
   * 显式删除动作：true = 这次写盘可以为任意删除负责；字符串数组 = 只放行这些试剂 id 的删除。
   * 不传 = 任何「条数减少」都拒绝（防止溯源页之类的路径把仓库写小）。
   */
  explicitDelete?: true | string[]
}

function explicitDeleteAllows(options: WarehouseGuardOptions, reagentId: string): boolean {
  if (options.explicitDelete === true) return true
  if (Array.isArray(options.explicitDelete)) return options.explicitDelete.includes(reagentId)
  return false
}

/**
 * 截断护栏。
 * - 传快照：按「消失的试剂 id」判断——每一条减少都必须来自显式删除动作。
 * - 传数字（旧调用）：只按条数判断，减少同样只在 explicitDelete === true 时放行。
 * 返回 null = 允许写；返回字符串 = 拒绝原因。
 */
export async function warehouseTruncationGuard(
  next: WarehouseSnapshot | number,
  options: WarehouseGuardOptions = {}
): Promise<string | null> {
  const dataRoot = api()
  if (!dataRoot) return null

  const isCountOnly = typeof next === 'number'
  const nextCount = isCountOnly ? next : next.reagents.length

  try {
    const existing = await dataRoot.readWarehouse()
    if (existing.ok && existing.content) {
      const parsed = parseWarehouseYml(existing.content)
      if (isBrokenWarehouseParse(parsed.warnings)) return null // 读不懂的文件不做截断判断（另有 broken 流程处理）
      const prev = parsed.snapshot.reagents
      if (!isCountOnly) {
        const nextIds = new Set(next.reagents.map(reagent => reagent.id))
        const removed = prev.filter(reagent => !nextIds.has(reagent.id))
        const disallowed = removed.filter(reagent => !explicitDeleteAllows(options, reagent.id))
        if (disallowed.length > 0) {
          const names = disallowed
            .slice(0, 5)
            .map(reagent => reagent.name)
            .join('、')
          const more = disallowed.length > 5 ? ` 等 ${disallowed.length} 种` : ''
          return `试剂少了 ${disallowed.length} 条（${names}${more}），但不是显式删除动作，拒绝写`
        }
      } else if (prev.length > 0 && nextCount < prev.length && options.explicitDelete !== true) {
        return `试剂从 ${prev.length} 条降到 ${nextCount} 条`
      }
    }
  } catch {
    /* 读不到就跳过这项护栏 */
  }

  // 数据库条数兜底：不是显式删除时，写盘结果不能比数据库还少
  if (options.explicitDelete !== true) {
    try {
      const rows = await window.electronAPI?.getTubes?.()
      const dbCount = Array.isArray(rows) ? rows.length : 0
      if (dbCount > 0 && nextCount < dbCount) return `试剂比数据库里的 ${dbCount} 条少（只有 ${nextCount} 条）`
    } catch {
      /* 同上 */
    }
  }

  return null
}

export type WarehouseSaveStatus = 'saved' | 'guard' | 'conflict' | 'error'

export interface WarehouseSaveResult {
  status: WarehouseSaveStatus
  /** 给界面看的拒绝/失败原因（成功时没有） */
  message?: string
}

/**
 * 写 仓库.yml（原子写 + 截断护栏 + 外部修改检测）。
 * 冲突时**不写**，把冲突交给调用方重读文件——这里不猜该用哪份。
 */
export async function saveWarehouseFileDetailed(
  snapshot: WarehouseSnapshot,
  options: WarehouseGuardOptions = {}
): Promise<WarehouseSaveResult> {
  const dataRoot = api()
  if (!dataRoot) return { status: 'error', message: '当前没有桌面应用，仓库正本写不了' }
  try {
    const refusal = await warehouseTruncationGuard(snapshot, options)
    if (refusal) {
      console.error(`[Store] 拒绝写仓库正本：${refusal}`)
      return { status: 'guard', message: refusal }
    }
    const content = toWarehouseYml(snapshot)
    // expect 是「上次读/写时的 stat」；仓库文件被别人改过就 conflict，绝不静默覆盖
    const result = await dataRoot.writeWarehouse({ content, expect: warehouseFileStat })
    if (result.ok) {
      warehouseFileStat = result.stat
      // 文件已经是新内容：projectSource 里那份「仓库试剂缓存」必须一起作废，
      // 否则紧接着载入工程时，余量还按写盘前的旧值算（审查第 7 条）。
      resetWarehouseReagentsCache()
      console.log('[Store] 写仓库正本：', result.path)
      return { status: 'saved' }
    }
    if ('conflict' in result && result.conflict) {
      return { status: 'conflict', message: '仓库文件已被外部修改' }
    }
    const message = ('error' in result && result.error) || '写仓库正本失败'
    console.warn('[Store] 写仓库正本失败：', message)
    return { status: 'error', message }
  } catch (error) {
    console.error('[Store] 写仓库正本异常：', error)
    return { status: 'error', message: (error as Error).message }
  }
}

/** 旧接口：true = 真写进去了（护栏拒绝、冲突、失败都是 false） */
export async function saveWarehouseFile(
  snapshot: WarehouseSnapshot,
  options: WarehouseGuardOptions = {}
): Promise<boolean> {
  const result = await saveWarehouseFileDetailed(snapshot, options)
  return result.status === 'saved'
}

/**
 * 读 仓库.yml。
 * - state:'ok'：正常，snapshot 可用
 * - state:'missing'：文件不存在（调用方可以用数据库生成第一份）
 * - state:'broken'：**文件在，但读不懂**——只能读内存，绝不能写回
 */
export async function loadWarehouseFile(): Promise<WarehouseFileRead> {
  const dataRoot = api()
  if (!dataRoot) return { state: 'missing', warnings: [] }
  let read: Awaited<ReturnType<typeof dataRoot.readWarehouse>>
  try {
    read = await dataRoot.readWarehouse()
  } catch (error) {
    return { state: 'broken', warnings: [], error: (error as Error).message }
  }
  if (!read.ok) return { state: 'missing', warnings: [] }
  if (typeof read.content !== 'string' || read.content.trim() === '') {
    // 空文件：当成「还没有」而不是「坏了」，保留原有「由 DB 生成」的行为
    warehouseFileStat = read.stat ?? null
    return { state: 'missing', text: read.content ?? '', warnings: [] }
  }
  warehouseFileStat = read.stat ?? null
  const parsed = parseWarehouseYml(read.content)
  if (parsed.warnings.length > 0) console.warn('[Store] 仓库文件有问题：', parsed.warnings.join('；'))
  if (isBrokenWarehouseParse(parsed.warnings)) {
    return { state: 'broken', text: read.content, warnings: parsed.warnings }
  }
  return { state: 'ok', text: read.content, snapshot: parsed.snapshot, warnings: parsed.warnings }
}

/**
 * 把仓库正本恢复成 `previousText`（结算走到一半失败时的回滚）。
 *
 * 为什么不能走 `saveWarehouseFileDetailed`：那条路要过截断护栏，而「回滚」正好是
 * 一次合法的条数减少（把刚写进去的结算结果撤掉），护栏会把它当非显式删除拒掉，
 * 结果文件停在结算后状态、内存却回滚了，两边不一致。这里直接写**刚才那份原文**。
 *
 * 仍然带 expect（上次写成功后的 stat）：这期间被外部改过就 conflict、不覆盖。
 * 返回 true = 文件已恢复到原内容。
 */
export async function restoreWarehouseContent(previousText: string): Promise<boolean> {
  const dataRoot = api()
  if (!dataRoot) return false
  try {
    const result = await dataRoot.writeWarehouse({ content: previousText, expect: warehouseFileStat })
    if (result.ok) {
      warehouseFileStat = result.stat
      resetWarehouseReagentsCache()
      console.log('[Store] 仓库正本已恢复成结算前的内容')
      return true
    }
    if ('conflict' in result && result.conflict) {
      console.warn('[Store] 仓库正本恢复失败：文件已被外部修改，不覆盖')
      return false
    }
    console.warn('[Store] 仓库正本恢复失败：', 'error' in result ? result.error : result)
    return false
  } catch (error) {
    console.error('[Store] 仓库正本恢复异常：', error)
    return false
  }
}

/** 把读不懂的仓库文件另存一份留证（`仓库.broken-<时间戳>.yml`）；失败返回 null */export async function backupBrokenWarehouseFile(text: string): Promise<string | null> {
  const dataRoot = api()
  if (!dataRoot?.backupWarehouse) return null
  try {
    const result = await dataRoot.backupWarehouse({ content: text })
    return result.ok ? result.fileName : null
  } catch (error) {
    console.error('[Store] 备份坏仓库文件失败：', error)
    return null
  }
}

/** 数据库 → 仓库快照（文件缺失时用来生成第一份） */
export function snapshotFromDb(tubes: Tube[], groups: TubeGroup[], colors?: SubstanceColor[]): WarehouseSnapshot {
  return { reagents: tubes, groups, substanceColors: colors }
}
