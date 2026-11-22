/**
 * CLI 的六类命令：list / validate / calc / diff / export / lock。
 *
 * 原则：
 * - 全部只读，只有 export（写 SOP/yml）和 lock/unlock（写锁文件）会落盘；
 * - 计算与校验一律复用 `src/core`，这里不另写规则；
 * - 每个命令返回 `{ code, text, json }`，`code` 就是进程退出码（0 正常、1 发现问题、2 参数错）。
 */

import fs from 'fs'
import path from 'path'

import { computeMixture } from '../core/mix'
import type { MixSource } from '../core/schema'
import { validateExperiment } from '../core/validate'
import { formatQuantity } from '../core/units'
import { parseQuantity } from '../core/units'
import { toBaseVolume } from '../core/exporters/quantity'
import { toSopMarkdown } from '../core/exporters/sop'
import { projectInputFromExperiment } from '../core/exporters/types'
import { projectFileText } from '../core/store/projectFile'
import { toWarehouseYml } from '../core/store/warehouseFile'
import { MissingReagentRefError, settleExperiment } from '../core/settle'
import { checkExpectedContent, hashContent } from '../core/store/fileStat'
import { statFile, readTextFile } from '../../electron/dataRoot'
import { formatCheckIssues } from '../../src/renderer/src/pages/experimentCheckMessages'
import {
  LOCK_STALE_MINUTES,
  checkLockRelease,
  formatLockAge,
  lockAgeMinutes,
  lockOwnerLabel,
  lockTargetsProject,
  type AgentLock
} from '../core/lock'
import type { Experiment, Tube } from '../core/schema'

import { WAREHOUSE_FILENAME, projectDir } from '../../electron/dataRoot'
import {
  exportDir,
  loadProject,
  loadWarehouse,
  listProjects,
  readLock,
  reagentRefWarnings,
  removeLock,
  resolveRoot,
  writeFileAtomic,
  writeLock,
  type LoadedProject
} from './context'
import { flagBool, flagNumber, flagString, type ParsedArgs } from './args'

export interface CommandResult {
  code: number
  text: string
  json?: unknown
}

const EXIT_OK = 0
const EXIT_FINDINGS = 1
const EXIT_USAGE = 2

function usage(text: string): CommandResult {
  return { code: EXIT_USAGE, text }
}

