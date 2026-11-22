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
  /**
   * 稳定归属凭据（必修 2，2026-11-23 加）。
   *
   * `pid` 是「写这把锁的那个进程」的 pid，跨进程必然不等：CLI 加锁后再 `unlock`、
   * Agent 加锁后自己跑 `complete --apply`，都会被自己的锁挡住。
   * 这里记一个与进程无关、加锁时就确定下来的 token，同一个 owner 跨进程也能认出自己。
   * 老锁没有这个字段 → 仍然是 null，判定回落旧的三元组。
   */
  owner?: string
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
    startedAt: asText(record.startedAt),
    owner: asText(record.owner) || undefined
  }
}

/**
 * 由「谁 + 什么时候加锁」派生一个稳定 token（FNV-1a，不引依赖）。
 *
 * 同一个 agent 名 + 同一个 startedAt 在任何进程里都算出同一个值，
 * 所以加锁进程和解锁进程不需要共享内存，也不需要 pid。
 * 不同 agent / 不同加锁时刻 → 不同 token，跨 owner 依然互相解不掉。
 */
export function deriveLockOwner(agent: string, startedAt: string): string {
  const input = `${agent.trim().toLowerCase()}|${startedAt.trim()}`
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `owner-${hash.toString(16).padStart(8, '0')}`
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

/** 调用方身份：解锁/强制解锁必须和锁文件里的三元组（或 owner 凭据）对得上 */
export interface LockCaller {
  pid?: number | null
  agent?: string
  project?: string
  /** 加锁时写进锁文件的那个 owner token；给了就按它判定，不再看 pid */
  owner?: string
}

/**
 * 调用方是不是这把锁的主人（必修 2）。
 *
 * 判据只有两条，都是「跨进程不变」的：
 * - 锁里有 owner、调用方也给了 owner → 两个相等即主人；
 * - 其余情况（老锁 / 调用方没给凭据）→ 不是，走旧的 pid+agent+project 兼容判定。
 */
export function lockOwnedBy(lock: AgentLock, owner?: string | null): boolean {
  const lockOwner = (lock.owner || '').trim()
  const callerOwner = (owner || '').trim()
  return Boolean(lockOwner && callerOwner && lockOwner === callerOwner)
}

/** 「<agent>/<pid>」——提示里指认锁的主人 */
export function lockOwnerLabel(lock: AgentLock): string {
  const pid = lock.pid === null || lock.pid === undefined ? '未知 pid' : String(lock.pid)
  return `${lock.agent || '未知 Agent'}/${pid}`
}

export interface LockReleaseCheck {
  ok: boolean
  /** 不允许删时的中文原因（已含主人与不一致的字段） */
  reason?: string
}

/**
 * 能不能删这把锁（第 2 步补：以前 unlock / forceRelease 都是裸删，谁都能把别人的锁踢掉）。
 *
 * 规则：
 * - `force: true`（CLI `--force` / 界面在「锁文件损坏」时点的强制解锁）→ 允许，调用方已明确知情；
 * - 没有锁 → 允许（没什么可删的）；
 * - 锁文件损坏 → 没有三元组可校验，**不许**（否则「校验」形同虚设），提示加 --force；
 * - 调用方给了 owner 凭据 → 只看它：对上就是主人（跨进程也算），对不上就拒（必修 2）；
 * - 调用方没给凭据 → 回落旧判定：pid + agent + project 三个都对上才允许；
 *   锁里记了 owner 却没带凭据的，一并算不一致（pid 本来就不是身份）。
 */
export function checkLockRelease(
  lock: ParsedAgentLock,
  caller: LockCaller = {},
  options: { force?: boolean } = {}
): LockReleaseCheck {
  if (options.force) return { ok: true }
  if (!lock) return { ok: true }
  if ('broken' in lock) {
    return {
      ok: false,
      reason: `锁文件无法解析（${lock.reason}），无法校验归属；确认要删请加 --force`
    }
  }

  const callerOwner = (caller.owner || '').trim()
  if (callerOwner) {
    if (lockOwnedBy(lock, callerOwner)) return { ok: true }
    return {
      ok: false,
      reason: `锁属于 ${lockOwnerLabel(lock)}，owner 凭据对不上这把锁，未删除（确认要删请加 --force）`
    }
  }

  const mismatch: string[] = []
  const callerPid = caller.pid
  const pidOk = typeof callerPid === 'number' && Number.isFinite(callerPid) && lock.pid === callerPid
  if (!pidOk) mismatch.push('pid')
  if ((caller.agent || '').trim() !== lock.agent) mismatch.push('agent')
  // project 只在调用方给了才比（`labflow unlock` 不带 --project 就只校验 pid+agent）
  const callerProject = (caller.project || '').trim()
  if (callerProject && callerProject.toLowerCase() !== lock.project.trim().toLowerCase()) mismatch.push('project')
  // 新锁记了 owner：没带凭据就只剩 pid 可比，而 pid 跨进程必然不等，直说清楚该带什么
  if ((lock.owner || '').trim()) mismatch.push('owner（加锁时输出的 --owner 凭据）')

  if (mismatch.length === 0) return { ok: true }
  return {
    ok: false,
    reason: `锁属于 ${lockOwnerLabel(lock)}，不是当前调用方（${mismatch.join('、')} 不一致），未删除`
  }
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
