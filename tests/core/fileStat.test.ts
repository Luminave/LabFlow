/**
 * 第 6 条：冲突判定以**内容哈希**为准（mtime 只当快速路径）。
 *
 * 事故形状：文件被同内容重写一次（编辑器保存、备份工具回写、同步盘碰一下），
 * mtime 变了、内容没变；旧逻辑只比 mtime，于是之后每次保存都被判「已被外部修改」，
 * 一直弹框、一直存不进去。现在：mtime 变了但 hash 一样 → 无冲突，直接放行。
 */
import { describe, expect, it } from 'vitest'

import { checkExpectedContent, hashContent, statWithHash } from '../../src/core/store/fileStat'

const TEXT = 'schemaVersion: 2\nname: 演示工程\n'

describe('hashContent / statWithHash', () => {
  it('同内容同 hash，不同内容不同 hash', () => {
    expect(hashContent(TEXT)).toBe(hashContent(`${TEXT}`))
    expect(hashContent(TEXT)).not.toBe(hashContent(`${TEXT}\n# 改了一个字`))
  })

  it('statWithHash 把 hash 挂到 stat 上，读不到内容时只有 mtime/size', () => {
    const withHash = statWithHash({ mtimeMs: 100, size: 10 }, TEXT)
    expect(withHash.hash).toBe(hashContent(TEXT))
    expect(statWithHash({ mtimeMs: 100, size: 10 }, null)).toEqual({ mtimeMs: 100, size: 10 })
    expect(statWithHash(null, TEXT)).toBeNull()
  })
})

describe('checkExpectedContent：mtime 变了但内容没变 → 不算冲突', () => {
  it('同内容重写（mtime 前进、size 相同）→ conflict: false', () => {
    const expectStat = statWithHash({ mtimeMs: 1000, size: TEXT.length }, TEXT)!
    // 外部把文件原样重写了一遍：mtime 变成 5000
    const current = { mtimeMs: 5000, size: TEXT.length }
    const check = checkExpectedContent(current, TEXT, expectStat)
    expect(check.conflict).toBe(false)
    // 顺手把新 stat（含 hash）还回去，调用方好更新记录
    expect(check.stat.hash).toBe(expectStat.hash)
  })

  it('内容真的变了 → conflict: true', () => {
    const expectStat = statWithHash({ mtimeMs: 1000, size: TEXT.length }, TEXT)!
    const changed = `${TEXT}mutated: true\n`
    const check = checkExpectedContent({ mtimeMs: 5000, size: changed.length }, changed, expect)
    expect(check.conflict).toBe(true)
  })

  it('同一个 mtime 下内容被换掉（size 也相同）→ 仍然报冲突', () => {
    const expectStat = statWithHash({ mtimeMs: 1000, size: TEXT.length }, TEXT)!
    const rewritten = TEXT.replace('演示工程', '换了个名')
    const check = checkExpectedContent({ mtimeMs: 1000, size: rewritten.length }, rewritten, expect)
    expect(check.conflict).toBe(true)
  })
})

describe('checkExpectedContent：其它情形', () => {
  it('expect 为 null（第一次写）→ 不冲突', () => {
    expect(checkExpectedContent({ mtimeMs: 1, size: 1 }, 'x', null).conflict).toBe(false)
  })

  it('文件没了 → 不冲突（照写）', () => {
    expect(checkExpectedContent(null, null, { mtimeMs: 1, size: 1, hash: 'abc' }).conflict).toBe(false)
  })

  it('老调用方只给 mtime/size（没有 hash）→ 退回 mtime 判定，行为与以前一致', () => {
    const expectStat = { mtimeMs: 1000, size: 10 }
    expect(checkExpectedContent({ mtimeMs: 1000, size: 10 }, null, expectStat).conflict).toBe(false)
    expect(checkExpectedContent({ mtimeMs: 4000, size: 10 }, null, expectStat).conflict).toBe(true)
    expect(checkExpectedContent({ mtimeMs: 1000, size: 99 }, null, expectStat).conflict).toBe(true)
  })

  it('mtime 只差 1ms 以内当没变（文件系统的精度噪声）', () => {
    const expectStat = { mtimeMs: 1000, size: 10 }
    expect(checkExpectedContent({ mtimeMs: 1001, size: 10 }, null, expectStat).conflict).toBe(false)
  })
})
