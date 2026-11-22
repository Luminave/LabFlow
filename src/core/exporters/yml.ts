/**
 * `项目.yml` —— 工程数据真相源。
 *
 * 为什么放 `src/core/exporters/`：三个导出器都只依赖纯数据（ProjectInput），
 * 与 React / Electron 无关，将来 Agent CLI（第 2 步）能直接复用同一份读写逻辑，
 * 不会出现「页面写出来的 .yml 和 Agent 读的 .yml 有第二套规则」。
 *
 * 写法约定（第 1 步）：
 * - 顶部 `schemaVersion` 用 `core/schema.ts` 的常量。
 * - 所有量写成「数值 + 单位」的紧凑串（`5 mM`、`12.5 μL`），不写 5000 这种裸数字；
 *   载入时由 units.ts 归一化回 µM / µL，Agent 手改成裸数字也按基准单位理解。
 * - 试管 id 原样保留（`buffer-{仓库ID}-{目标ID}` 这种语义 id 不重编码）。
 */

import yaml from 'js-yaml'

import type { ConcentrationUnit, Substance, Tube, TubeType, VolumeUnit } from '../schema'
import { SCHEMA_VERSION } from '../schema'

/**
 * 工程文件格式版本。
 * - 1：第 1 步导出器写出来的 `项目.yml`（只有导出用得到的字段）
 * - 2：正本迁移起，`工程/<工程名>.yml` 成为数据真相源，要能完整还原一个工程
 *      （多出 project.id / description / isWaste，以及每管的 asSource、groupId、状态、时间戳等）
 * 读文件时 1 和 2 都接受；写文件一律写 2。
 */
export const PROJECT_FILE_VERSION = 2

/** 当前程序支持的最高工程文件版本 */
export const SUPPORTED_PROJECT_VERSIONS = [1, PROJECT_FILE_VERSION] as const
import { formatQuantityExact, normalizeConcentration, parseQuantity, roundVolume } from '../units'
import { toBaseVolume } from './quantity'
import { tubeSubstanceColor } from './canvasColor'
import { resolveLayout, connectionSides, storedPosition, type ScaleOptions } from './layout'
import type { ProjectInput } from './types'

/** 解析 .yml 得到的结果：工程数据 + 需要主人知道的问题 */
export interface ParsedProject {
  input: ProjectInput
  warnings: string[]
}

/**
 * 体积/浓度写成紧凑串；库里历史数据出现过 null（空缓冲液管），
 * 统一按 0 写，宁可写 0 μL 也不让 .yml 里出现读不回来的「—」。
 */
function quantityOrZero(value: number | null | undefined, kind: 'concentration' | 'volume'): string {
  return formatQuantityExact(Number.isFinite(value as number) ? (value as number) : 0, kind)
}

/** 数字原样写（坐标、序号这类不需要单位的值） */
function num(value: number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  return Number.isFinite(value) ? value : undefined
}

/** 仓库试剂 ID：buffer-{仓库ID}-{目标ID} 取中间段；其余情况就是试管自己的 id */
export function warehouseIdOf(tube: Tube): string | undefined {
  if (tube.type === 'buffer' && tube.id.startsWith('buffer-')) {
    const parts = tube.id.split('-')
    if (parts.length >= 3) return parts.slice(1, -1).join('-')
  }
  return undefined
}

