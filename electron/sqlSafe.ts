/**
 * sql.js 绑定参数的兜底规范化。
 *
 * 事故（2026-11-23 真机点「结束实验」）：
 *   [db:saveTubeHistories] Failed: Wrong API use : tried to bind a value of an unknown type (undefined).
 * 试管历史里的 transferFrom / transferTo / transferVolume 本来就是可选项，
 * 界面按 undefined 传过来；sql.js 见到 undefined 直接抛错，整批历史回滚，
 * 结算因此被报成「结束实验失败」（其实仓库.yml 和工程.yml 都已经写好了）。
 *
 * 规矩：**入库前一律过一遍本文件**——undefined/null/NaN/Infinity → null，
 * JSON 字段（substances*）→ 字符串（undefined 序列化成 'null'），
 * 缺 records 的历史条目当空数组处理。
 */

/** sql.js 能绑的值 */
export type SqlValue = string | number | null

/** 单个值 → 可绑定值 */
export function toSqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  // 对象/数组不该直接进绑定位置（该字段应走 toSqlJson）
  return null
}

/** JSON 字段 → 字符串；JSON.stringify(undefined) 是 undefined（不能绑），统一成 'null' */
export function toSqlJson(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : 'null'
  } catch {
    return 'null'
  }
}

/**
 * 一条记录的所有字段逐个规范化：{a: undefined, b: null, c: 'x'} → {a: null, b: null, c: 'x'}
 */
export function normalizeSqlRecord(record: Record<string, unknown> | null | undefined): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {}
  if (!record || typeof record !== 'object') return out
  for (const [key, value] of Object.entries(record)) out[key] = toSqlValue(value)
  return out
}

/** 一条试管历史 → { 主表行, 明细行[] }，字段名与 INSERT 的列一一对应 */
export interface NormalizedTubeHistory {
  row: Record<string, SqlValue>
  records: Array<Record<string, SqlValue>>
}

export function normalizeTubeHistory(history: any): NormalizedTubeHistory {
  const h = history && typeof history === 'object' ? history : {}
  const rawRecords: unknown[] = Array.isArray(h.records) ? h.records : []
  const records = rawRecords
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(record =>
      normalizeSqlRecord({
        id: record.id,
        tubeId: record.tubeId ?? h.tubeId,
        experimentId: record.experimentId,
        experimentName: record.experimentName,
        action: record.action,
        timestamp: record.timestamp,
        volumeBefore: record.volumeBefore,
        volumeAfter: record.volumeAfter,
        volumeUnit: record.volumeUnit,
        substancesBefore: toSqlJson(record.substancesBefore),
        substancesAfter: toSqlJson(record.substancesAfter),
        transferFrom: record.transferFrom,
        transferTo: record.transferTo,
        transferVolume: record.transferVolume
      })
    )

  return {
    row: normalizeSqlRecord({
      tubeId: h.tubeId,
      tubeName: h.tubeName,
      tubeType: h.tubeType,
      currentVolume: h.currentVolume,
      currentVolumeUnit: h.currentVolumeUnit,
      currentSubstances: toSqlJson(h.currentSubstances)
    }),
    records
  }
}

/** 批量版本；非对象条目直接丢弃（不让一条脏数据毁掉整批） */
export function normalizeTubeHistories(histories: unknown): NormalizedTubeHistory[] {
  if (!Array.isArray(histories)) return []
  return histories
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map(normalizeTubeHistory)
}

// ---------------------------------------------------------------------------
// 试管 / 实验正表的兜底规范化（2026-11-23 第二批）
//
// 同一个病：db:addTube / db:updateTube / db:saveExperiment 以前也把 tube.status、
// JSON.stringify(tube.substances)、created_at 这些直接绑给 sql.js。undefined 一出现
// 就整句抛错，而这三步都排在「仓库.yml / 工程.yml 已经写好」之后——界面报「结束实验
// 失败」，文件其实改了，用户不敢重试（重试会二次扣试剂）。
//
// 分两层，别混用：
//   normalizeTubeRow / normalizeExperimentRow —— 只把 undefined 抹成 NULL，**不编造值**。
//     给 UPDATE 用：配 SQL 里的 COALESCE(?, 列)，缺字段＝保留原值，可空列照常落 NULL。
//   normalizeTubeInsert / normalizeExperimentInsert —— 在上一层之上给 NOT NULL 列兜底，
//     给 INSERT 用：新记录缺 createdAt/status/tubes 也能写进去（now / 'active' / '[]'）。
// ---------------------------------------------------------------------------

