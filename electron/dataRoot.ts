/**
 * 数据正本目录（第 1 步正本迁移）
 *
 * 布局：
 *   <dataRoot>/仓库.yml             全库一份：分组 + 试剂
 *   <dataRoot>/工程/<工程名>.yml     每个工程一份（真相源）
 *   <dataRoot>/导出/<工程名>-SOP.md  只给笔记看的派生产物
 *   <dataRoot>/导出/<工程名>.png
 *
 * 约定：
 * - 写文件一律「先写 .tmp 再 rename」，避免半截文件把正本写坏。
 * - 文件名取工程名，非法字符替换成 `_`；重名追加 `-2`、`-3`。
 * - 这里只做文件系统，不解析 YAML 内容（解析在 src/core/store 里，测试可以直接跑）。
 */

import fs from 'fs'
import path from 'path'

/** 默认正本目录（主人电脑上的固定位置） */
export const DEFAULT_DATA_ROOT = process.platform === 'win32'
  ? path.join('D:\\', '学习', 'labflow')
  : path.join(process.env.HOME || '.', 'labflow')

export const PROJECT_DIR = '工程'
export const EXPORT_DIR = '导出'
export const WAREHOUSE_FILENAME = '仓库.yml'
/** 删掉的工程文件名挪到这里（不硬删，可人工恢复）；在 工程/ 下面，列表只看顶层 *.yml，不会混进来 */
export const DELETED_DIR = '_deleted'

export interface FileStat {
  mtimeMs: number
  size: number
}

export interface ProjectFileInfo {
  name: string
  fileName: string
  path: string
  stat: FileStat
}

/** 文件名非法字符 → `_`（Windows 上 \ / : * ? " < > | 都不允许） */
export function sanitizeProjectName(name: string): string {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '_')
    .replace(/^\.+$/, '_')
    .trim()
  return cleaned || '未命名工程'
}

export function projectDir(root: string): string {
  return path.join(root, PROJECT_DIR)
}

export function exportDir(root: string): string {
  return path.join(root, EXPORT_DIR)
}

export function warehousePath(root: string): string {
  return path.join(root, WAREHOUSE_FILENAME)
}

/** 确保三个目录都在；返回 false 表示根目录不可用（例如盘符不存在） */
export function ensureDataRoot(root: string): boolean {
  try {
    fs.mkdirSync(projectDir(root), { recursive: true })
    fs.mkdirSync(exportDir(root), { recursive: true })
    return true
  } catch (error) {
    console.error('[dataRoot] 建目录失败：', root, error)
    return false
  }
}

/** 原子写：同目录先写 .tmp，再 rename 覆盖 */
export function writeFileAtomic(target: string, content: string | Buffer): FileStat {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, target)
  const stat = fs.statSync(target)
  return { mtimeMs: stat.mtimeMs, size: stat.size }
}

