/**
 * 「本工程是否被 Agent 锁住」——渲染进程所有写入口的统一闸门（第 1 条）。
 *
 * 以前只有 `.toolbarFrozen{pointer-events:none}` 挡着按钮：弹窗照用、2 秒自动保存照跑、
 * 结束实验也不查锁。现在把判定放到写入口（persistExperiment / completeExperiment /
 * revertExperiment / deleteExperiment / saveCurrentExperiment），被锁时一律不写文件。
 *
 * 锁的解析与匹配复用 src/core/lock.ts，这里只负责「读锁 + 抛错 + 轻提示」。
 */

import { lockOwnerLabel, lockTargetsProject, type AgentLock, type ParsedAgentLock } from '@/core/lock'

export interface ProjectRef {
  id?: string
  name?: string
}

/** 被锁时给界面看的那句轻提示（CLI 用同一句话的变体） */
export const DEFERRED_WRITE_TEXT = 'Agent 正在操作，已暂缓写入'

/** 写入口发现本工程被锁：调用方 catch 它、给提示、不要再往下写 */
export class AgentLockError extends Error {
  readonly lock: AgentLock

  constructor(lock: AgentLock) {
    super(`${DEFERRED_WRITE_TEXT}（${lockOwnerLabel(lock)} 正在操作「${lock.project}」）`)
    this.name = 'AgentLockError'
    this.lock = lock
  }
}

function api(): Window['electronAPI'] | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI
}

/** 读当前锁；锁的不是这个工程、或者锁文件坏了，都返回 null（坏锁不挡人，只提示） */
export async function readProjectLock(project: ProjectRef = {}): Promise<AgentLock | null> {
  const electron = api()
  if (!electron?.getAgentLock) return null
  let lock: ParsedAgentLock = null
  try {
    lock = (await electron.getAgentLock()) as ParsedAgentLock
  } catch (error) {
    console.warn('[Lock] 读锁失败：', error)
    return null
  }
  if (!lock || 'broken' in lock) return null
  return lockTargetsProject(lock, { id: project.id, name: project.name }) ? lock : null
}

/** 本工程被锁就抛 AgentLockError；没锁直接过 */
export async function assertProjectWritable(project: ProjectRef = {}): Promise<void> {
  const lock = await readProjectLock(project)
  if (lock) throw new AgentLockError(lock)
}

let lastDeferredKey = ''

/**
 * 「已暂缓写入」轻提示。
 * 自动保存每 2 秒就会试一次，同一把锁只提示一次（靠 agent|pid|project|startedAt 去重），
 * 不然会连珠炮一样弹。锁换了（Agent 重开一次）会再提示一次。
 */
export function notifyWriteDeferred(lock: AgentLock | null): void {
  const key = lock ? `${lock.agent}|${lock.pid}|${lock.project}|${lock.startedAt}` : 'none'
  if (key === lastDeferredKey) return
  lastDeferredKey = key
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const who = lock ? `（${lockOwnerLabel(lock)} 正在操作「${lock.project}」）` : ''
  try {
    window.dispatchEvent(
      new CustomEvent('labflow:global-toast', { detail: { text: `${DEFERRED_WRITE_TEXT}${who}` } })
    )
  } catch (error) {
    console.warn('[Lock] 暂缓提示没发出去：', error)
  }
}

/** 测试用：清掉提示去重状态 */
export function resetDeferredWriteNotice(): void {
  lastDeferredKey = ''
}