/** 一个工程里的试管，按「先中间产物按配置序号、再来源、再缓冲液」排一下，读起来顺 */
function sortedTubes(tubes: Tube[]): Tube[] {
  const rank = (tube: Tube): number => {
    if (tube.type === 'intermediate') return 0
    if (tube.type === 'source') return 1
    if (tube.type === 'buffer') return 2
    return 3
  }
  return [...tubes].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    const ao = a.configOrder ?? Number.MAX_SAFE_INTEGER
    const bo = b.configOrder ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

function volumeText(value: number): string {
  return formatQuantity(value, 'volume')
}

function concentrationText(value: number): string {
  return formatQuantity(value, 'concentration')
}

/** 连线体积统一成 μL（尊重每根线自己的 volumeUnit） */
function connVolumeToUl(connection: { volume: number; volumeUnit?: Tube['totalVolumeUnit'] }): number {
  return toBaseVolume(connection.volume, connection.volumeUnit || 'μL')
}

// ============================== list ==============================

export function commandList(args: ParsedArgs): CommandResult {
  const root = resolveRoot(flagString(args.flags, 'root'))
  const json = flagBool(args.flags, 'json')
  const projects = listProjects(root)
  const lock = readLock(root)

  const rows = projects.map(file => {
    const loaded = loadProject(root, file.fileName)
    const experiment = loaded?.experiment
    const lockedBy =
      lock && !('broken' in lock) && (lock.project === experiment?.name || lock.project === experiment?.id)
        ? lock.agent
        : ''
    const stem = file.fileName.replace(/\.yml$/i, '')
    const displayName = experiment?.name && experiment.name !== stem ? `${experiment.name}（${stem}）` : stem
    return {
      name: displayName,
      id: experiment?.id || '',
      fileName: file.fileName,
      tubes: experiment?.tubes.length ?? 0,
      connections: experiment?.connections.length ?? 0,
      status: experiment?.status || '',
      updatedAt: experiment?.updatedAt || '',
      fileMtime: file.stat ? new Date(file.stat.mtimeMs).toISOString() : '',
      locked: Boolean(lockedBy),
      lockedBy
    }
  })

  if (json) {
    return { code: EXIT_OK, text: '', json: { root, projects: rows } }
  }

  if (rows.length === 0) {
    return { code: EXIT_OK, text: `${root} 里没有工程（${path.join(root, '工程')} 是空的）` }
  }

  const lines = [`${root}：${rows.length} 个工程`]
  for (const row of rows) {
    const stamp = (row.updatedAt || row.fileMtime || '').slice(0, 16).replace('T', ' ')
    const lockMark = row.locked ? `  🔒 ${row.lockedBy}` : ''
    lines.push(
      `- ${row.name}｜${row.tubes} 支试管 / ${row.connections} 条连线｜${stamp}${lockMark}`
    )
  }
  return { code: EXIT_OK, text: lines.join('\n') }
}

// ============================== validate ==============================

export function commandValidate(args: ParsedArgs): CommandResult {
  const root = resolveRoot(flagString(args.flags, 'root'))
  const wanted = args.positionals[0]
  if (!wanted) return usage('用法：labflow validate <工程名> [--json] [--root <目录>]')

  const project = loadProject(root, wanted)
  if (!project) return { code: EXIT_FINDINGS, text: `找不到工程「${wanted}」（在 ${path.join(root, '工程')} 里）` }

  const warehouse = loadWarehouse(root)
  const experiment = project.experiment
  const issues = validateExperiment({
    tubes: experiment.tubes,
    connections: experiment.connections,
    warehouseTubes: warehouse.snapshot.reagents,
    defaultBuffer: experiment.defaultBuffer
  })
  const refs = reagentRefWarnings(project, warehouse.snapshot)
  const formatted = formatCheckIssues(issues, experiment.tubes, 'zh')
  const total = formatted.length + refs.length

  if (flagBool(args.flags, 'json')) {
    return {
      code: total === 0 ? EXIT_OK : EXIT_FINDINGS,
      text: '',
      json: {
        project: experiment.name,
        ok: total === 0,
        issues: formatted.map((entry, index) => ({
          code: issues[index].code,
          tubeId: entry.tubeId,
          tubeName: entry.tubeName,
          params: issues[index].params,
          message: entry.message
        })),
        reagentRefs: refs
      }
    }
  }

  if (total === 0) {
    return { code: EXIT_OK, text: `${experiment.name}：没有发现问题（${experiment.tubes.length} 支试管 / ${experiment.connections.length} 条连线）` }
  }

  const lines = [`${experiment.name}：${total} 个问题`]
  let index = 1
  for (const entry of formatted) {
    const where = entry.tubeName ? `管「${entry.tubeName}」：` : ''
    lines.push(`${index}. [${issues[index - 1].code}] ${where}${entry.message}`)
    index++
  }
  for (const ref of refs) {
    lines.push(`${index}. [reagent_missing] ${ref}`)
    index++
  }
  return { code: EXIT_FINDINGS, text: lines.join('\n') }
}

// ============================== calc ==============================

interface CalculatedTube {
  id: string
  name: string
  type: string
  configOrder?: number
  /** 本管最终体积（中间产物 = 入边合计；源/缓冲液 = 本轮出边合计） */
  volume: number
  volumeText: string
  /** 各成分浓度（µM 归一化后格式化） */
  substances: { name: string; concentration: number; text: string }[]
  /** 仓库里还剩多少（只有源试管有） */
  remaining?: number
  remainingText?: string
  /** 本轮预计剩余 = 仓库余量 − 本轮消耗 */
  expectedRemaining?: number
  expectedRemainingText?: string
}

function calculateTubes(experiment: Experiment): CalculatedTube[] {
  const connections = experiment.connections.map(connection => ({
    fromTubeId: connection.fromTubeId,
    toTubeId: connection.toTubeId,
    volume: connVolumeToUl(connection),
    volumeUnit: 'μL' as Tube['totalVolumeUnit']
  }))

  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  for (const connection of connections) {
    incoming.set(connection.toTubeId, (incoming.get(connection.toTubeId) || 0) + connection.volume)
    outgoing.set(connection.fromTubeId, (outgoing.get(connection.fromTubeId) || 0) + connection.volume)
  }

  // 入边来源：缓冲液也要算进总体积（它只是不带成分），否则稀释倍数会算错
  const incomingSources = (tubeId: string): MixSource[] => {
    const sources: MixSource[] = []
    for (const connection of experiment.connections) {
      if (connection.toTubeId !== tubeId) continue
      const sourceTube = experiment.tubes.find(item => item.id === connection.fromTubeId)
      if (!sourceTube) continue
      sources.push({
        substances: sourceTube.type === 'buffer' ? [] : sourceTube.substances || [],
        volume: connVolumeToUl(connection)
      })
    }
    return sources
  }

  return sortedTubes(experiment.tubes).map(tube => {
    const sourceList = incomingSources(tube.id)
    const mixture = computeMixture(sourceList, { unitMode: 'uM', round: false })
    const volume =
      tube.type === 'intermediate' ? incoming.get(tube.id) || 0 : outgoing.get(tube.id) || 0

    const substances =
      tube.type === 'intermediate'
        ? mixture.map(entry => ({
            name: entry.name,
            concentration: entry.concentration,
            text: concentrationText(entry.concentration)
          }))
        : (tube.substances || []).map(substance => {
            const value = parseQuantity(`${substance.concentration} ${substance.concentrationUnit}`, 'concentration')
            return {
              name: substance.name,
              concentration: value === null ? substance.concentration : value,
              text: concentrationText(value === null ? substance.concentration : value)
            }
          })

    const result: CalculatedTube = {
      id: tube.id,
      name: tube.name,
      type: tube.type,
      configOrder: tube.configOrder,
      volume,
      volumeText: volumeText(volume),
      substances
    }

    if (tube.type === 'source') {
      const warehouseTube = experiment.warehouseSnapshot?.find(item => item.id === tube.id)
      const remaining = warehouseTube ? warehouseTube.remainingVolume : tube.remainingVolume
      const used = outgoing.get(tube.id) || 0
      result.remaining = remaining
      result.remainingText = volumeText(remaining)
      result.expectedRemaining = remaining - used
      result.expectedRemainingText = volumeText(remaining - used)
    }

    return result
  })
}

export function commandCalc(args: ParsedArgs): CommandResult {
  const root = resolveRoot(flagString(args.flags, 'root'))
  const wanted = args.positionals[0]
  if (!wanted) return usage('用法：labflow calc <工程名> [--tube <管名>] [--json] [--root <目录>]')

  const project = loadProject(root, wanted)
  if (!project) return { code: EXIT_FINDINGS, text: `找不到工程「${wanted}」` }

  const all = calculateTubes(project.experiment)
  const only = flagString(args.flags, 'tube')
  const rows = only ? all.filter(row => row.name === only || row.id === only) : all
  if (rows.length === 0) {
    return { code: EXIT_FINDINGS, text: `工程「${project.experiment.name}」里没有管「${only}」` }
  }

  if (flagBool(args.flags, 'json')) {
    return {
      code: EXIT_OK,
      text: '',
      json: { project: project.experiment.name, tubes: rows }
    }
  }

  const lines = [`${project.experiment.name}：${rows.length} 支试管`]
  for (const row of rows) {
    const order = row.configOrder ? `#${row.configOrder} ` : ''
    const kind = row.type === 'intermediate' ? '中间产物' : row.type === 'source' ? '来源试剂' : row.type === 'buffer' ? '缓冲液' : row.type
    const parts = [`${order}${row.name}`, `${kind}`, `体积 ${row.volumeText}`]
    if (row.substances.length > 0) {
      parts.push(row.substances.map(substance => `${substance.name} ${substance.text}`).join('；'))
    }
    if (row.remainingText !== undefined) {
      parts.push(`仓库余量 ${row.remainingText} → 预计剩余 ${row.expectedRemainingText}`)
    }
    lines.push(`- ${parts.join('｜')}`)
  }
  return { code: EXIT_OK, text: lines.join('\n') }
}

// ============================== diff ==============================

interface TubeSnapshot {
  name: string
  type: string
  totalVolume: number
  substances: Record<string, { value: number; text: string }>
}

function snapshotOf(experiment: Experiment): Map<string, TubeSnapshot> {
  const map = new Map<string, TubeSnapshot>()
  for (const tube of experiment.tubes) {
    const substances: Record<string, { value: number; text: string }> = {}
    for (const substance of tube.substances || []) {
      const value = parseQuantity(`${substance.concentration} ${substance.concentrationUnit}`, 'concentration')
      substances[substance.name] = {
        value: value === null ? substance.concentration : value,
        text: concentrationText(value === null ? substance.concentration : value)
      }
    }
    map.set(tube.name, {
      name: tube.name,
      type: tube.type,
      totalVolume: parseQuantity(`${tube.totalVolume} ${tube.totalVolumeUnit}`, 'volume') ?? tube.totalVolume,
      substances
    })
  }
  return map
}

function connectionKey(experiment: Experiment): Map<string, { volume: number; from: string; to: string }> {
  const nameById = new Map(experiment.tubes.map(tube => [tube.id, tube.name]))
  const map = new Map<string, { volume: number; from: string; to: string }>()
  for (const connection of experiment.connections) {
    const from = nameById.get(connection.fromTubeId) || connection.fromTubeId
    const to = nameById.get(connection.toTubeId) || connection.toTubeId
    map.set(`${from}→${to}`, { volume: connVolumeToUl(connection), from, to })
  }
  return map
}

function diffExperiments(a: Experiment, b: Experiment) {
  const left = snapshotOf(a)
  const right = snapshotOf(b)

  const onlyA = [...left.keys()].filter(name => !right.has(name))
  const onlyB = [...right.keys()].filter(name => !left.has(name))

  const concentrationChanges: { tube: string; substance: string; from: string; to: string }[] = []
  const volumeChanges: { tube: string; from: string; to: string }[] = []

  for (const [name, before] of left) {
    const after = right.get(name)
    if (!after) continue

    if (Math.abs(before.totalVolume - after.totalVolume) > 1e-9) {
      volumeChanges.push({
        tube: name,
        from: volumeText(before.totalVolume),
        to: volumeText(after.totalVolume)
      })
    }

    const names = new Set([...Object.keys(before.substances), ...Object.keys(after.substances)])
    for (const substance of names) {
      const wasThere = before.substances[substance]
      const isThere = after.substances[substance]
      const from = wasThere ? wasThere.text : '（无）'
      const to = isThere ? isThere.text : '（无）'
      if (from !== to) concentrationChanges.push({ tube: name, substance, from, to })
    }
  }

  const leftEdges = connectionKey(a)
  const rightEdges = connectionKey(b)
  const edgesOnlyA = [...leftEdges.keys()].filter(key => !rightEdges.has(key))
  const edgesOnlyB = [...rightEdges.keys()].filter(key => !leftEdges.has(key))
  const edgeVolumeChanges = [...leftEdges.keys()]
    .filter(key => rightEdges.has(key))
    .filter(key => Math.abs((leftEdges.get(key)?.volume || 0) - (rightEdges.get(key)?.volume || 0)) > 1e-9)
    .map(key => ({
      edge: key,
      from: volumeText(leftEdges.get(key)?.volume || 0),
      to: volumeText(rightEdges.get(key)?.volume || 0)
    }))

  return { onlyA, onlyB, concentrationChanges, volumeChanges, edgesOnlyA, edgesOnlyB, edgeVolumeChanges }
}

export function commandDiff(args: ParsedArgs): CommandResult {
  const root = resolveRoot(flagString(args.flags, 'root'))
  const [nameA, nameB] = args.positionals
  if (!nameA || !nameB) return usage('用法：labflow diff <工程A> <工程B> [--json] [--root <目录>]')

  const projectA = loadProject(root, nameA)
  const projectB = loadProject(root, nameB)
  if (!projectA) return { code: EXIT_FINDINGS, text: `找不到工程「${nameA}」` }
  if (!projectB) return { code: EXIT_FINDINGS, text: `找不到工程「${nameB}」` }

  // 同名副本（比如 AD-5.2 / AD-5.2-改 内部都写 AD-5.2）时用文件名区分，免得报告看着像自己跟自己比
  const labelOf = (project: LoadedProject) => {
    const stem = project.fileName.replace(/\.yml$/i, '')
    const name = project.experiment.name
    return stem === name ? name : `${name}（${stem}）`
  }
  const labelA = labelOf(projectA)
  const labelB = labelOf(projectB)
  const diff = diffExperiments(projectA.experiment, projectB.experiment)
  const changes =
    diff.onlyA.length +
    diff.onlyB.length +
    diff.concentrationChanges.length +
    diff.volumeChanges.length +
    diff.edgesOnlyA.length +
    diff.edgesOnlyB.length +
    diff.edgeVolumeChanges.length

  if (flagBool(args.flags, 'json')) {
    return {
      code: EXIT_OK,
      text: '',
      json: {
        a: labelA,
        b: labelB,
        same: changes === 0,
        ...diff
      }
    }
  }

  if (changes === 0) {
    return { code: EXIT_OK, text: `${labelA} 与 ${labelB}：没有差异` }
  }

  const lines = [`${labelA} → ${labelB}：${changes} 处差异`]
  for (const name of diff.onlyA) lines.push(`- 只在 A：${name}`)
  for (const name of diff.onlyB) lines.push(`- 只在 B：${name}`)
  for (const change of diff.volumeChanges) lines.push(`- 体积变了：${change.tube} ${change.from} → ${change.to}`)
  for (const change of diff.concentrationChanges) {
    lines.push(`- 浓度变了：${change.tube} ${change.substance} ${change.from} → ${change.to}`)
  }
  for (const edge of diff.edgesOnlyA) lines.push(`- 连线只在 A：${edge}`)
  for (const edge of diff.edgesOnlyB) lines.push(`- 连线只在 B：${edge}`)
  for (const edge of diff.edgeVolumeChanges) lines.push(`- 连线体积变了：${edge.edge} ${edge.from} → ${edge.to}`)
  return { code: EXIT_OK, text: lines.join('\n') }
}

// ============================== export ==============================

export function commandExport(args: ParsedArgs): CommandResult {
  const root = resolveRoot(flagString(args.flags, 'root'))
  const wanted = args.positionals[0]
  if (!wanted) return usage('用法：labflow export <工程名> [--out <目录>] [--sop] [--yml] [--png] [--root <目录>]')

  if (flagBool(args.flags, 'png')) {
    return {
      code: EXIT_FINDINGS,
      text: '流程图需要在 LabFlow 界面里导出（那张图是实验模拟页画布的真截图），CLI 不生成 PNG。'
    }
  }

  const project = loadProject(root, wanted)
  if (!project) return { code: EXIT_FINDINGS, text: `找不到工程「${wanted}」` }

  const outFlag = flagString(args.flags, 'out')
  const outDir = outFlag ? path.resolve(outFlag) : exportDir(root)
  const wantSop = flagBool(args.flags, 'sop')
  const wantYml = flagBool(args.flags, 'yml')
  const wantAll = !wantSop && !wantYml

  fs.mkdirSync(outDir, { recursive: true })
  const written: string[] = []

  if (wantAll || wantSop) {
    const target = path.join(outDir, `${project.experiment.name}-SOP.md`)
    writeFileAtomic(target, toSopMarkdown(projectInputFromExperiment(project.experiment)))
    written.push(target)
  }
  if (wantAll || wantYml) {
    const target = path.join(outDir, `${project.experiment.name}.yml`)
    writeFileAtomic(target, projectFileText(project.experiment))
    written.push(target)
  }

  const text = [`${project.experiment.name}：写了 ${written.length} 个文件`, ...written.map(file => `- ${file}`)].join('\n')
  if (flagBool(args.flags, 'json')) {
    return { code: EXIT_OK, text: '', json: { project: project.experiment.name, outDir, files: written } }
  }
  return { code: EXIT_OK, text }
}

// ============================== lock ==============================

export function commandLock(args: ParsedArgs): CommandResult {
  const root = resolveRoot(flagString(args.flags, 'root'))
  const json = flagBool(args.flags, 'json')
  const sub = args.positionals[0] || 'status'

  if (sub === 'unlock') {
    // 第 2 条：解锁要校验三元组（pid + agent + project 与锁文件一致）。
    // 以前是无条件删——B 能把 A 的锁踢掉，A 还在写文件却没人知道。
    const force = flagBool(args.flags, 'force')
    const lock = readLock(root)
    const caller = {
      pid: process.pid,
      agent: flagString(args.flags, 'agent') || 'codex/墨林',
      project: flagString(args.flags, 'project') || args.positionals[1]
    }
    const check = checkLockRelease(lock, caller, { force })
    if (!check.ok) {
      if (json) {
        return {
          code: EXIT_FINDINGS,
          text: '',
          json: { ok: false, released: false, reason: check.reason, lock }
        }
      }
      return {
        code: EXIT_FINDINGS,
        text: `${check.reason}\n（确认要删就加 --force：labflow unlock --force）`
      }
    }
    removeLock(root)
    const holder = lock && !('broken' in lock) ? lockOwnerLabel(lock) : ''
    if (json) return { code: EXIT_OK, text: '', json: { ok: true, released: true, force, holder } }
    return { code: EXIT_OK, text: `已解锁（${path.join(root, '.agent-lock')}）${force && holder ? `；强制删掉了 ${holder} 的锁` : ''}` }
  }

  if (sub === 'status' || sub === '') {
    const lock = readLock(root)
    if (json) return { code: EXIT_OK, text: '', json: { lock } }
    if (!lock) return { code: EXIT_OK, text: '没有锁' }
    if ('broken' in lock) return { code: EXIT_FINDINGS, text: `锁文件无法解析：${lock.reason}` }
    const minutes = lockAgeMinutes(lock)
    const stale = minutes >= LOCK_STALE_MINUTES ? '（可能忘记解锁了）' : ''
    return {
      code: EXIT_OK,
      text: `🔒 ${lock.project}｜${lock.agent}｜${formatLockAge(minutes)}${stale}\n${lock.note || '未说明'}`
    }
  }

  if (sub === 'lock') {
    const project = flagString(args.flags, 'project') || args.positionals[1]
    if (!project) return usage('用法：labflow lock --project <工程名> [--note <文字>] [--minutes N] [--json]')
    const minutes = flagNumber(args.flags, 'minutes')
    const startedAt =
      minutes !== undefined && minutes > 0
        ? new Date(Date.now() - minutes * 60 * 1000).toISOString()
        : new Date().toISOString()

    const lock = {
      pid: process.pid,
      agent: flagString(args.flags, 'agent') || 'codex/墨林',
      project,
      note: flagString(args.flags, 'note') || '',
      startedAt
    }
    writeLock(root, lock)
    if (json) return { code: EXIT_OK, text: '', json: { ok: true, lock } }
    return { code: EXIT_OK, text: `已加锁：${lock.project}（${path.join(root, '.agent-lock')}）` }
  }

  return usage(`未知的锁子命令：${sub}（可用：lock / unlock / status）`)
}

export type { AgentLock, LoadedProject }

/**
 * 结算（结束实验）—— 第 4 步。
 *
 * 默认 **只算不写**（防止误扣试剂）；要真改文件得显式 `--apply`。
 * 规则完全来自 `src/core/settle.ts`，与界面「结束实验」同一套。
 */
export function commandComplete(args: ParsedArgs): CommandResult {
  const root = resolveRoot(flagString(args.flags, 'root'))
  const json = flagBool(args.flags, 'json')
  const apply = flagBool(args.flags, 'apply') && !flagBool(args.flags, 'dry-run')
  const wanted = args.positionals[0]

  if (!wanted) return usage('用法：labflow complete <工程> [--apply] [--json]（默认只算不写）')

  const project = loadProject(root, wanted)
  if (!project) return { code: EXIT_FINDINGS, text: `找不到工程：${wanted}（在 ${projectDir(root)} 里）` }

  if (project.experiment.status === 'completed') {
    return {
      code: EXIT_FINDINGS,
      text: `工程「${project.experiment.name}」已经结束过了（completedAt ${project.experiment.completedAt || '未知'}），不再重复结算`
    }
  }

  const { snapshot, warnings: warehouseWarnings, text: warehouseTextAtRead, stat: warehouseStatAtRead } = loadWarehouse(root)
  // 基底必须是仓库全集：仓库.yml 不存在 / 读不出试剂时不能当「空仓库」结算，
  // 否则写出来的 仓库.yml 只剩本实验新入仓的那几根（和界面那次同类：基底不是全量）
  if (snapshot.reagents.length === 0) {
    return {
      code: EXIT_FINDINGS,
      text: `拒绝结算：${WAREHOUSE_FILENAME} 里没有读到任何试剂（${warehouseWarnings[0] || '文件为空'}），先把仓库放回来`
    }
  }
  const now = new Date().toISOString()
  let settled: ReturnType<typeof settleExperiment>
  try {
    settled = settleExperiment({ experiment: project.experiment, warehouse: snapshot.reagents }, { now: () => now })
  } catch (error) {
    // 第 7 条：源试管引用的试剂在仓库里找不到 → 拒绝结算（core 里抛，这里翻成人话 + 退出码 1）
    if (error instanceof MissingReagentRefError) {
      const named = error.tubes.map(tube => `「${tube.name}」（${tube.id}）`).join('、')
      const text = `拒绝结算：画布上 ${error.tubes.length} 根源试管引用的试剂在仓库里找不到：${named}。\n请先在 仓库.yml 里补上这些试剂（或把这几根管从画布上删掉）再结算。`
      if (json) {
        return {
          code: EXIT_FINDINGS,
          text: '',
          json: { ok: false, applied: false, missingRefs: error.tubes, project: project.experiment.name }
        }
      }
      return { code: EXIT_FINDINGS, text }
    }
    throw error
  }

  const usageLines = settled.usage.map(item => {
    const tail = item.depleted ? '　→ 已耗尽' : ''
    return `  ${item.name}：${formatQuantity(item.before, 'volume')} → ${formatQuantity(item.after, 'volume')}（扣 ${formatQuantity(item.used, 'volume')}）${tail}`
  })
  const createdLines = settled.created.map(item => `  ${item.name}：入仓 ${formatQuantity(item.remainingVolume, 'volume')}`)

  const payload = {
    ok: true,
    applied: apply,
    project: project.experiment.name,
    fileName: project.fileName,
    usage: settled.usage,
    created: settled.created,
    depleted: settled.depleted,
    warnings: warehouseWarnings
  }

  if (!apply) {
    if (json) return { code: EXIT_OK, text: '', json: payload }
    const head = `结算预览（未写任何文件）：${project.experiment.name}`
    const body = [
      usageLines.length ? `扣减试剂（${settled.usage.length} 条）：\n${usageLines.join('\n')}` : '扣减试剂：无',
      createdLines.length ? `新入仓中间产物（${settled.created.length} 根）：\n${createdLines.join('\n')}` : '新入仓中间产物：无',
      settled.depleted.length ? `耗尽变 depleted：${settled.depleted.length} 根` : '耗尽变 depleted：无',
      '确认无误后加 --apply 才会真的写 仓库.yml 和工程状态'
    ]
    return { code: EXIT_OK, text: [head, ...body].join('\n\n') }
  }

  // —— 真写：先过截断护栏，再原子写仓库，最后把工程置 completed ——
  const existingCount = snapshot.reagents.length
  const nextCount = settled.warehouseAfter.length
  if (nextCount < existingCount) {
    return {
      code: EXIT_FINDINGS,
      text: `拒绝写 仓库.yml：试剂从 ${existingCount} 条降到 ${nextCount} 条（结算不该删试剂，请先 labflow validate 看看）`
    }
  }

  // 第 1 条：本工程被 Agent 锁着 → 一个文件都不写（退出码 1，中文原因）
  const agentLock = readLock(root)
  if (agentLock && !('broken' in agentLock)) {
    const mine = lockTargetsProject(agentLock, { id: project.experiment.id, name: project.experiment.name })
    if (mine) {
      const holder = lockOwnerLabel(agentLock)
      if (json) {
        return {
          code: EXIT_FINDINGS,
          text: '',
          json: { ok: false, applied: false, locked: true, holder, project: project.experiment.name }
        }
      }
      return {
        code: EXIT_FINDINGS,
        text: `拒绝写入：工程「${project.experiment.name}」正被 Agent 锁着（${holder}），已暂缓写入，一个文件都没改。\n等它解锁（labflow unlock --force）后再重跑本次结算。`
      }
    }
  }

  const warehouseText = toWarehouseYml({
    groups: snapshot.groups,
    reagents: settled.warehouseAfter,
    substanceColors: snapshot.substanceColors
  })

  const completedExperiment: Experiment = {
    ...project.experiment,
    status: 'completed',
    completedAt: now,
    endStateTubes: settled.endStateTubes
  }
  const projectText = projectFileText(completedExperiment)

  // 第 3 条：写之前先按**内容哈希**校验两份正本没被外部改过（mtime 只当快速路径）。
  // 冲突就一个文件都不写——以前是直接覆盖，外部改过的内容当场丢掉。
  const warehouseTarget = path.join(root, WAREHOUSE_FILENAME)
  const warehouseExpect = warehouseStatAtRead
    ? {
        mtimeMs: warehouseStatAtRead.mtimeMs,
        size: warehouseStatAtRead.size,
        hash: warehouseTextAtRead === null ? undefined : hashContent(warehouseTextAtRead)
      }
    : null
  const projectExpect = project.stat
    ? {
        mtimeMs: project.stat.mtimeMs,
        size: project.stat.size,
        hash: typeof project.text === 'string' ? hashContent(project.text) : undefined
      }
    : null

  const conflicts: string[] = []
  const warehouseCheck = checkExpectedContent(statFile(warehouseTarget), readTextFile(warehouseTarget), warehouseExpect)
  if (warehouseCheck.conflict) conflicts.push(WAREHOUSE_FILENAME)
  const projectCheck = checkExpectedContent(statFile(project.path), readTextFile(project.path), projectExpect)
  if (projectCheck.conflict) conflicts.push(path.basename(project.path))

  if (conflicts.length > 0) {
    if (json) {
      return {
        code: EXIT_FINDINGS,
        text: '',
        json: {
          ok: false,
          conflict: true,
          applied: false,
          conflicts,
          wroteWarehouse: false,
          wroteProject: false,
          project: project.experiment.name
        }
      }
    }
    return {
      code: EXIT_FINDINGS,
      text: `拒绝写入：${conflicts.join('、')} 已被外部修改，请重跑（一个文件都没写）`
    }
  }

  writeFileAtomic(warehouseTarget, warehouseText)
  try {
    writeFileAtomic(project.path, projectText)
  } catch (error) {
    // 第二份写失败：把仓库那份恢复回原文，别留「一半结算」
    const before = warehouseTextAtRead
    if (before !== null) {
      try {
        writeFileAtomic(warehouseTarget, before)
      } catch (restoreError) {
        console.error('[complete] 恢复 仓库.yml 失败：', restoreError)
      }
    }
    const reason = (error as Error)?.message || '未知原因'
    if (json) {
      return {
        code: EXIT_FINDINGS,
        text: '',
        json: { ok: false, applied: false, wroteWarehouse: false, wroteProject: false, error: reason }
      }
    }
    return { code: EXIT_FINDINGS, text: `写入工程正本失败（${reason}），已把 仓库.yml 恢复原状，请重跑` }
  }

  if (json) return { code: EXIT_OK, text: '', json: { ...payload, wroteWarehouse: true, wroteProject: true } }
  return {
    code: EXIT_OK,
    text: [
      `已结算：${project.experiment.name}`,
      usageLines.length ? `扣减试剂（${settled.usage.length} 条）：\n${usageLines.join('\n')}` : '扣减试剂：无',
      createdLines.length ? `新入仓中间产物（${settled.created.length} 根）：\n${createdLines.join('\n')}` : '新入仓中间产物：无',
      `已写：${path.join(root, WAREHOUSE_FILENAME)}`,
      `已写：${path.basename(project.path)}（status: completed）`
    ].join('\n\n')
  }
}
