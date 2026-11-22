/**
 * 数据正本目录的启动挂载（第 1 步）。
 *
 * 规则（2026-11-22 修订，实测踩过两次坑之后定的）：
 * 1. **启动阶段只读不写**：`仓库.yml` 存在 → 用它覆盖内存；不存在 → 才由数据库生成一次并打日志。
 *    任何情况下启动都不许改写已经存在的正本（曾经因为订阅 store 把 39 条写成 13 条）。
 * 2. 只有「真的改了仓库」（add/update/delete/status、分组变更）才回写，且写之前做**截断护栏**。
 *
 * 2026-11 再修（三条）：
 * - 仓库文件**存在但读不懂**：只读内存（数据库），绝不写回；坏文件另存 `仓库.broken-<时间戳>.yml`，并提示。
 * - 写盘带 expect：文件被外部改过时不写，重读文件、更新内存，并提示「已重新载入」。
 * - 删除试剂是显式动作：允许落盘（`explicitDelete`），非删除路径的骤降仍拒绝。
 */

import { useEffect } from 'react'

import { showGlobalToast } from '../components/GlobalToast'
import { useGroupStore } from '../stores/groupStore'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { useWarehouseStore } from '../stores/warehouseStore'
import {
  backupBrokenWarehouseFile,
  isWarehouseFileAvailable,
  loadWarehouseFile,
  saveWarehouseFileDetailed,
  snapshotFromDb,
  type WarehouseFileRead,
  type WarehouseGuardOptions
} from './warehouseSource'
import { setWarehouseWriter, type WarehouseFlushResult, type WarehouseWriteOptions } from './warehouseWriteQueue'

let writeTimer: ReturnType<typeof setTimeout> | null = null
/** 防抖窗口里攒下的「显式删除」试剂 id；explicitDeleteAll = 本次写盘可为任意删除负责 */
const explicitDeletes = new Set<string>()
let explicitDeleteAll = false

function currentSnapshot() {
  return snapshotFromDb(
    useWarehouseStore.getState().tubes,
    useGroupStore.getState().groups,
    [...useSubstanceColorStore.getState().colors.values()]
  )
}

function takePendingDeletes(): WarehouseGuardOptions {
  const options: WarehouseGuardOptions = explicitDeleteAll
    ? { explicitDelete: true }
    : explicitDeletes.size > 0
      ? { explicitDelete: [...explicitDeletes] }
      : {}
  explicitDeleteAll = false
  explicitDeletes.clear()
  return options
}

function rememberDeletes(options?: WarehouseWriteOptions): void {
  const deletes = options?.explicitDelete
  if (!deletes) return
  if (deletes === true) {
    explicitDeleteAll = true
    return
  }
  for (const id of deletes) explicitDeletes.add(id)
}

/** 用文件里的内容覆盖内存（冲突恢复 / 热加载都用它） */
export async function reloadWarehouseFromFile(): Promise<boolean> {
  const loaded = await loadWarehouseFile()
  if (loaded.state !== 'ok' || !loaded.snapshot) return false
  useWarehouseStore.getState().setTubes(loaded.snapshot.reagents)
  useGroupStore.getState().setGroups(loaded.snapshot.groups)
  if (loaded.snapshot.substanceColors && loaded.snapshot.substanceColors.length > 0) {
    // 成分颜色存在 仓库.yml 里，文件里有就跟着换（store 没有批量 setter，逐条写内存即可）
    for (const item of loaded.snapshot.substanceColors) {
      void useSubstanceColorStore.getState().setColor(item.name, item.color, item.bgColor)
    }
  }
  return true
}

/**
 * 真写一次盘。
 * 冲突（文件被外部改过）→ 不写、重读文件、更新内存、提示；然后把结果交回调用方。
 * 导出给单测，以及以后需要「立刻落盘并等结果」的调用方。
 */
