/**
 * 深链接的「待处理槽」+ 投递策略（AI 提出，主人 2026-11-23 要求把 pending 抽成可单测模块）。
 *
 * 为什么要有它：冷启动时主进程一定比渲染层更早拿到链接。原先是把 URL 放在模块变量里、
 * 在 `did-finish-load` 里 `send` 一次——而渲染层的订阅是在 React effect 里注册的，
 * 比 load 事件更晚，那一次 send 就丢了（安装版实测：应用起来了，界面停在首页）。
 *
 * 现在的语义：
 *   1. 链接来了先 `push` 进槽里，**一直留着**；
 *   2. 渲染层挂载、订阅好之后调 `takeForRenderer()` 主动取走（取走即清空，只返回一次）；
 *   3. 只有「渲染层已就绪 && 页面不在加载中」时 `canPushNow()` 才为真，热投递才直接 push。
 *      冷启动期间永远不 push，所以同一条链接不会被「push + 拉」处理两遍。
 *
 * 故意不引入 electron：纯逻辑，方便单测。
 * 只保留最新一条（和原来的行为一致：一次只能导航到一个工程，后到的覆盖前一条）。
 */
export interface DeepLinkQueue {
  /** 记下一条待处理链接；空串 / 纯空白 / 非字符串会被忽略 */
  push(url: string): void
  /** 看一眼，不取走 */
  peek(): string | null
  /** 渲染层就绪并取走：置就绪标记 + 取走并清空；没有待处理时返回 null */
  takeForRenderer(): string | null
  /** 页面开始（重新）加载：渲染层要重新订阅，就绪标记作废 */
  resetRenderer(): void
  /** 现在能不能直接把链接 push 给渲染层（否则必须先留在槽里等它来取） */
  canPushNow(loadingMainFrame: boolean): boolean
  /** 直接丢弃 */
  clear(): void
  /** 当前是否有一条待处理链接（0 或 1） */
  size(): number
}

export function createDeepLinkQueue(): DeepLinkQueue {
  let current: string | null = null
  let rendererReady = false

  return {
    push(url: string): void {
      const text = typeof url === 'string' ? url.trim() : ''
      if (!text) return
      current = text
    },
    peek(): string | null {
      return current
    },
    takeForRenderer(): string | null {
      rendererReady = true
      const url = current
      current = null
      return url
    },
    resetRenderer(): void {
      rendererReady = false
    },
    canPushNow(loadingMainFrame: boolean): boolean {
      return rendererReady && !loadingMainFrame
    },
    clear(): void {
      current = null
    },
    size(): number {
      return current ? 1 : 0
    }
  }
}
