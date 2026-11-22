/**
 * 数据正本目录的启动挂载（第 1 步）。
 *
 * 规则（2026-11-22 修订，实测踩过两次坑之后定的）：
 * 1. **启动阶段只读不写**：`仓库.yml` 存在 → 用它覆盖内存；不存在 → 才由数据库生成一次并打日志。
 *    任何情况下启动都不许改写已经存在的正本（曾经因为订阅 store 把 39 条写成 13 条）。
 * 2. 只有「真的改了仓库」（add/update/delete/status、分组变更）才回写，且写之前做**截断护栏**：
 *    新内容的试剂条数少于现有文件或少于数据库里的条数，一律拒绝写并报错。
 */

import { useEffect } from 'react'

import { useGroupStore } from '../stores/groupStore'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { useWarehouseStore } from '../stores/warehouseStore'
import {
  isWarehouseFileAvailable,
  loadWarehouseFile,
  saveWarehouseFile,
  snapshotFromDb
} from './warehouseSource'
import { parseWarehouseYml } from '@/core/store/warehouseFile'
import { setWarehouseWriter } from './warehouseWriteQueue'

let writeTimer: ReturnType<typeof setTimeout> | null = null

function currentSnapshot() {
  return snapshotFromDb(
    useWarehouseStore.getState().tubes,
    useGroupStore.getState().groups,
    [...useSubstanceColorStore.getState().colors.values()]
  )
}

/** 防抖写盘：一次连带改动只写一次 */
function scheduleWarehouseWrite(delay = 400): void {
  if (!isWarehouseFileAvailable()) return
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void saveWarehouseFile(currentSnapshot())
  }, delay)
}

/**
 * 在 App 顶层调用一次。
 * 顺序很关键：**先把数据库读进内存，再决定文件是「读」还是「生成」**。
 */
/** 启动序列（可注入依赖，方便单测断言「文件存在时一次都不写」） */
export interface WarehouseBootstrapDeps {
  loadFile: () => Promise<{ snapshot: { reagents: unknown[]; groups: unknown[] } } | null>
  saveFile: (snapshot: unknown) => Promise<boolean>
  currentSnapshot: () => unknown
  applyTubes: (tubes: unknown[]) => void
  applyGroups: (groups: unknown[]) => void
  log?: (message: string) => void
}

export type WarehouseBootstrapPlan = 'used-file' | 'generated' | 'skipped'

export async function bootstrapWarehouseFile(deps: WarehouseBootstrapDeps): Promise<WarehouseBootstrapPlan> {
  const log = deps.log ?? ((m: string) => console.log(m))
  const file = await deps.loadFile()
  const hasFile = Boolean(file && (file.snapshot.reagents.length > 0 || file.snapshot.groups.length > 0))

  if (hasFile) {
    // 文件是真相：只读不写
    deps.applyTubes(file!.snapshot.reagents)
    deps.applyGroups(file!.snapshot.groups)
    log(
      `[Store] 仓库正本已载入：${file!.snapshot.reagents.length} 种试剂 / ${file!.snapshot.groups.length} 个分组`
    )
    return 'used-file'
  }

  // 只有文件不存在（或读不出东西）时才由数据库生成一次
  const snapshot = deps.currentSnapshot()
  const ok = await deps.saveFile(snapshot)
  if (ok) log('[Store] 由 DB 生成 仓库.yml')
  return ok ? 'generated' : 'skipped'
}

export function useWarehouseFileSync(): void {
  useEffect(() => {
    if (!isWarehouseFileAvailable()) return
    let cancelled = false

    const bootstrap = async () => {
      await Promise.all([
        useWarehouseStore.getState().fetchTubes(),
        useGroupStore.getState().loadGroups(),
        useSubstanceColorStore.getState().loadColors()
      ])
      if (cancelled) return

      await bootstrapWarehouseFile({
        loadFile: loadWarehouseFile,
        saveFile: snapshot => saveWarehouseFile(snapshot as never),
        currentSnapshot,
        applyTubes: tubes => useWarehouseStore.getState().setTubes(tubes as never),
        applyGroups: groups => useGroupStore.getState().setGroups(groups as never)
      })
      if (cancelled) return

      // 之后只有「显式改了仓库」才回写（不再订阅数组，避免被试管溯源页的临时列表污染）
      setWarehouseWriter(() => scheduleWarehouseWrite())
    }

    void bootstrap()
    return () => {
      cancelled = true
      setWarehouseWriter(null)
    }
  }, [])
}
