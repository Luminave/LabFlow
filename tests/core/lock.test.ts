import { describe, expect, it } from 'vitest'

import {
  LOCK_STALE_MINUTES,
  formatLockAge,
  formatLockBanner,
  lockAgeMinutes,
  lockTargetsProject,
  parseAgentLock,
  type AgentLock
} from '../../src/core/lock'

const SAMPLE = `{
  "pid": 12345,
  "agent": "codex/墨林",
  "project": "AD-5.2",
  "note": "改 12 个样品浓度",
  "startedAt": "2026-11-22T15:40:00.000Z"
}`

function minutesAgo(minutes: number): number {
  return Date.parse('2026-11-22T15:40:00.000Z') + minutes * 60 * 1000
}

describe('Agent 锁：解析', () => {
  it('正常锁能解出五个字段', () => {
    const lock = parseAgentLock(SAMPLE)
    expect(lock).not.toBeNull()
    if (!lock || 'broken' in lock) throw new Error('应当解析成功')
    expect(lock.pid).toBe(12345)
    expect(lock.agent).toBe('codex/墨林')
    expect(lock.project).toBe('AD-5.2')
    expect(lock.note).toBe('改 12 个样品浓度')
    expect(lock.startedAt).toBe('2026-11-22T15:40:00.000Z')
  })

  it('空内容视为没有锁（返回 null）', () => {
    expect(parseAgentLock('')).toBeNull()
    expect(parseAgentLock('   \n ')).toBeNull()
    expect(parseAgentLock(null)).toBeNull()
  })

  it('坏 JSON 返回 broken 且不抛，raw 原样带回', () => {
    const lock = parseAgentLock('{"project": "AD-5.2"')
    expect(lock && 'broken' in lock).toBe(true)
    if (lock && 'broken' in lock) {
      expect(lock.raw).toBe('{"project": "AD-5.2"')
      expect(lock.reason).toContain('JSON')
    }
  })

  it('JSON 不是对象（数组/字符串）也算坏', () => {
    expect(parseAgentLock('[]') && 'broken' in (parseAgentLock('[]') as object)).toBe(true)
    expect(parseAgentLock('"abc"') && 'broken' in (parseAgentLock('"abc"') as object)).toBe(true)
  })

  it('缺 project 字段算坏，并说明缺什么', () => {
    const lock = parseAgentLock('{"note":"随便改改"}')
    expect(lock && 'broken' in lock).toBe(true)
    if (lock && 'broken' in lock) expect(lock.reason).toContain('project')
  })

  it('缺 note / startedAt 不报错，给空串与「刚刚」', () => {
    const lock = parseAgentLock('{"project":"AD-5.2"}')
    expect(lock && !('broken' in lock)).toBe(true)
    if (lock && !('broken' in lock)) {
      expect(lock.note).toBe('')
      expect(lock.pid).toBeNull()
      expect(lockAgeMinutes(lock, Date.now())).toBe(0)
    }
  })
})

describe('Agent 锁：是否本工程', () => {
  const lock: AgentLock = {
    pid: 1,
    agent: 'a',
    project: 'AD-5.2',
    note: '',
    startedAt: '2026-11-22T15:40:00.000Z'
  }

  it('工程名相同 → 命中', () => {
    expect(lockTargetsProject(lock, { name: 'AD-5.2', id: 'x' })).toBe(true)
  })

  it('工程 id 相同（锁里写的是 id）→ 命中', () => {
    expect(lockTargetsProject({ ...lock, project: 'abc-123' }, { name: 'AD-5.2', id: 'abc-123' })).toBe(true)
  })

  it('名字大小写不同仍算命中（宁可多冻一次，也别让 Agent 和人同时改）', () => {
    expect(lockTargetsProject(lock, { name: 'ad-5.2' })).toBe(true)
  })

  it('别的工程 → 不命中', () => {
    expect(lockTargetsProject(lock, { name: '261118', id: 'y' })).toBe(false)
  })
})

describe('Agent 锁：时长与横幅（四种状态）', () => {
  const lock: AgentLock = {
    pid: 1,
    agent: 'a',
    project: 'AD-5.2',
    note: '改 12 个样品浓度',
    startedAt: '2026-11-22T15:40:00.000Z'
  }
  const target = { name: 'AD-5.2', id: 'e1' }

  it('时间文案：刚刚 / 已 N 分钟', () => {
    expect(formatLockAge(0)).toBe('刚刚')
    expect(formatLockAge(3)).toBe('已 3 分钟')
  })

  it('已 3 分钟：黄色横幅、冻结', () => {
    const banner = formatLockBanner(lock, target, minutesAgo(3))
    expect(banner?.level).toBe('active')
    expect(banner?.freeze).toBe(true)
    expect(banner?.text).toBe('🤖 Agent 正在操作：改 12 个样品浓度（已 3 分钟）')
  })

  it('没有 note 时写「未说明」', () => {
    const banner = formatLockBanner({ ...lock, note: '' }, target, minutesAgo(1))
    expect(banner?.text).toContain('未说明')
  })

  it('满 15 分钟转红并加「可能忘记解锁了」', () => {
    const banner = formatLockBanner(lock, target, minutesAgo(LOCK_STALE_MINUTES))
    expect(banner?.level).toBe('stale')
    expect(banner?.freeze).toBe(true)
    expect(banner?.text).toContain('可能忘记解锁了')
  })

  it('16 分钟仍是红色（注入时间造出来的）', () => {
    expect(formatLockBanner(lock, target, minutesAgo(16))?.level).toBe('stale')
  })

  it('别的工程 → 浅色提示，不冻结', () => {
    const banner = formatLockBanner(lock, { name: '261118' }, minutesAgo(3))
    expect(banner?.level).toBe('other')
    expect(banner?.freeze).toBe(false)
    expect(banner?.text).toBe('Agent 正在操作「AD-5.2」，本工程可正常编辑')
  })

  it('锁文件坏了 → 提示损坏，不冻结', () => {
    const banner = formatLockBanner({ broken: true, raw: '{', reason: '不是合法的 JSON' }, target, minutesAgo(1))
    expect(banner?.level).toBe('broken')
    expect(banner?.freeze).toBe(false)
    expect(banner?.text).toBe('锁文件无法解析，可能损坏')
  })

  it('没有锁 → 没有横幅', () => {
    expect(formatLockBanner(null, target, minutesAgo(1))).toBeNull()
  })
})
