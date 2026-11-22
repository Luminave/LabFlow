/**
 * Agent 锁（第 2 步）：一个 JSON 文件，谁在改哪个工程。
 *
 * 文件位置：`<dataRoot>/.agent-lock`（与 仓库.yml 同级）。
 * 这里只做「解析 + 判断 + 文案」这三件纯事，读写文件在主进程（electron/lockFile.ts）。
 *
 * 设计口径：
 * - 解析失败不抛异常，返回 `{ broken: true, raw }`，界面照旧给「强制解锁」。
 * - `project` 既可以是工程名，也可以是工程 id；两者任一匹配就算「本工程被锁」。
 * - 超过 15 分钟视为「可能忘记解锁」，横幅转红。
 */

export const LOCK_FILENAME = '.agent-lock'

/** 超过这个分钟数就当「可能忘记解锁了」 */
export const LOCK_STALE_MINUTES = 15

export interface AgentLock {
  pid: number | null
  agent: string
  project: string
  note: string
  /** ISO 时间串；解析不出来时按「刚刚」处理 */
  startedAt: string
}

export interface BrokenAgentLock {
  broken: true
  raw: string
  reason: string
}

export type ParsedAgentLock = AgentLock | BrokenAgentLock | null

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 解析锁文件内容。
 * - 空内容 → null（没有锁）
 * - JSON 坏 / 缺 project → `{ broken: true }`
 */
export function parseAgentLock(text: string | null | undefined): ParsedAgentLock {
  if (text === null || text === undefined) return null
  const raw = String(text)
  if (raw.trim() === '') return null

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { broken: true, raw, reason: '不是合法的 JSON' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { broken: true, raw, reason: '顶格不是一个对象' }
  }

  const record = data as Record<string, unknown>
  const project = asText(record.project)
  if (!project) return { broken: true, raw, reason: '缺少 project 字段' }

  const pidRaw = record.pid
  const pid = typeof pidRaw === 'number' && Number.isFinite(pidRaw) ? pidRaw : null

  return {
    pid,
    agent: asText(record.agent) || '未知 Agent',
    project,
    note: asText(record.note),
    startedAt: asText(record.startedAt)
  }
}

export interface LockTarget {
  name?: string
  id?: string
}

/** 这把锁是不是在锁当前这个工程（名字或 id 任一匹配） */
export function lockTargetsProject(lock: AgentLock, target: LockTarget): boolean {
  const project = lock.project.trim().toLowerCase()
  if (!project) return false
  const name = (target.name || '').trim().toLowerCase()
  const id = (target.id || '').trim().toLowerCase()
  return (!!name && project === name) || (!!id && project === id)
}

/** 锁已经持续了多少分钟（时间不可解析时当 0） */
export function lockAgeMinutes(lock: AgentLock, now: number = Date.now()): number {
  const started = Date.parse(lock.startedAt)
  if (!Number.isFinite(started)) return 0
  const minutes = Math.floor((now - started) / 60000)
  return minutes > 0 ? minutes : 0
}

export type LockBannerLevel = 'active' | 'stale' | 'other' | 'broken'

export interface LockBanner {
  level: LockBannerLevel
  text: string
  /** 是否冻结界面（只有本工程被锁才冻结） */
  freeze: boolean
}

/** 「已 3 分钟」/「刚刚」 */
export function formatLockAge(minutes: number): string {
  return minutes <= 0 ? '刚刚' : `已 ${minutes} 分钟`
}

/**
 * 横幅文案（四种状态）。
 * @param target 当前页面的工程
 * @param now 可注入的当前时间（测试造 16 分钟用）
 */
export function formatLockBanner(
  lock: ParsedAgentLock,
  target: LockTarget,
  now: number = Date.now()
): LockBanner | null {
  if (!lock) return null

  if ('broken' in lock) {
    return { level: 'broken', text: '锁文件无法解析，可能损坏', freeze: false }
  }

  if (!lockTargetsProject(lock, target)) {
    return {
      level: 'other',
      text: `Agent 正在操作「${lock.project}」，本工程可正常编辑`,
      freeze: false
    }
  }

  const minutes = lockAgeMinutes(lock, now)
  const note = lock.note || '未说明'
  const base = `🤖 Agent 正在操作：${note}（${formatLockAge(minutes)}）`
  if (minutes >= LOCK_STALE_MINUTES) {
    return { level: 'stale', text: `${base}——可能忘记解锁了`, freeze: true }
  }
  return { level: 'active', text: base, freeze: true }
}
