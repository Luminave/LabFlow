/**
 * 工程正本的读写编排（渲染进程侧）。
 *
 * 分工：
 * - 解析 / 序列化：`src/core/store/projectFile.ts`（纯函数，测试直接跑）
 * - 文件读写：主进程 `electron/dataRoot.ts`（经 `window.electronAPI.dataRoot` 调用）
 * - 这里负责「什么时候读、什么时候写、写之前要不要问一句」
 *
 * 第 1 步的规则：
 * 1. 打开工程时**先看文件**；文件不存在就用数据库里的旧数据生成一份（并记日志）。
 * 2. 保存时**先写文件**（原子写），成功后再写数据库缓存、再按开关导出副本。
 * 3. 文件被人手改过（mtime/size 对不上）就**不覆盖**，交给界面弹提示。
 */

import type { Experiment, Tube } from '@shared/types'
import { experimentFromProjectFile, missingReagentRefs, projectFileText } from '@/core/store/projectFile'
import { projectInputFromExperiment } from '@/core/exporters/types'
import { parseWarehouseYml } from '@/core/store/warehouseFile'

/** 仓库正本里的试剂（缓存一次；引用一致性检查与「余量以仓库为准」都要用它） */
let warehouseReagentsCache: Tube[] | null = null

async function warehouseReagents(): Promise<Tube[] | null> {
  if (warehouseReagentsCache) return warehouseReagentsCache
  const dataRoot = api()
  if (!dataRoot) return null
  try {
    const read = await dataRoot.readWarehouse()
    if (!read.ok || !read.content) return null
    const parsed = parseWarehouseYml(read.content)
    warehouseReagentsCache = parsed.snapshot.reagents as unknown as Tube[]
    return warehouseReagentsCache
  } catch {
    return null
  }
}

async function warehouseIds(): Promise<Set<string> | null> {
  const reagents = await warehouseReagents()
  return reagents ? new Set(reagents.map(r => r.id)) : null
}

/** 测试用：清掉仓库缓存 */
export function resetWarehouseReagentsCache(): void {
  warehouseReagentsCache = null
}

/**
 * 源试管的「余量」以 仓库.yml 为准。
 *
 * 工程 yml 里记的是引用（id 一般是仓库试剂原 id，缓冲液是 buffer-{仓库ID}-{目标ID}），
 * 余量属于仓库那份数据；工程自己产的中间产物没有对应试剂，保持工程里的值。
 */
export function applyWarehouseVolumes(experiment: Experiment, reagents: Tube[] | null): Experiment {
  if (!reagents || reagents.length === 0) return experiment
  const byId = new Map(reagents.map(r => [r.id, r]))
  let changed = false
  const tubes = experiment.tubes.map(tube => {
    const direct = byId.get(tube.id)
    const buffered = direct ? undefined : byId.get(bufferSourceId(tube.id) ?? '')
    const source = direct ?? buffered
    if (!source) return tube
    const sameVolume =
      tube.remainingVolume === source.remainingVolume &&
      (tube.remainingVolumeUnit || 'μL') === (source.remainingVolumeUnit || 'μL')
    if (sameVolume) return tube
    changed = true
    return {
      ...tube,
      remainingVolume: source.remainingVolume,
      remainingVolumeUnit: source.remainingVolumeUnit
    }
  })
  return changed ? { ...experiment, tubes } : experiment
}

/** buffer-{仓库ID}-{目标ID} → 仓库ID（仓库 id 自带连字符，所以取中段） */
function bufferSourceId(tubeId: string): string | null {
  if (!tubeId.startsWith('buffer-')) return null
  const parts = tubeId.split('-')
  if (parts.length < 3) return null
  return parts.slice(1, -1).join('-')
}

/** 工程里引用的仓库试剂在 仓库.yml 里找不到时，点名报出来（不静默丢） */
function checkReagentRefs(experiment: Experiment, ids: Set<string> | null): string[] {
  if (!ids) return []
  const missing = missingReagentRefs(projectInputFromExperiment(experiment), ids)
  if (missing.length === 0) return []
  const message = `工程「${experiment.name}」引用了仓库里不存在的试剂：${missing.join('、')}（请先在仓库里补上，否则这些管在笔记里会缺成分）`
  console.error('[Store] ' + message)
  return [message]
}

export interface ProjectFileStat {
  mtimeMs: number
  size: number
  /** 内容哈希（第 6 条）：mtime 变了但 hash 一样 = 没冲突，主进程据此放行 */
  hash?: string
}

export interface ProjectSourceEntry {
  experiment: Experiment
  fileName: string
  stat: ProjectFileStat | null
  warnings: string[]
  /** 这份数据是从文件读出来的（false = 由数据库生成） */
  fromFile: boolean
  /** 文件里自己写了 project.id（false = 借的数据库 id / 新生成的 id） */
  idFromFile: boolean
}

/** 保存时撞上外部修改 */
export class ProjectFileConflictError extends Error {
  fileName: string
  stat: ProjectFileStat | null
  constructor(fileName: string, stat: ProjectFileStat | null) {
    super(`工程文件已被外部修改：${fileName}`)
    this.name = 'ProjectFileConflictError'
    this.fileName = fileName
    this.stat = stat
  }
}

function api() {
  return typeof window !== 'undefined' ? window.electronAPI?.dataRoot : undefined
}

/** 主进程没起来（浏览器预览）时，正本功能整体跳过，不影响原有流程 */
export function isProjectFileAvailable(): boolean {
  return Boolean(api())
}

