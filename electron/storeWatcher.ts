/**
 * 数据正本目录的事件分类 + 「自写不回声」判定（第 5 步：热加载）。
 *
 * 为什么单独抽出来：`fs.watch` 的回调很难在单测里跑，
 * 但「这条事件是不是我们自己写的」「该不该广播」是纯逻辑，可以单独测。
 *
 * 防自激原理：主进程每次自己写文件都记下内容哈希；watcher 收到事件时把文件内容再哈希一次，
 * 一样就说明是自己刚写的 → 不广播（否则「写入 → 界面重载 → 再写 → …」死循环）。
 */

import crypto from 'crypto'

import { WAREHOUSE_FILENAME, PROJECT_DIR } from './dataRoot'

export type StoreEventKind = 'lock' | 'warehouse' | 'project' | 'other'

export interface StoreFileEvent {
  kind: StoreEventKind
  /** 只有 kind === 'project' 时才有值：`工程/xxx.yml` 的 `xxx.yml` */
  projectFile?: string
}

/** 把 fs.watch 的 filename 归类成锁 / 仓库正本 / 工程正本 / 其它 */
export function classifyStoreEvent(fileName: string): StoreFileEvent {
  const name = (fileName || '').replace(/\\/g, '/')
  if (name === '.agent-lock') return { kind: 'lock' }
  if (name === WAREHOUSE_FILENAME) return { kind: 'warehouse' }

  const prefix = `${PROJECT_DIR}/`
  if (name.startsWith(prefix) && name.toLowerCase().endsWith('.yml')) {
    const rest = name.slice(prefix.length)
    // 原子写会先落临时文件（`xxx.yml.1234.tmp`），这类不算正本变更
    if (rest.includes('.tmp')) return { kind: 'other' }
    return { kind: 'project', projectFile: rest }
  }
  return { kind: 'other' }
}

function hashOf(content: string | null): string {
  if (content === null) return 'missing'
  return crypto.createHash('sha1').update(content).digest('hex')
}

export interface WriteTracker {
  /** 我们自己刚写完这个文件（内容都知道），记下哈希 */
  noteWritten(filePath: string, content: string): void
  /** watcher 收到事件：内容一样就不广播；不一样就广播并把哈希更新成新的 */
  shouldBroadcast(filePath: string, content: string | null): boolean
}

export function createWriteTracker(): WriteTracker {
  const seen = new Map<string, string>()
  return {
    noteWritten(filePath, content) {
      seen.set(filePath, hashOf(content))
    },
    shouldBroadcast(filePath, content) {
      const next = hashOf(content)
      if (seen.get(filePath) === next) return false
      seen.set(filePath, next)
      return true
    }
  }
}

export interface StoreChangePayload {
  warehouse: boolean
  projects: string[]
}

/** 一个事件窗口内可能连着来好几个事件，攒一下再广播（200ms） */
export function mergeStoreChanges(queue: StoreChangePayload[], next: StoreChangePayload): StoreChangePayload {
  const warehouse = queue.some(item => item.warehouse) || next.warehouse
  const projects = new Set<string>()
  for (const item of queue) for (const file of item.projects) projects.add(file)
  for (const file of next.projects) projects.add(file)
  return { warehouse, projects: [...projects] }
}
