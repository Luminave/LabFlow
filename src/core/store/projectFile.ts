/**
 * 工程正本文件：`工程/<工程名>.yml`
 *
 * 从第 1 步正本迁移起，一个工程的真相是这份文件，不是数据库。
 * 这里只做纯数据的「Experiment ⇄ yml 文本」，文件读写在主进程（electron/dataRoot.ts），
 * 这样测试与将来的 Agent CLI 都能直接用同一份规则。
 */

import type { Experiment, Tube } from '../schema'
import {
  PROJECT_FILE_VERSION,
  parseProjectYml,
  toProjectYml,
  type ParsedProject
} from '../exporters/yml'
import { projectInputFromExperiment, type ProjectInput } from '../exporters/types'
import type { ScaleOptions } from '../exporters/layout'

/** 由文件文本还回来的工程 + 需要主人知道的问题 */
export interface LoadedProjectFile {
  experiment: Experiment
  warnings: string[]
  /** 文件里写的版本号；缺省当 1（第 1 步导出器写的旧文件） */
  version: number
  /** 文件里没有 id、只能从别处（数据库记录 / 调用方）借一个 */
  idFromFile: boolean
}

/**
 * 生成工程正本文本。
 * 坐标：正本里写的是白板原坐标（boardX/boardY），画布排版用的 x/y 也一并写上，
 * 这样不打开 LabFlow 也能看懂这张图大致长什么样。
 */
export function projectFileText(experiment: Experiment, scale: ScaleOptions = {}): string {
  return toProjectYml(projectInputFromExperiment(experiment), scale)
}

/**
 * 读工程正本。
 *
 * @param text 文件内容
 * @param fallback 数据库里那条旧记录（没有就只靠文件）；用它补 id / 仓库快照 / 初始与结束状态快照
 *              —— 这三样在正本里不存（快照体积大且是历史产物），但界面需要它们存在。
 * @returns 永远不抛异常；结构坏掉时 warnings 里会说清楚，experiment 尽量还原可读部分
 */
export function experimentFromProjectFile(text: string, fallback?: Experiment | null): LoadedProjectFile {
  const parsed: ParsedProject = parseProjectYml(text)
  const input = parsed.input
  const warnings = [...parsed.warnings]
  const version = readVersion(text)

  const idFromFile = Boolean(input.id)
  const id = input.id || fallback?.id || ''

  if (!input.name) warnings.push('文件里没有 project.name，工程名按「未命名工程」处理')
  if (!id) warnings.push('文件里没有 project.id，也无法从数据库补齐（新工程会拿到新 id）')

  const now = new Date().toISOString()
  const experiment: Experiment = {
    id: id || cryptoId(),
    name: input.name || fallback?.name || '未命名工程',
    description: input.description ?? fallback?.description,
    createdAt: input.createdAt || fallback?.createdAt || now,
    updatedAt: input.updatedAt || fallback?.updatedAt || now,
    completedAt: input.completedAt || fallback?.completedAt,
    status: (input.status as Experiment['status']) || fallback?.status || 'draft',
    isWaste: input.isWaste ?? fallback?.isWaste,
    defaultBuffer: input.defaultBuffer ?? fallback?.defaultBuffer,
    // 文件被改坏时不要让工程变成空的：退回数据库里的那一份
    tubes: input.tubes.length ? input.tubes : (fallback?.tubes ?? []),
    tubePositions: input.positions,
    connections: input.connections,
    // 快照类字段正本不存：沿用数据库里的历史快照，没有就是 undefined
    warehouseSnapshot: fallback?.warehouseSnapshot,
    initialStateTubes: fallback?.initialStateTubes,
    endStateTubes: fallback?.endStateTubes
  }

  return { experiment, warnings, version, idFromFile }
}

/** 文件头里的 schemaVersion；读不到就当 1（第 1 步导出器写的老文件） */
export function readVersion(text: string): number {
  const match = /^schemaVersion:\s*(\d+)/m.exec(text)
  return match ? Number(match[1]) : 1
}

function cryptoId(): string {
  // 渲染进程/Node 18+ 都有 crypto.randomUUID；退化成时间戳，保证不抛异常
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `exp-${Date.now()}`
}

/**
 * 工程里引用的仓库试剂，必须在 仓库.yml 里存在。
 * 缺了就报出来（而不是静默把试剂引用丢掉）——否则界面会显示一根「没有来源」的管子。
 */
export function missingReagentRefs(input: ProjectInput, warehouseIds?: Iterable<string>): string[] {
  const known = new Set<string>(warehouseIds ?? (input.warehouseTubes ?? []).map(t => t.id))
  const missing: string[] = []
  const push = (id?: string) => {
    if (id && !known.has(id) && !missing.includes(id)) missing.push(id)
  }

  for (const tube of input.tubes as Tube[]) {
    // 缓冲液管的 id 形如 `buffer-{仓库ID}-{目标ID}`；仓库 ID 自身带连字符，
    // 所以只能拿已知 id 去比前缀，split 拆不出来。
    if (tube.type === 'buffer' && tube.id.startsWith('buffer-')) {
      const rest = tube.id.slice('buffer-'.length)
      const matched = [...known].some(id => rest === id || rest.startsWith(`${id}-`))
      if (!matched) push(tube.id)
    }
    push(tube.selectedBuffer)
  }

  return missing
}

export { PROJECT_FILE_VERSION }
