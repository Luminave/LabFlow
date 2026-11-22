/**
 * 仓库正本文件：`仓库.yml`
 *
 * 全库一份：分组 + 试剂（名称 / 浓度+单位 / 体积+单位 / 余量 / 批号 / 开封日 / 分组）。
 * 与工程文件一样，这里只做纯数据的「Tube/Group ⇄ yml 文本」，文件读写归主进程。
 */

import yaml from 'js-yaml'

import type { ConcentrationUnit, SubstanceColor, Tube, TubeGroup, TubeType, VolumeUnit } from '../schema'
import { formatQuantityExact, normalizeConcentration, parseQuantity, roundVolume } from '../units'

/** 仓库文件格式版本（与工程文件同步推进；1 = 第 1 步只有工程文件，没有仓库文件） */
export const WAREHOUSE_FILE_VERSION = 2

export interface WarehouseSnapshot {
  groups: TubeGroup[]
  reagents: Tube[]
  substanceColors?: SubstanceColor[]
}

interface ReagentDoc {
  id: string
  name: string
  type: TubeType
  substances?: { name: string; concentration: string }[]
  totalVolume: string
  remainingVolume: string
  /** 批号 */
  lotNumber?: string
  /** 开封日 YYYY-MM-DD */
  openedAt?: string
  groupId?: string
  status?: string
  storageLocation?: string
  storageCondition?: string
  notes?: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

interface GroupDoc {
  id: string
  name: string
  color?: string
  notes?: string
  hidden?: boolean
}

/** 生成 `仓库.yml` 文本 */
export function toWarehouseYml(snapshot: WarehouseSnapshot): string {
  const groups: GroupDoc[] = snapshot.groups.map(group => stripUndefined({
    id: group.id,
    name: group.name,
    color: group.color || undefined,
    notes: group.notes || undefined,
    hidden: group.hidden ? true : undefined
  }))

  const reagents: ReagentDoc[] = snapshot.reagents.map(tube => stripUndefined({
    id: tube.id,
    name: tube.name,
    type: tube.type,
    substances: tube.substances && tube.substances.length > 0
      ? tube.substances.map(sub => ({
          name: sub.name,
          concentration: formatQuantityExact(
            normalizeConcentration(sub.concentration, sub.concentrationUnit),
            'concentration'
          )
        }))
      : undefined,
    totalVolume: quantityOrZero(tube.totalVolume, 'volume'),
    remainingVolume: quantityOrZero(tube.remainingVolume, 'volume'),
    lotNumber: tube.lotNumber || undefined,
    openedAt: tube.openedAt || undefined,
    groupId: tube.groupId,
    status: tube.status && tube.status !== 'active' ? tube.status : undefined,
    storageLocation: tube.storageLocation,
    storageCondition: tube.storageCondition,
    notes: tube.notes,
    tags: tube.tags && tube.tags.length > 0 ? tube.tags : undefined,
    createdAt: tube.createdAt || undefined,
    updatedAt: tube.updatedAt || undefined
  }))

  const doc: Record<string, unknown> = {
    schemaVersion: WAREHOUSE_FILE_VERSION,
    groups,
    reagents
  }
  if (snapshot.substanceColors && snapshot.substanceColors.length > 0) {
    doc.substanceColors = snapshot.substanceColors.map(color => ({
      name: color.name,
      color: color.color,
      bgColor: color.bgColor
    }))
  }

  const body = yaml
    .dump(doc, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false, skipInvalid: true })
    // js-yaml 把 y 键当 YAML 1.1 布尔加引号，这里还原（与工程文件同一处理）
    .replace(/^(\s*)'y': /gm, '$1y: ')

  return [
    '# LabFlow 仓库文件（试剂与分组的真相源）',
    '# 数值写法：`<数值> <单位>`；载入时归一化回 µM / µL',
    `# 格式版本：${WAREHOUSE_FILE_VERSION}`,
    body.trimEnd(),
    ''
  ].join('\n')
}

