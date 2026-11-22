import { describe, expect, it } from 'vitest'

import { classifyStoreEvent, createWriteTracker, mergeStoreChanges } from '../../electron/storeWatcher'

describe('热加载：事件分类', () => {
  it('锁 / 仓库 / 工程 / 其它 分得清', () => {
    expect(classifyStoreEvent('.agent-lock')).toEqual({ kind: 'lock' })
    expect(classifyStoreEvent('仓库.yml')).toEqual({ kind: 'warehouse' })
    expect(classifyStoreEvent('工程/AD-5.2.yml')).toEqual({ kind: 'project', projectFile: 'AD-5.2.yml' })
    expect(classifyStoreEvent('工程\\261118.yml')).toEqual({ kind: 'project', projectFile: '261118.yml' })
    expect(classifyStoreEvent('导出/SOP.md')).toEqual({ kind: 'other' })
  })

  it('原子写的临时文件不算工程变更', () => {
    expect(classifyStoreEvent('工程/AD-5.2.yml.1234.tmp').kind).toBe('other')
  })
})

describe('热加载：防自激（自己写的不回声）', () => {
  it('自己刚写的内容，watcher 再看到同一份 → 不广播', () => {
    const tracker = createWriteTracker()
    tracker.noteWritten('/data/工程/AD-5.2.yml', 'a: 1')
    expect(tracker.shouldBroadcast('/data/工程/AD-5.2.yml', 'a: 1')).toBe(false)
  })

  it('外部改成不同内容 → 广播；同一份外部内容只广播一次', () => {
    const tracker = createWriteTracker()
    tracker.noteWritten('/data/仓库.yml', 'reagents: []')

    expect(tracker.shouldBroadcast('/data/仓库.yml', 'reagents: [1]')).toBe(true)
    // 一次保存会连着来好几个 fs 事件，内容没变就不该再广播
    expect(tracker.shouldBroadcast('/data/仓库.yml', 'reagents: [1]')).toBe(false)
  })

  it('文件被删掉也算变化', () => {
    const tracker = createWriteTracker()
    tracker.noteWritten('/data/工程/x.yml', 'a: 1')
    expect(tracker.shouldBroadcast('/data/工程/x.yml', null)).toBe(true)
  })

  it('两个文件互不影响', () => {
    const tracker = createWriteTracker()
    tracker.noteWritten('/data/工程/a.yml', 'x')
    expect(tracker.shouldBroadcast('/data/工程/b.yml', 'x')).toBe(true)
    expect(tracker.shouldBroadcast('/data/工程/a.yml', 'x')).toBe(false)
  })
})

describe('热加载：事件合并', () => {
  it('连着来的几个事件合并成一次广播', () => {
    const merged = mergeStoreChanges(
      [{ warehouse: false, projects: ['a.yml'] }],
      { warehouse: true, projects: ['b.yml', 'a.yml'] }
    )
    expect(merged.warehouse).toBe(true)
    expect(merged.projects.sort()).toEqual(['a.yml', 'b.yml'])
  })
})
