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
 * 找一个工程该写到哪个文件：
 * 1. 先按 id 找（读到哪个文件里 project.id 匹配就用哪个，工程改名也不会丢文件）
 * 2. 再按工程名找（同名文件里没有 id 的老文件也认）
 * 3. 都没有 → 用工程名新开一个，重名就 `-2`、`-3`
 */
export function resolveProjectPath(root: string, id: string | undefined, name: string, takenNames: string[] = []): string {
  const dir = projectDir(root)
  fs.mkdirSync(dir, { recursive: true })

  const files = fs.readdirSync(dir).filter(file => file.endsWith('.yml'))
  if (id) {
    for (const file of files) {
      const text = readTextFile(path.join(dir, file))
      if (!text) continue
      const match = /^\s{0,4}id:\s*(\S+)\s*$/m.exec(text)
      if (match && match[1].replace(/^['"]|['"]$/g, '') === id) {
        return path.join(dir, file)
      }
    }
  }

  const base = sanitizeProjectName(name)
  const exact = path.join(dir, `${base}.yml`)
  if (fs.existsSync(exact) && !takenNames.includes(`${base}.yml`)) return exact

  // 重名：-2、-3 …
  for (let index = 2; index < 1000; index++) {
    const candidate = path.join(dir, `${base}-${index}.yml`)
    if (!fs.existsSync(candidate)) return candidate
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