export function statFile(target: string): FileStat | null {
  try {
    const stat = fs.statSync(target)
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}

export function readTextFile(target: string): string | null {
  try {
    return fs.readFileSync(target, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 读一个工程文件里写的 `project.id`（没有就返回 null）。
 * 工程 yml 里 id 行是 `  id: <uuid>`（project: 块内缩进 2 格），老文件可能没有这一行。
 */
export function projectIdInFile(target: string): string | null {
  const text = readTextFile(target)
  if (!text) return null
  const match = /^\s{0,4}id:\s*(\S+)\s*$/m.exec(text)
  return match ? match[1].replace(/^['"]|['"]$/g, '') : null
}

/**
 * 找一个工程该写到哪个文件：
 * 1. 先按 id 找（读到哪个文件里 project.id 匹配就用哪个，工程改名也不会丢文件）
 * 2. 再按工程名找（同名文件里没有 id 的老文件也认）
 * 3. 都没有 → 用工程名新开一个，重名就 `-2`、`-3`
 *
 * 重名判据（2026-11 修）：同名文件里写着**别的** project.id 时绝不覆盖，直接换名。
 * `takenNames` 是调用方已知被占用的文件名（同批保存里已被别的工程认领的），也一并避开。
 */
export function resolveProjectPath(root: string, id: string | undefined, name: string, takenNames: string[] = []): string {
  const dir = projectDir(root)
  fs.mkdirSync(dir, { recursive: true })

  const files = fs.readdirSync(dir).filter(file => file.endsWith('.yml'))
  if (id) {
    for (const file of files) {
      if (projectIdInFile(path.join(dir, file)) === id) {
        return path.join(dir, file)
      }
    }
  }

  const base = sanitizeProjectName(name)
  const taken = new Set(takenNames)
  /** 文件能被本次工程用：里面没写 id（老文件），或者写的正是本次 id */
  const reusable = (fileName: string): boolean => {
    const fileId = projectIdInFile(path.join(dir, fileName))
    // 写了 id 但不是本次的（含本次没给 id 的情况）→ 不许动，换名
    if (fileId && fileId !== (id || '')) return false
    return true
  }

  const exactName = `${base}.yml`
  const exact = path.join(dir, exactName)
  if (fs.existsSync(exact)) {
    if (reusable(exactName)) return exact
    // 同名但属于另一个工程：落到下面换名，不覆盖
  } else if (!taken.has(exactName)) {
    return exact
  }

  // 重名：-2、-3 …
  for (let index = 2; index < 1000; index++) {
    const fileName = `${base}-${index}.yml`
    const candidate = path.join(dir, fileName)
    if (fs.existsSync(candidate)) {
      if (reusable(fileName) && !taken.has(fileName)) return candidate
      continue
    }
    if (taken.has(fileName)) continue
    return candidate
  }
  return path.join(dir, `${base}-${Date.now()}.yml`)
}

/** 列出 工程/ 下所有工程文件（按文件名排序，稳定） */
export function listProjectFiles(root: string): ProjectFileInfo[] {
  const dir = projectDir(root)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.yml'))
    .sort()
    .map(file => {
      const full = path.join(dir, file)
      const stat = fs.statSync(full)
      return { name: file.replace(/\.yml$/, ''), fileName: file, path: full, stat: { mtimeMs: stat.mtimeMs, size: stat.size } }
    })
}

/** 读某个工程文件（按文件名，不带 .yml 也行） */
export function readProjectFile(root: string, fileNameOrName: string): { path: string; content: string; stat: FileStat } | null {
  const dir = projectDir(root)
  const candidates = [
    path.join(dir, fileNameOrName),
    path.join(dir, `${fileNameOrName}.yml`)
  ]
  for (const candidate of candidates) {
    const content = readTextFile(candidate)
    if (content !== null) {
      const stat = statFile(candidate)
      if (stat) return { path: candidate, content, stat }
    }
  }
  return null
}

/** 按 project.id 找工程文件（名字改了也认）；找不到返回 null */
export function findProjectFileById(
  root: string,
  id: string
): { path: string; fileName: string; content: string; stat: FileStat } | null {
  if (!id) return null
  const dir = projectDir(root)
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.yml')).sort()
  for (const file of files) {
    const full = path.join(dir, file)
    if (projectIdInFile(full) !== id) continue
    const content = readTextFile(full)
    const stat = statFile(full)
    if (content !== null && stat) return { path: full, fileName: file, content, stat }
  }
  return null
}

/** 时间戳：20261123-005930（备份文件名用，稳定、可排序） */
function backupStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 删掉的工程文件归档目录：工程/_deleted */
export function deletedDir(root: string): string {
  return path.join(projectDir(root), DELETED_DIR)
}

export type ArchiveProjectResult =
  | { ok: true; from: string; path: string; fileName: string }
  | { ok: false; reason: 'not-found' }
  | { ok: false; error: string }

/**
 * 按工程名（文件里写的 `name:`）找工程文件；文件名和工程名不一样时也认。
 * `readProjectFile` 只认文件名，所以删工程要单独走一遍。
 */
function findProjectFileByName(root: string, name: string): { path: string; fileName: string; content: string; stat: FileStat } | null {
  const wanted = name.trim()
  if (!wanted) return null
  const files = listProjectFiles(root)
  // 先按文件名（文件名一般就是工程名），再按文件里写的 `name:`（有人手工改过文件名也认）
  const hit =
    files.find(info => info.name === wanted) ||
    files.find(info => {
      const text = readTextFile(info.path)
      const match = text ? /^\s{0,4}name:\s*(.+)\s*$/m.exec(text) : null
      return Boolean(match && match[1].replace(/^['"]|['"]$/g, '').trim() === wanted)
    })
  if (!hit) return null
  const content = readTextFile(hit.path)
  return content === null ? null : { path: hit.path, fileName: hit.fileName, content, stat: hit.stat }
}

/**
 * 删工程时**移走**它的正本文件（第 4 条：以前删了数据库记录，`工程/<名>.yml` 留在盘上成孤儿，
 * 以后手工放一份同名文件就「诈尸」，列表和文件对不上）。
 *
 * 移到 `工程/_deleted/<时间戳>-<原文件名>.yml`：
 * - 不硬删，主人想恢复直接把文件挪回来就行；
 * - 时间戳来自 backupStamp()，同一秒内重名追加 `-2`，绝不覆盖旧的归档。
 *
 * 找不到文件返回 `{ok:false, reason:'not-found'}`（让调用方照旧删数据库，别把它当失败）。
 */
export function archiveProjectFile(
  root: string,
  wanted: { id?: string; name?: string; fileName?: string },
  date = new Date()
): ArchiveProjectResult {
  try {
    const found =
      (wanted.fileName ? readProjectFile(root, wanted.fileName) : null) ||
      (wanted.id ? findProjectFileById(root, wanted.id) : null) ||
      (wanted.name ? findProjectFileByName(root, wanted.name) : null)
    if (!found) return { ok: false, reason: 'not-found' }

    const dir = deletedDir(root)
    fs.mkdirSync(dir, { recursive: true })
    const original = path.basename(found.path)
    const stamp = backupStamp(date)
    let fileName = `${stamp}-${original}`
    let target = path.join(dir, fileName)
    for (let index = 2; fs.existsSync(target) && index < 1000; index++) {
      fileName = `${stamp}-${index}-${original}`
      target = path.join(dir, fileName)
    }
    fs.renameSync(found.path, target)
    console.log('[dataRoot] 工程文件已归档：', found.path, '→', target)
    return { ok: true, from: found.path, path: target, fileName }
  } catch (error) {
    console.error('[dataRoot] 归档工程文件失败：', error)
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 把读不懂的 `仓库.yml` 另存一份当证据：`仓库.broken-<时间戳>.yml`（放数据根目录，不覆盖旧的）。
 * 不改动、不移走原文件——原文件留给人自己决定怎么救。
 */
export function backupBrokenWarehouse(root: string, content: string, date = new Date()): { path: string; fileName: string } {
  const dir = root
  fs.mkdirSync(dir, { recursive: true })
  const stamp = backupStamp(date)
  const base = `${WAREHOUSE_FILENAME.replace(/\.yml$/, '')}.broken-${stamp}`
  let fileName = `${base}.yml`
  let target = path.join(dir, fileName)
  for (let index = 2; fs.existsSync(target) && index < 1000; index++) {
    fileName = `${base}-${index}.yml`
    target = path.join(dir, fileName)
  }
  writeFileAtomic(target, content)
  return { path: target, fileName }
}

/** 写派生产物（SOP / PNG）到 导出/；文件名由调用方给 */
export function writeDerivedFiles(
  root: string,
  files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]
): { directory: string; written: { name: string; size: number }[] } {
  const dir = exportDir(root)
  fs.mkdirSync(dir, { recursive: true })
  const written: { name: string; size: number }[] = []
  for (const file of files) {
    // 派生产物也不许往上一级跳
    const safeName = path.basename(file.name)
    const target = path.join(dir, safeName)
    const buffer = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content
    const stat = writeFileAtomic(target, buffer)
    written.push({ name: safeName, size: stat.size })
  }
  return { directory: dir, written }
}
