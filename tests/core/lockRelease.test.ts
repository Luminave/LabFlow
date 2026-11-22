/**
 * 第 2 条：锁不能被互踢。
 *
 * 事故形状：`src/cli/commands.ts` 的 unlock 无条件删锁、主进程 lock:forceRelease 裸删、
 * 界面「强制解锁」直接调它 —— B 随手一解锁就把 A 的锁踢了，A 还在写文件却没人知道。
 * 现在：解锁/强制解锁都要 pid + agent (+ project) 与当前锁文件一致；不一致只提示、不删。
 */
import { describe, expect, it } from 'vitest'

import { checkLockRelease, lockOwnerLabel, type AgentLock } from '../../src/core/lock'

const A = 'codex/墨林'

function lockOf(over: Partial<AgentLock> = {}): AgentLock {
  return {
    pid: 4242,
    agent: A,
    project: '演示工程',
    note: '改浓度',
    startedAt: '2026-11-23T01:00:00.000Z',
    ...over
  }
}

describe('checkLockRelease：三元组对得上才允许删', () => {
  it('主人自己（pid+agent+project 一致）→ 允许', () => {
    const check = checkLockRelease(lockOf(), { pid: 4242, agent: A, project: '演示工程' })
    expect(check.ok).toBe(true)
  })

  it('B 用别的身份来解锁 → 拒，并指认锁属于谁', () => {
    const check = checkLockRelease(lockOf(), { pid: 9999, agent: 'codex/别家', project: '演示工程' })
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('锁属于')
    expect(check.reason).toContain(`${A}/4242`)
    expect(check.reason).toContain('未删除')
    // 说清是哪些字段不一致，方便人判断
    expect(check.reason).toContain('pid')
    expect(check.reason).toContain('agent')
  })

  it('只给 pid 和 agent（不带 project）也能过；project 只在给了才比', () => {
    expect(checkLockRelease(lockOf(), { pid: 4242, agent: A }).ok).toBe(true)
    expect(checkLockRelease(lockOf(), { pid: 4242, agent: A, project: '别的工程' }).ok).toBe(false)
  })

  it('工程名大小写/空格不影响判定', () => {
    expect(
      checkLockRelease(lockOf({ project: 'Demo Project' }), { pid: 4242, agent: A, project: ' demo project ' }).ok
    ).toBe(true)
  })

  it('显式 --force：明知不是自己的锁也照删', () => {
    const check = checkLockRelease(lockOf(), { pid: 9999, agent: 'b' }, { force: true })
    expect(check.ok).toBe(true)
  })

  it('没有锁 → 允许（没什么可删的）', () => {
    expect(checkLockRelease(null, { pid: 1, agent: 'x' }).ok).toBe(true)
  })

  it('锁文件损坏 → 没有三元组可校验，不许删，提示加 --force', () => {
    const check = checkLockRelease({ broken: true, raw: '{{{', reason: '不是合法的 JSON' }, { pid: 1, agent: A })
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('不是合法的 JSON')
    expect(check.reason).toContain('--force')
    expect(checkLockRelease({ broken: true, raw: '', reason: 'x' }, {}, { force: true }).ok).toBe(true)
  })

  it('pid 为 null 的锁：任何 pid 都对不上，只能 --force', () => {
    expect(checkLockRelease(lockOf({ pid: null }), { pid: 4242, agent: A }).ok).toBe(false)
  })

  it('lockOwnerLabel：pid 缺失时说「未知 pid」', () => {
    expect(lockOwnerLabel(lockOf())).toBe(`${A}/4242`)
    expect(lockOwnerLabel(lockOf({ pid: null }))).toBe(`${A}/未知 pid`)
  })
})
