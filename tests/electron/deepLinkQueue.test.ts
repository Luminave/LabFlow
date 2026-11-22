/**
 * 回归（2026-11-23 安装版冷启动）：点 `labflow://open?project=261118` 能把应用叫起来，
 * 但界面停在首页。原因是主进程只在 `did-finish-load` 里 push 一次，而渲染层的订阅
 * 在 React effect 里注册、比 load 更晚，那一次 send 被丢掉，且没有任何补救机会。
 *
 * 修法是把待处理链接放进 `electron/deepLinkQueue.ts` 这个槽里，
 * 语义是「一直保留，直到渲染层 takeForRenderer() 取走」。
 * 这里锁住这个纯逻辑：取一次就空、没有就 null、冷启动期间不许直接 push。
 */
import { describe, expect, it } from 'vitest'

import { createDeepLinkQueue } from '../../electron/deepLinkQueue'

const LINK = 'labflow://open?project=261118'

describe('createDeepLinkQueue：冷启动待处理槽', () => {
  it('没有 pending 时 takeForRenderer 返回 null', () => {
    const queue = createDeepLinkQueue()
    expect(queue.takeForRenderer()).toBeNull()
    expect(queue.size()).toBe(0)
  })

  it('先有 pendingLink → takeForRenderer 拿到，第二次为空（只返回一次）', () => {
    const queue = createDeepLinkQueue()
    queue.push(LINK)

    expect(queue.takeForRenderer()).toBe(LINK)
    expect(queue.takeForRenderer()).toBeNull()
    expect(queue.peek()).toBeNull()
  })

  it('peek 不消费：push 后 peek 能反复看到同一条，取走之后才空', () => {
    const queue = createDeepLinkQueue()
    queue.push(LINK)

    expect(queue.peek()).toBe(LINK)
    expect(queue.peek()).toBe(LINK)
    expect(queue.size()).toBe(1)

    expect(queue.takeForRenderer()).toBe(LINK)
    expect(queue.peek()).toBeNull()
  })

  it('连续 push 多条只保留最新一条（一次只能导航到一个工程）', () => {
    const queue = createDeepLinkQueue()
    queue.push('labflow://open?project=AD-5.2')
    queue.push(LINK)

    expect(queue.size()).toBe(1)
    expect(queue.takeForRenderer()).toBe(LINK)
  })

  it('空串、纯空白、非字符串都被忽略', () => {
    const queue = createDeepLinkQueue()
    queue.push('')
    queue.push('   ')
    // @ts-expect-error 故意传错类型：IPC 来的值不可信
    queue.push(null)

    expect(queue.peek()).toBeNull()
    expect(queue.takeForRenderer()).toBeNull()
  })

  it('clear 后取走为 null', () => {
    const queue = createDeepLinkQueue()
    queue.push(LINK)
    queue.clear()

    expect(queue.size()).toBe(0)
    expect(queue.takeForRenderer()).toBeNull()
  })

  it('两个队列实例互不影响', () => {
    const first = createDeepLinkQueue()
    const second = createDeepLinkQueue()
    first.push(LINK)

    expect(second.takeForRenderer()).toBeNull()
    expect(first.takeForRenderer()).toBe(LINK)
  })
})

describe('createDeepLinkQueue：投递时机（冷启动不抢跑）', () => {
  it('渲染层还没来取之前，任何情况都不许直接 push', () => {
    const queue = createDeepLinkQueue()
    queue.push(LINK)

    // 页面不在加载也一样：监听器还没人挂上，send 出去就是丢
    expect(queue.canPushNow(false)).toBe(false)
    expect(queue.canPushNow(true)).toBe(false)
    expect(queue.peek()).toBe(LINK)
  })

  it('渲染层取过一次之后才允许 push；页面加载中仍然不许', () => {
    const queue = createDeepLinkQueue()
    expect(queue.takeForRenderer()).toBeNull()

    expect(queue.canPushNow(false)).toBe(true)
    expect(queue.canPushNow(true)).toBe(false)
  })

  it('页面重新加载（resetRenderer）后回到「只能留着等取」', () => {
    const queue = createDeepLinkQueue()
    queue.takeForRenderer()
    expect(queue.canPushNow(false)).toBe(true)

    queue.resetRenderer()
    expect(queue.canPushNow(false)).toBe(false)

    // reset 只作废「就绪」标记，不影响已经排在槽里的链接
    queue.push(LINK)
    expect(queue.peek()).toBe(LINK)
    expect(queue.takeForRenderer()).toBe(LINK)
    expect(queue.canPushNow(false)).toBe(true)
  })

  it('冷启动全景：链接先入槽 → 不 push → 渲染层取一次 → 之后热投递可 push', () => {
    const queue = createDeepLinkQueue()

    // 1) 主进程在 createWindow 之前就拿到链接（app.whenReady 里的顺序）
    queue.push(LINK)
    // 2) did-finish-load 不再抢发，所以这里判定为「不能 push」
    expect(queue.canPushNow(false)).toBe(false)
    // 3) 渲染层挂载、订阅完，主动来取
    expect(queue.takeForRenderer()).toBe(LINK)
    // 4) 第二次点击链接（热投递）：直接 push 即可
    expect(queue.canPushNow(false)).toBe(true)
    // 5) 槽已空，不会把同一条再处理一遍
    expect(queue.takeForRenderer()).toBeNull()
  })
})
