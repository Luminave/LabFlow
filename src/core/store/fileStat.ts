/**
 * 正本文件的「是不是被外部改过」判定（第 6 条）。
 *
 * 为什么不再只看 mtime：文件被**同内容**重写一次（编辑器保存、同步盘、手动 copy）后
 * mtime 就变了，之后每次保存都被判「已被外部修改」，反复弹框。
 * 现在以**内容哈希**为准：
 * - expect 里带 hash → 比 hash；hash 相同就是没改（哪怕 mtime/size 变了），直接放行；
 * - expect 里没有 hash（旧记录 / statProject 这种只给 mtime 的接口）→ 退回原来的 mtime/size 比对；
 * - 文件不存在 → 当作「重建」，不算冲突（沿用原行为）。
 *
 * 纯函数，主进程（electron/main.ts）与渲染进程（projectSource / warehouseSource）共用，
 * 测试直接跑，不用起 Electron。
 */

export interface FileStatLike {
  mtimeMs: number
  size: number
  /** 内容哈希（见 hashContent）；老记录可能没有 */
  hash?: string
}

/**
 * 内容哈希：FNV-1a 32 位 + 长度，十六进制。
 * 只用来判断「两次读到的内容是不是同一份」，不做安全用途（所以不求抗碰撞强度）。
 */
export function hashContent(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}:${text.length}`
}

/** 把 stat 补上内容哈希（读到内容时用；内容为 null 就原样返回） */
export function statWithHash(stat: FileStatLike | null, content: string | null): FileStatLike | null {
  if (!stat) return null
  if (content === null) return stat
  return { mtimeMs: stat.mtimeMs, size: stat.size, hash: hashContent(content) }
}

export interface ConflictCheck {
  /** true = 文件确实被外部改过，调用方不许覆盖 */
  conflict: boolean
  /** 写盘成功后要记下来的新 stat（含 hash）；文件不存在时为 null */
  stat: FileStatLike | null
}

/**
 * 写盘前判断「我基于的那份内容还在不在」。
 * @param current 现在磁盘上的 stat（文件不存在传 null）
 * @param currentContent 现在磁盘上的内容（能读到就传，用来算 hash；读不到传 null）
 * @param expect 上次读/写时的 stat（含 hash 时优先比 hash）
 */
export function checkExpectedContent(
  current: FileStatLike | null,
  currentContent: string | null,
  expect: FileStatLike | null | undefined
): ConflictCheck {
  const fresh = statWithHash(current, currentContent)
  if (!expect) return { conflict: false, stat: fresh }
  if (!current) return { conflict: false, stat: null }

  // ① 有 hash 就比内容：mtime 变了、内容一样 → 不算冲突
  if (expect.hash && currentContent !== null) {
    return { conflict: hashContent(currentContent) !== expect.hash, stat: fresh }
  }

  // ② 没 hash（旧记录）：退回 mtime/size
  const changed = Math.abs(current.mtimeMs - expect.mtimeMs) > 1 || current.size !== expect.size
  return { conflict: changed, stat: fresh }
}