/** 读 `仓库.yml`；不抛异常，坏掉时返回 warnings 让调用方提示 */
export function parseWarehouseYml(text: string): { snapshot: WarehouseSnapshot; warnings: string[] } {
  const warnings: string[] = []
  const empty: WarehouseSnapshot = { groups: [], reagents: [] }

  let doc: any
  try {
    doc = yaml.load(text)
  } catch (error) {
    return { snapshot: empty, warnings: [`YAML 解析失败：${(error as Error).message}`] }
  }
  if (!doc || typeof doc !== 'object') {
    return { snapshot: empty, warnings: ['文件内容不是 YAML 映射'] }
  }
  if (Number(doc.schemaVersion) !== WAREHOUSE_FILE_VERSION) {
    warnings.push(`仓库文件 schemaVersion 是 ${doc.schemaVersion}，当前程序支持 ${WAREHOUSE_FILE_VERSION}`)
  }

  const groups: TubeGroup[] = (Array.isArray(doc.groups) ? doc.groups : []).map((raw: any) => ({
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? '未命名分组'),
    color: String(raw?.color ?? ''),
    notes: String(raw?.notes ?? ''),
    hidden: raw?.hidden === true,
    createdAt: String(raw?.createdAt ?? '')
  }))

  const reagents: Tube[] = (Array.isArray(doc.reagents) ? doc.reagents : []).map((raw: any) => {
    const substances = Array.isArray(raw?.substances)
      ? raw.substances.map((sub: any) => {
          const concentration = readQuantity(sub?.concentration, 'concentration')
          if (concentration === null) warnings.push(`试剂 ${raw?.name} 的浓度读不出来，按 0 处理`)
          return {
            name: String(sub?.name ?? ''),
            concentration: roundVolume(concentration ?? 0, 6),
            concentrationUnit: 'μM' as ConcentrationUnit
          }
        })
      : []

    return {
      id: String(raw?.id ?? ''),
      name: String(raw?.name ?? raw?.id ?? '未命名试剂'),
      type: (raw?.type as TubeType) || 'source',
      totalVolume: roundVolume(readQuantity(raw?.totalVolume, 'volume') ?? 0, 6),
      totalVolumeUnit: 'μL' as VolumeUnit,
      remainingVolume: roundVolume(readQuantity(raw?.remainingVolume, 'volume') ?? 0, 6),
      remainingVolumeUnit: 'μL' as VolumeUnit,
      substances,
      groupId: raw?.groupId ? String(raw.groupId) : undefined,
      status: (raw?.status === 'depleted' || raw?.status === 'discarded' ? raw.status : 'active') as Tube['status'],
      storageLocation: raw?.storageLocation ? String(raw.storageLocation) : undefined,
      storageCondition: raw?.storageCondition ? String(raw.storageCondition) : undefined,
      notes: raw?.notes ? String(raw.notes) : undefined,
      tags: Array.isArray(raw?.tags) && raw.tags.length > 0 ? raw.tags.map((t: unknown) => String(t)) : undefined,
      createdAt: String(raw?.createdAt ?? ''),
      updatedAt: String(raw?.updatedAt ?? '')
    } as Tube
  })

  const substanceColors: SubstanceColor[] = Array.isArray(doc.substanceColors)
    ? doc.substanceColors.map((raw: any) => ({
        name: String(raw?.name ?? ''),
        color: String(raw?.color ?? ''),
        bgColor: String(raw?.bgColor ?? '')
      }))
    : []

  return {
    snapshot: { groups, reagents, substanceColors: substanceColors.length > 0 ? substanceColors : undefined },
    warnings
  }
}

function quantityOrZero(value: number | null | undefined, kind: 'concentration' | 'volume'): string {
  return formatQuantityExact(Number.isFinite(value as number) ? (value as number) : 0, kind)
}

function readQuantity(value: unknown, kind: 'concentration' | 'volume'): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return parseQuantity(value, kind)
  return null
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined && val !== null) out[key] = val
  }
  return out as T
}
