/**
 * 「该回写仓库正本了」的请求队列。
 *
 * 为什么不直接订阅 store：仓库试管列表是**多个页面共用的**，
 * 试管溯源页（TracePage）会把它临时换成自己的追踪列表（13 条），
 * 订阅整份数组就会把 仓库.yml 写成那 13 条——实测踩过一次（39 → 13）。
 *
 * 所以改成「谁真的改了仓库，谁显式喊一声」，再由 warehouseSync 去写盘。
 *
 * 2026-11 修：
 * - 请求可以带「显式删除」标记（删试剂要真的落盘，但非删除路径的骤降仍要拒）。
 * - 新增 `flushWarehouseWrite`：结束实验要**等**文件写成功再改数据库，不能靠 400ms 防抖。
 */

export interface WarehouseWriteOptions {
  /** 见 warehouseSource 的 WarehouseGuardOptions.explicitDelete */
  explicitDelete?: true | string[]
}

export interface WarehouseFlushResult {
  ok: boolean
  /** 写盘时发现文件被外部改过（此时没有写） */
  conflict?: boolean
  message?: string
}

type Writer = (
  options?: WarehouseWriteOptions,
  /** true = 立刻写、别等防抖（结束实验要等结果） */
  immediate?: boolean
) => void | Promise<WarehouseFlushResult | void>

let writer: Writer | null = null
let pending = false

/** 由 warehouseSync 注册真正的写盘函数 */
export function setWarehouseWriter(fn: Writer | null): void {
  writer = fn
  if (fn && pending) {
    pending = false
    void fn()
  }
}

/** 仓库数据（试剂/分组）被真正改动后调用；options.explicitDelete 见上 */
export function requestWarehouseWrite(options?: WarehouseWriteOptions): void {
  if (writer) void writer(options)
  else pending = true
}

/**
 * 立刻写盘并等结果（结束实验这类「要么全成、要么全不成」的流程用）。
 * 没注册写盘函数时：浏览器预览（没有桌面应用）照旧返回 ok；
 * 但**桌面版里通道没挂上就是「仓库没写」**，不能假装成功，返回 ok:false 让调用方拒掉整次结算。
 */
export async function flushWarehouseWrite(options?: WarehouseWriteOptions): Promise<WarehouseFlushResult> {
  if (!writer) {
    const desktop = typeof window !== 'undefined' && Boolean(window.electronAPI?.dataRoot)
    return desktop
      ? { ok: false, message: '仓库正本的写入通道还没准备好，请稍后重试' }
      : { ok: true }
  }
  const result = await writer(options, true)
  if (result && typeof result === 'object') return result
  return { ok: true }
}
