/**
 * 「该回写仓库正本了」的请求队列。
 *
 * 为什么不直接订阅 store：仓库试管列表是**多个页面共用的**，
 * 试管溯源页（TracePage）会把它临时换成自己的追踪列表（13 条），
 * 订阅整份数组就会把 仓库.yml 写成那 13 条——实测踩过一次（39 → 13）。
 *
 * 所以改成「谁真的改了仓库，谁显式喊一声」，再由 warehouseSync 去写盘。
 */

type Writer = () => void

let writer: Writer | null = null
let pending = false

/** 由 warehouseSync 注册真正的写盘函数 */
export function setWarehouseWriter(fn: Writer | null): void {
  writer = fn
  if (fn && pending) {
    pending = false
    fn()
  }
}

/** 仓库数据（试剂/分组）被真正改动后调用 */
export function requestWarehouseWrite(): void {
  if (writer) writer()
  else pending = true
}