export async function writeWarehouseNow(options?: WarehouseWriteOptions): Promise<WarehouseFlushResult> {
  if (!isWarehouseFileAvailable()) return { ok: false, message: '当前没有桌面应用，仓库正本写不了' }
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  rememberDeletes(options)
  const guard = takePendingDeletes()
  const result = await saveWarehouseFileDetailed(currentSnapshot(), guard)

  if (result.status === 'saved') return { ok: true }

  if (result.status === 'conflict') {
    const reloaded = await reloadWarehouseFromFile()
    showGlobalToast(
      reloaded ? '仓库文件已被外部修改，已重新载入' : '仓库文件已被外部修改，重新载入失败，请检查 仓库.yml'
    )
    return { ok: false, conflict: true, message: '仓库文件已被外部修改，已重新载入' }
  }

  if (result.status === 'guard') {
    showGlobalToast(`未写仓库文件：${result.message ?? '条数骤降'}`)
    return { ok: false, message: result.message }
  }

  showGlobalToast(`写仓库文件失败：${result.message ?? '未知错误'}`)
  return { ok: false, message: result.message }
}

/** 防抖写盘：一次连带改动只写一次 */
function scheduleWarehouseWrite(delay = 400, options?: WarehouseWriteOptions): void {
  if (!isWarehouseFileAvailable()) return
  rememberDeletes(options)
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void writeWarehouseNow()
  }, delay)
}

/**
 * 在 App 顶层调用一次。
 * 顺序很关键：**先把数据库读进内存，再决定文件是「读」还是「生成」**。
 */
/** 启动序列（可注入依赖，方便单测断言「文件存在/坏掉时一次都不写」） */
export interface WarehouseBootstrapDeps {
  loadFile: () => Promise<WarehouseFileRead>
  saveFile: (snapshot: unknown) => Promise<boolean>
  currentSnapshot: () => unknown
  applyTubes: (tubes: unknown[]) => void
  applyGroups: (groups: unknown[]) => void
  /** 坏文件留证：返回备份文件名（拿不到就 null） */
  backupFile?: (text: string) => Promise<string | null>
  notify?: (message: string) => void
  log?: (message: string) => void
}

export type WarehouseBootstrapPlan = 'used-file' | 'generated' | 'skipped' | 'kept-broken'

export async function bootstrapWarehouseFile(deps: WarehouseBootstrapDeps): Promise<WarehouseBootstrapPlan> {
  const log = deps.log ?? ((m: string) => console.log(m))
  const notify = deps.notify ?? (() => {})
  const file = await deps.loadFile()

  // 文件在，但读不懂：只读内存，绝不写回；坏文件另存留证
  if (file.state === 'broken') {
    const backupName = file.text && deps.backupFile ? await deps.backupFile(file.text) : null
    const reason = file.error || file.warnings[0] || '内容无法解析'
    log(`[Store] 仓库正本读不懂（${reason}），本次只用数据库里的内容，不回写文件`)
    notify(
      backupName
        ? `仓库.yml 读不懂（${reason}），本次只用数据库内容，未回写；原文件已备份为 ${backupName}`
        : `仓库.yml 读不懂（${reason}），本次只用数据库内容，未回写`
    )
    return 'kept-broken'
  }

  const snapshot = file.state === 'ok' ? file.snapshot : undefined
  const hasFile = Boolean(snapshot && (snapshot.reagents.length > 0 || snapshot.groups.length > 0))

  if (hasFile && snapshot) {
    // 文件是真相：只读不写
    deps.applyTubes(snapshot.reagents)
    deps.applyGroups(snapshot.groups)
    log(`[Store] 仓库正本已载入：${snapshot.reagents.length} 种试剂 / ${snapshot.groups.length} 个分组`)
    return 'used-file'
  }

  // 只有文件不存在（或读不出东西）时才由数据库生成一次
  const nextSnapshot = deps.currentSnapshot()
  const ok = await deps.saveFile(nextSnapshot)
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
        saveFile: snapshot => saveWarehouseFileDetailed(snapshot as never).then(result => result.status === 'saved'),
        currentSnapshot,
        applyTubes: tubes => useWarehouseStore.getState().setTubes(tubes as never),
        applyGroups: groups => useGroupStore.getState().setGroups(groups as never),
        backupFile: backupBrokenWarehouseFile,
        notify: showGlobalToast
      })
      if (cancelled) return

      // 之后只有「显式改了仓库」才回写（不再订阅数组，避免被试管溯源页的临时列表污染）
      setWarehouseWriter((options, immediate) =>
        immediate ? writeWarehouseNow(options) : scheduleWarehouseWrite(400, options)
      )
    }

    void bootstrap()
    return () => {
      cancelled = true
      setWarehouseWriter(null)
    }
  }, [])
}