/** 一次读到的工程正本（按 id 或按名字命中的都归一成这个形状） */
interface ProjectSourceRead {
  path: string
  content: string
  stat: ProjectFileStat | null
}

/**
 * 找一份工程正本：**先按工程 id 扫 工程/*.yml**（文件被改名也认），再退回按名字找。
 * 2026-11 修：以前只按名字找，改名后就在旁边又生成一份，越攒越多。
 */
async function readProjectByAnyKey(fallback: Experiment): Promise<ProjectSourceRead | null> {
  const dataRoot = api()
  if (!dataRoot) return null

  try {
    if (fallback.id && typeof dataRoot.findProject === 'function') {
      const byId = await dataRoot.findProject(fallback.id)
      if (byId.ok && byId.content) return { path: byId.path, content: byId.content, stat: byId.stat }
    }
  } catch (error) {
    console.warn('[Store] 按 id 找工程正本失败，退回按名字找：', error)
  }

  const byName = await dataRoot.readProject(fallback.name)
  if (byName.ok && byName.content) {
    return { path: byName.path, content: byName.content, stat: byName.stat }
  }
  return null
}

/**
 * 读一份工程正本；文件不在就由数据库记录生成一份。
 * @param fallback 数据库里的那条记录（用来补 id / 快照，并在文件缺失时作为内容来源）
 */
export async function loadProjectSource(fallback: Experiment): Promise<ProjectSourceEntry | null> {
  const dataRoot = api()
  if (!dataRoot) return null

  const found = await readProjectByAnyKey(fallback)
  if (found) {
    const loaded = experimentFromProjectFile(found.content, fallback)
    const refWarnings = checkReagentRefs(loaded.experiment, await warehouseIds())
    // 源试管的余量属于仓库那份数据，工程文件只记引用
    const withVolumes = applyWarehouseVolumes(loaded.experiment, await warehouseReagents())
    return {
      experiment: withVolumes,
      fileName: fileNameOf(found.path),
      stat: found.stat,
      warnings: [...loaded.warnings, ...refWarnings],
      fromFile: true,
      idFromFile: loaded.idFromFile
    }
  }

  // 文件不存在（id 和名字都找不到）→ 用数据库里的旧数据生成正本
  const content = projectFileText(fallback)
  const written = await dataRoot.writeProject({ id: fallback.id, name: fallback.name, content })
  if (!written.ok) {
    console.warn('[Store] 生成工程正本失败：', written)
    return null
  }
  console.log(`[Store] 找不到工程正本（id=${fallback.id}，名字=${fallback.name}），由 DB 生成 ${written.fileName}`)
  return {
    experiment: fallback,
    fileName: written.fileName,
    stat: written.stat,
    warnings: checkReagentRefs(fallback, await warehouseIds()),
    fromFile: false,
    idFromFile: false
  }
}

/** 只读当前文件状态（窗口获得焦点时用来判断「别人改过没有」） */
export async function statProjectSource(fileName: string): Promise<ProjectFileStat | null> {
  const dataRoot = api()
  if (!dataRoot) return null
  return dataRoot.statProject(fileName)
}

/**
 * 写工程正本。
 * @param expect 上次读/写时的 stat；对不上就抛 ProjectFileConflictError，界面负责问主人
 */
export async function saveProjectSource(
  experiment: Experiment,
  expect?: ProjectFileStat | null
): Promise<{ fileName: string; stat: ProjectFileStat }> {
  const dataRoot = api()
  if (!dataRoot) throw new Error('工程正本需要桌面应用（当前是浏览器预览）')

  const content = projectFileText(experiment)
  const result = await dataRoot.writeProject({
    id: experiment.id,
    name: experiment.name,
    content,
    expect: expect ?? null
  })

  if (!result.ok) {
    if ('conflict' in result && result.conflict) {
      throw new ProjectFileConflictError(fileNameOf(result.path), result.stat)
    }
    throw new Error(('error' in result && result.error) || '写工程正本失败')
  }
  return { fileName: result.fileName, stat: result.stat }
}

/** 用文件里的内容覆盖当前工程（冲突时主人选「重新载入」） */
export async function reloadProjectSource(fallback: Experiment): Promise<ProjectSourceEntry | null> {
  if (!api()) return null
  const found = await readProjectByAnyKey(fallback)
  if (!found) return null
  const loaded = experimentFromProjectFile(found.content, fallback)
  return {
    experiment: applyWarehouseVolumes(loaded.experiment, await warehouseReagents()),
    fileName: fileNameOf(found.path),
    stat: found.stat,
    warnings: loaded.warnings,
    fromFile: true,
    idFromFile: loaded.idFromFile
  }
}

/** 读 工程/ 目录下所有工程（用于把手工新建的 yml 也列出来） */
export async function listProjectSources(): Promise<
  { fileName: string; name: string; stat: ProjectFileStat; content: string }[]
> {
  const dataRoot = api()
  if (!dataRoot) return []
  const files = await dataRoot.listProjects()
  const out: { fileName: string; name: string; stat: ProjectFileStat; content: string }[] = []
  for (const file of files) {
    const read = await dataRoot.readProject(file.fileName)
    if (read.ok && read.content && read.stat) {
      out.push({ fileName: file.fileName, name: file.name, stat: read.stat, content: read.content })
    }
  }
  return out
}

/** 把文件内容还原成工程（不碰数据库） */
export function experimentFromFileText(text: string, fallback?: Experiment | null): Experiment {
  return experimentFromProjectFile(text, fallback ?? null).experiment
}

function fileNameOf(fullPath: string): string {
  return String(fullPath || '').split(/[\\/]/).pop() || ''
}
