/**
 * CLI 的「数据正本」读写层。
 *
 * CLI 只在 Node 里跑（不进界面、不走 IPC），所以这里直接用 fs，
 * 目录约定复用 `electron/dataRoot.ts`，解析复用 `src/core/store/projectFile.ts`。
 */

import fs from 'fs'
import path from 'path'

import {
  DEFAULT_DATA_ROOT,
  WAREHOUSE_FILENAME,
  exportDir,
  listProjectFiles,
  projectDir,
  readProjectFile,
  readTextFile,
  writeFileAtomic,
  type ProjectFileInfo
} from '../../electron/dataRoot'
import { experimentFromProjectFile, missingReagentRefs } from '../core/store/projectFile'
import { parseWarehouseYml, type WarehouseSnapshot } from '../core/store/warehouseFile'
import { parseAgentLock, LOCK_FILENAME, type ParsedAgentLock } from '../core/lock'
import type { Experiment } from '../core/schema'

export { DEFAULT_DATA_ROOT, LOCK_FILENAME, projectDir, exportDir }

/** --root > LABFLOW_DATA_ROOT > 默认 D:\学习\labflow */
export function resolveRoot(flag: string | undefined): string {
  if (flag) return path.resolve(flag)
  const env = process.env.LABFLOW_DATA_ROOT
  if (env) return path.resolve(env)
  return DEFAULT_DATA_ROOT
}

/** 列出 工程/*.yml（按 updatedAt 倒序，最新在前） */
export function listProjects(root: string): ProjectFileInfo[] {
  return listProjectFiles(root).sort((a, b) => (b.stat?.mtimeMs || 0) - (a.stat?.mtimeMs || 0))
}

export interface LoadedProject {
  fileName: string
  path: string
  experiment: Experiment
  warnings: string[]
  version: number
}

/**
 * 按「工程名 / 文件名 / id」找一份工程正本。
 * 找不到返回 null（调用方负责报错与退出码）。
 */
export function loadProject(root: string, wanted: string): LoadedProject | null {
  if (!wanted) return null
  const files = listProjects(root)

  // 先按文件名精确匹配，再按「读出来的 name/id」匹配
  const byFileName = files.find(file => file.fileName === wanted || file.fileName === `${wanted}.yml`)
  const ordered = byFileName ? [byFileName, ...files.filter(f => f !== byFileName)] : files

  for (const file of ordered) {
    const found = readProjectFile(root, file.fileName)
    if (!found) continue
    const loaded = experimentFromProjectFile(found.content, null)
    const name = loaded.experiment.name || file.name
    const id = loaded.experiment.id || ''
    const stem = file.fileName.replace(/\.yml$/i, '')
    // 三个匹配口径：文件内 name / 文件内 id / 文件名（含去扩展名）——同名副本靠文件名区分
    if (name === wanted || id === wanted || file.fileName === wanted || stem === wanted) {
      return {
        fileName: file.fileName,
        path: found.path,
        experiment: { ...loaded.experiment, name },
        warnings: loaded.warnings,
        version: loaded.version
      }
    }
  }
  return null
}

/** 读 仓库.yml（没有就返回空快照，不抛） */
export function loadWarehouse(root: string): { snapshot: WarehouseSnapshot; warnings: string[] } {
  const text = readTextFile(path.join(root, WAREHOUSE_FILENAME))
  if (text === null) return { snapshot: { groups: [], reagents: [] }, warnings: [`没有找到 ${WAREHOUSE_FILENAME}`] }
  const parsed = parseWarehouseYml(text)
  return { snapshot: parsed.snapshot, warnings: parsed.warnings }
}

/** 工程引用了仓库里不存在的试剂（id 在前缀里） */
export function reagentRefWarnings(project: LoadedProject, snapshot: WarehouseSnapshot): string[] {
  return missingReagentRefs(
    {
      name: project.experiment.name,
      date: '',
      tubes: project.experiment.tubes,
      connections: project.experiment.connections,
      positions: project.experiment.tubePositions,
      warehouseTubes: snapshot.reagents
    },
    snapshot.reagents.map(tube => tube.id)
  )
}

/** 读锁文件 */
export function readLock(root: string): ParsedAgentLock {
  const text = readTextFile(path.join(root, LOCK_FILENAME))
  return parseAgentLock(text)
}

/** 写锁文件（一行 JSON 也行，这里用两格缩进方便人看） */
export function writeLock(root: string, lock: unknown): void {
  fs.mkdirSync(root, { recursive: true })
  writeFileAtomic(path.join(root, LOCK_FILENAME), JSON.stringify(lock, null, 2))
}

/** 删锁文件；没有也当成功 */
export function removeLock(root: string): void {
  try {
    fs.unlinkSync(path.join(root, LOCK_FILENAME))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export { writeFileAtomic }
