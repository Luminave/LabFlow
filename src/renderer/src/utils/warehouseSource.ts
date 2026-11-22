/**
 * 仓库正本的读写编排：`仓库.yml`
 *
 * 与工程正本同一套思路：文件是真相，数据库是缓存。
 * 这里只管「什么时候写」，内容序列化在 `src/core/store/warehouseFile.ts`。
 */

import type { SubstanceColor, Tube, TubeGroup } from '@shared/types'
import { parseWarehouseYml, toWarehouseYml, type WarehouseSnapshot } from '@/core/store/warehouseFile'

function api() {
  return typeof window !== 'undefined' ? window.electronAPI?.dataRoot : undefined
}

export function isWarehouseFileAvailable(): boolean {
  return Boolean(api())
}

/**
 * 截断护栏：新内容的试剂条数比「现有文件」或「数据库」少，就拒绝写。
 * 返回 null = 允许写；返回字符串 = 拒绝原因。
 * （2026-11-22 修：曾经因为试管溯源页把 store 换成 13 条，把 39 条的仓库写成 13 条。）
 */
export async function warehouseTruncationGuard(nextCount: number): Promise<string | null> {
  const dataRoot = api()
  if (!dataRoot) return null

  try {
    const existing = await dataRoot.readWarehouse()
    if (existing.ok && existing.content) {
      const prev = parseWarehouseYml(existing.content).snapshot.reagents.length
      if (prev > 0 && nextCount < prev) return `试剂从 ${prev} 条降到 ${nextCount} 条`
    }
  } catch {
    /* 读不到就跳过这项护栏 */
  }

  try {
    const rows = await window.electronAPI?.getTubes?.()
    const dbCount = Array.isArray(rows) ? rows.length : 0
    if (dbCount > 0 && nextCount < dbCount) return `试剂比数据库里的 ${dbCount} 条少（只有 ${nextCount} 条）`
  } catch {
    /* 同上 */
  }

  return null
}

/** 写 仓库.yml（原子写 + 截断护栏；不检查冲突——仓库改动都是 LabFlow 自己做的） */
export async function saveWarehouseFile(snapshot: WarehouseSnapshot): Promise<boolean> {
  const dataRoot = api()
  if (!dataRoot) return false
  try {
    const refusal = await warehouseTruncationGuard(snapshot.reagents.length)
    if (refusal) {
      console.error(`[Store] 拒绝写仓库正本：${refusal}`)
      return false
    }
    const content = toWarehouseYml(snapshot)
    const result = await dataRoot.writeWarehouse({ content })
    if (!result.ok) {
      console.warn('[Store] 写仓库正本失败：', result)
      return false
    }
    console.log('[Store] 写仓库正本：', result.path)
    return true
  } catch (error) {
    console.error('[Store] 写仓库正本异常：', error)
    return false
  }
}

/** 读 仓库.yml；不存在返回 null（调用方决定要不要用数据库生成一份） */
export async function loadWarehouseFile(): Promise<{ snapshot: WarehouseSnapshot; warnings: string[] } | null> {
  const dataRoot = api()
  if (!dataRoot) return null
  const read = await dataRoot.readWarehouse()
  if (!read.ok || !read.content) return null
  const parsed = parseWarehouseYml(read.content)
  if (parsed.warnings.length > 0) console.warn('[Store] 仓库文件有问题：', parsed.warnings.join('；'))
  return parsed
}

/** 数据库 → 仓库快照（文件缺失时用来生成第一份） */
export function snapshotFromDb(tubes: Tube[], groups: TubeGroup[], colors?: SubstanceColor[]): WarehouseSnapshot {
  return { reagents: tubes, groups, substanceColors: colors }
}