/** 一根试管在 .yml 里的样子 */
interface TubeDoc {
  id: string
  name: string
  type: TubeType
  tubeNumber?: string
  configOrder?: number
  warehouseId?: string
  totalVolume: string
  remainingVolume: string
  selectedBuffer?: string
  substances?: { name: string; concentration: string }[]
  /** 原色值（#rrggbb）：LabFlow 里这根管用来上色的成分背景色，画布侧只写预设色 */
  color?: string
  x: number
  y: number
  width: number
  height: number
  /** LabFlow 白板上的原始坐标，只备查，不参与画布排版 */
  boardX?: number
  boardY?: number
  notes?: string
  // —— schemaVersion 2：为了「只靠文件就能完整还原一个工程」补的字段 ——
  /** 作为原料使用（上次实验剩下的中间产物） */
  asSource?: boolean
  /** 分组 id（对应 仓库.yml 的 groups） */
  groupId?: string
  /** 试管状态：active / depleted / discarded（active 是默认值，不写） */
  status?: string
  storageLocation?: string
  storageCondition?: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

interface ConnectionDoc {
  id: string
  from: string
  to: string
  volume: string
  fromSide: string
  toSide: string
  label: string
}

interface ReagentDoc {
  id: string
  name: string
  type: TubeType
}

/**
 * 生成 `项目.yml` 文本。
 * 坐标缺失的试管会在这里被排到固定网格上，并写进文件（下次导出就带坐标了）。
 */
export function toProjectYml(input: ProjectInput, scale: ScaleOptions = {}): string {
  const layout = resolveLayout(input, scale)
  const nodeById = new Map(layout.tubes.map(node => [node.tube.id, node]))

  const warehouseIds = new Set((input.warehouseTubes || []).map(tube => tube.id))
  const reagents: ReagentDoc[] = []
  const seenReagents = new Set<string>()

  const tubes: TubeDoc[] = layout.tubes.map(({ tube, x, y, width, height }) => {
    // 原白板坐标只记备查（自动分层后 canvas 不用它）
    const board = storedPosition(input.positions, tube.id)
    const bufferWarehouseId = warehouseIdOf(tube)
    const warehouseId =
      bufferWarehouseId || (warehouseIds.has(tube.id) ? tube.id : undefined)

    if (warehouseId && !seenReagents.has(warehouseId)) {
      seenReagents.add(warehouseId)
      const fromSnapshot = (input.warehouseTubes || []).find(t => t.id === warehouseId)
      reagents.push({ id: warehouseId, name: fromSnapshot?.name || tube.name, type: fromSnapshot?.type || tube.type })
    }

    const doc: TubeDoc = {
      id: tube.id,
      name: tube.name,
      type: tube.type,
      tubeNumber: tube.tubeNumber,
      configOrder: num(tube.configOrder),
      warehouseId,
      totalVolume: quantityOrZero(toBaseVolume(tube.totalVolume, tube.totalVolumeUnit), 'volume'),
      remainingVolume: quantityOrZero(toBaseVolume(tube.remainingVolume, tube.remainingVolumeUnit), 'volume'),
      selectedBuffer: tube.selectedBuffer,
      substances: tube.substances && tube.substances.length > 0
        ? tube.substances.map(sub => ({
            name: sub.name,
            concentration: formatQuantityExact(
              // 物质浓度可能用 mM 记，先归一到 µM 再按好读的单位写
              normalizeConcentration(sub.concentration, sub.concentrationUnit),
              'concentration'
            )
          }))
        : undefined,
      color: tubeSubstanceColor(tube, input.substanceColors),
      x,
      y,
      width,
      height,
      boardX: board?.x,
      boardY: board?.y,
      notes: tube.notes,
      asSource: tube.asSource ? true : undefined,
      groupId: tube.groupId,
      status: tube.status && tube.status !== 'active' ? tube.status : undefined,
      storageLocation: tube.storageLocation,
      storageCondition: tube.storageCondition,
      tags: tube.tags && tube.tags.length > 0 ? tube.tags : undefined,
      createdAt: tube.createdAt || undefined,
      updatedAt: tube.updatedAt || undefined
    }

    // 清掉 undefined 字段，让 .yml 干净（js-yaml 会把 undefined 写成一行的空）
    return stripUndefined({ ...doc } as Record<string, unknown>) as unknown as TubeDoc
  })

  const connections: ConnectionDoc[] = input.connections.map(conn => {
    const from = nodeById.get(conn.fromTubeId)
    const to = nodeById.get(conn.toTubeId)
    const sides = from && to
      ? connectionSides(from, to)
      : { fromSide: 'right', toSide: 'left' }
    const volume = formatQuantityExact(toBaseVolume(conn.volume, conn.volumeUnit), 'volume')
    return {
      id: conn.id || `${conn.fromTubeId}->${conn.toTubeId}`,
      from: conn.fromTubeId,
      to: conn.toTubeId,
      volume,
      fromSide: sides.fromSide,
      toSide: sides.toSide,
      label: volume
    }
  })

  const doc: Record<string, unknown> = {
    schemaVersion: PROJECT_FILE_VERSION,
    project: stripUndefined({
      id: input.id,
      name: input.name,
      description: input.description,
      isWaste: input.isWaste ? true : undefined,
      date: input.date,
      status: input.status,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      completedAt: input.completedAt,
      defaultBuffer: input.defaultBuffer
    }),
    tubes,
    connections,
    reagents: reagents.length > 0 ? reagents : undefined
  }

  const body = yaml
    .dump(stripUndefined(doc), {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
      skipInvalid: true
    })
    // js-yaml 会把 y 键当成 YAML 1.1 的布尔值加引号（'y': 435），这里还原成 y: 435
    .replace(/^(\s*)'y': /gm, '$1y: ')

  return [
    '# LabFlow 工程文件（数据真相源）',
    '# 数值写法：`<数值> <单位>`；载入时由 src/core/units.ts 归一化回 µM / µL',
    `# 格式版本：${PROJECT_FILE_VERSION}`,
    body.trimEnd(),
    ''
  ].join('\n')
}



function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined && val !== null) out[key] = val
  }
  return out as Partial<T>
}

/** 读 .yml 里的量：字符串按单位换算回基准单位，裸数字按基准单位理解 */
function readQuantity(value: unknown, kind: 'concentration' | 'volume'): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return parseQuantity(value, kind)
  return null
}