/** 可空 JSON 列：undefined/null → NULL（不要 'null' 字符串） */
export function toSqlJsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return toSqlJson(value)
}

const nowIso = (): string => new Date().toISOString()

/** UPDATE 用：undefined 一律 → NULL，靠 SQL 的 COALESCE 保留原值 */
export function normalizeTubeRow(tube: any): Record<string, SqlValue> {
  const t = tube && typeof tube === 'object' ? tube : {}
  return {
    id: toSqlValue(t.id),
    name: toSqlValue(t.name),
    type: toSqlValue(t.type),
    totalVolume: toSqlValue(t.totalVolume),
    totalVolumeUnit: toSqlValue(t.totalVolumeUnit),
    remainingVolume: toSqlValue(t.remainingVolume),
    remainingVolumeUnit: toSqlValue(t.remainingVolumeUnit),
    substances: toSqlJsonOrNull(t.substances),
    createdAt: toSqlValue(t.createdAt),
    updatedAt: toSqlValue(t.updatedAt),
    status: toSqlValue(t.status),
    storageLocation: toSqlValue(t.storageLocation),
    storageCondition: toSqlValue(t.storageCondition),
    notes: toSqlValue(t.notes),
    tags: toSqlJsonOrNull(t.tags),
    groupId: toSqlValue(t.groupId)
  }
}

/** INSERT 用：NOT NULL 列缺字段就兜底（时间戳用当前时间，status 'active'） */
export function normalizeTubeInsert(tube: any): Record<string, SqlValue> {
  const t = tube && typeof tube === 'object' ? tube : {}
  const row = normalizeTubeRow(t)
  const now = nowIso()
  return {
    ...row,
    name: row.name ?? '',
    type: row.type ?? '',
    totalVolume: row.totalVolume ?? 0,
    totalVolumeUnit: row.totalVolumeUnit ?? '',
    remainingVolume: row.remainingVolume ?? 0,
    remainingVolumeUnit: row.remainingVolumeUnit ?? '',
    substances: row.substances ?? '[]',
    createdAt: row.createdAt ?? now,
    updatedAt: row.updatedAt ?? now,
    status: row.status ?? 'active',
    tags: row.tags ?? '[]'
  }
}

/** UPDATE 用：同 tube，undefined → NULL（配 COALESCE） */
export function normalizeExperimentRow(exp: any): Record<string, SqlValue> {
  const e = exp && typeof exp === 'object' ? exp : {}
  return {
    id: toSqlValue(e.id),
    name: toSqlValue(e.name),
    description: toSqlValue(e.description),
    createdAt: toSqlValue(e.created_at ?? e.createdAt),
    updatedAt: toSqlValue(e.updated_at ?? e.updatedAt),
    completedAt: toSqlValue(e.completed_at ?? e.completedAt),
    status: toSqlValue(e.status),
    tubes: toSqlJsonOrNull(e.tubes),
    tubePositions: toSqlJsonOrNull(e.tube_positions ?? e.tubePositions),
    connections: toSqlJsonOrNull(e.connections),
    warehouseSnapshot: toSqlJsonOrNull(e.warehouse_snapshot ?? e.warehouseSnapshot),
    initialStateTubes: toSqlJsonOrNull(e.initial_state_tubes ?? e.initialStateTubes),
    endStateTubes: toSqlJsonOrNull(e.end_state_tubes ?? e.endStateTubes),
    isWaste: e.is_waste || e.isWaste ? 1 : 0
  }
}

/** INSERT 用：NOT NULL 列兜底（status 'draft'，tubes/connections '[]'） */
export function normalizeExperimentInsert(exp: any): Record<string, SqlValue> {
  const e = exp && typeof exp === 'object' ? exp : {}
  const row = normalizeExperimentRow(e)
  const now = nowIso()
  return {
    ...row,
    name: row.name ?? '',
    createdAt: row.createdAt ?? now,
    updatedAt: row.updatedAt ?? now,
    status: row.status ?? 'draft',
    tubes: row.tubes ?? '[]',
    tubePositions: row.tubePositions ?? '[]',
    connections: row.connections ?? '[]'
  }
}