/** 把 .yml 里的试管条目还原成 Tube（单位已归一到 µM / µL） */
function readTube(raw: Record<string, any>, warnings: string[]): Tube {
  const id = String(raw.id ?? '')
  const type = (raw.type as TubeType) || 'intermediate'

  const totalVolume = readQuantity(raw.totalVolume, 'volume')
  const remainingVolume = readQuantity(raw.remainingVolume, 'volume')
  if (totalVolume === null) warnings.push(`试管 ${id} 的 totalVolume 读不出来，按 0 处理`)
  if (remainingVolume === null) warnings.push(`试管 ${id} 的 remainingVolume 读不出来，按 0 处理`)

  const substances: Substance[] = Array.isArray(raw.substances)
    ? raw.substances.map((sub: any) => {
        const concentration = readQuantity(sub?.concentration, 'concentration')
        if (concentration === null) warnings.push(`试管 ${id} 的物质 ${sub?.name} 浓度读不出来，按 0 处理`)
        return {
          name: String(sub?.name ?? ''),
          concentration: roundVolume(concentration ?? 0, 6),
          concentrationUnit: 'μM' as ConcentrationUnit
        }
      })
    : []

  return {
    id,
    name: String(raw.name ?? id),
    type,
    totalVolume: roundVolume(totalVolume ?? 0, 6),
    totalVolumeUnit: 'μL' as VolumeUnit,
    remainingVolume: roundVolume(remainingVolume ?? 0, 6),
    remainingVolumeUnit: 'μL' as VolumeUnit,
    selectedBuffer: raw.selectedBuffer ? String(raw.selectedBuffer) : undefined,
    substances,
    configOrder: typeof raw.configOrder === 'number' ? raw.configOrder : undefined,
    tubeNumber: raw.tubeNumber ? String(raw.tubeNumber) : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
    asSource: raw.asSource === true,
    groupId: raw.groupId ? String(raw.groupId) : undefined,
    storageLocation: raw.storageLocation ? String(raw.storageLocation) : undefined,
    storageCondition: raw.storageCondition ? String(raw.storageCondition) : undefined,
    tags: Array.isArray(raw.tags) && raw.tags.length > 0 ? raw.tags.map((t: unknown) => String(t)) : undefined,
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
    status: (raw.status === 'depleted' || raw.status === 'discarded' ? raw.status : 'active') as Tube['status']
  }
}

/**
 * 载入 `项目.yml`。
 * 不抛异常：结构不对时返回一条 warning + 尽量读出来的部分，交给调用方决定怎么提示。
 */
export function parseProjectYml(text: string): ParsedProject {
  const warnings: string[] = []
  const empty: ProjectInput = { name: '', date: '', tubes: [], connections: [], positions: [] }

  let doc: any
  try {
    doc = yaml.load(text)
  } catch (error) {
    return { input: empty, warnings: [`YAML 解析失败：${(error as Error).message}`] }
  }

  if (!doc || typeof doc !== 'object') {
    return { input: empty, warnings: ['文件内容不是 YAML 映射'] }
  }

  const version = Number(doc.schemaVersion)
  if (!SUPPORTED_PROJECT_VERSIONS.includes(version as 1 | 2)) {
    warnings.push(`schemaVersion 是 ${doc.schemaVersion}，当前程序支持 ${SUPPORTED_PROJECT_VERSIONS.join(' / ')}`)
  }

  const project = doc.project && typeof doc.project === 'object' ? doc.project : {}
  const rawTubes: any[] = Array.isArray(doc.tubes) ? doc.tubes : []
  const tubes = rawTubes.map(raw => readTube(raw, warnings))

  const positions = rawTubes
    .filter(raw => Number.isFinite(raw?.x) && Number.isFinite(raw?.y))
    .map(raw => ({ tubeId: String(raw.id), x: Number(raw.x), y: Number(raw.y) }))

  const connections = (Array.isArray(doc.connections) ? doc.connections : []).map((raw: any) => {
    const volume = readQuantity(raw?.volume ?? raw?.label, 'volume')
    if (volume === null) warnings.push(`连线 ${raw?.from}→${raw?.to} 的体积读不出来，按 0 处理`)
    return {
      id: String(raw?.id ?? `${raw?.from}->${raw?.to}`),
      fromTubeId: String(raw?.from ?? ''),
      toTubeId: String(raw?.to ?? ''),
      volume: roundVolume(volume ?? 0, 6),
      volumeUnit: 'μL' as VolumeUnit
    }
  })

  // 原色值（每根管的 `color`）按成分名收回成一张表，往返后画布颜色不变
  const substanceColors: Record<string, string> = {}
  for (const raw of rawTubes) {
    const hex = typeof raw?.color === 'string' ? raw.color.trim() : ''
    if (!hex) continue
    const first = Array.isArray(raw?.substances) ? raw.substances[0] : undefined
    if (first?.name) substanceColors[String(first.name)] = hex
  }

  return {
    input: {
      id: project.id ? String(project.id) : undefined,
      name: String(project.name ?? ''),
      description: project.description ? String(project.description) : undefined,
      isWaste: project.isWaste === true ? true : undefined,
      date: String(project.date ?? ''),
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      completedAt: project.completedAt,
      defaultBuffer: project.defaultBuffer,
      tubes,
      connections,
      positions,
      substanceColors: Object.keys(substanceColors).length > 0 ? substanceColors : undefined
    },
    warnings
  }
}
