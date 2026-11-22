/**
 * 回归（2026-11-23 真机）：结算时试管历史写入失败，整批 INSERT 被 sql.js 拒掉——
 *   [db:saveTubeHistories] Failed: Wrong API use : tried to bind a value of an unknown type (undefined).
 * 原因是 transferFrom / transferTo / transferVolume 这些可选项按 undefined 直接绑定。
 *
 * 这里锁 electron/sqlSafe.ts 的规范化：undefined → null、JSON 字段 → 字符串、
 * 缺 records 的历史条目当空数组（不抛错）。
 */
import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'

import {
  normalizeSqlRecord,
  normalizeExperimentInsert,
  normalizeExperimentRow,
  normalizeTubeHistories,
  normalizeTubeHistory,
  normalizeTubeInsert,
  normalizeTubeRow,
  toSqlJson,
  toSqlValue
} from '../../electron/sqlSafe'

describe('sqlSafe：入库前规范化（真机 undefined 绑定事故）', () => {
  it('记录里 undefined / null / 正常值 → null / null / 原值', () => {
    expect(normalizeSqlRecord({ a: undefined, b: null, c: 'x' })).toEqual({ a: null, b: null, c: 'x' })
  })

  it('数字保持数字，NaN / Infinity / 布尔 / 对象都不再是 undefined', () => {
    expect(toSqlValue(3.5)).toBe(3.5)
    expect(toSqlValue(Number.NaN)).toBeNull()
    expect(toSqlValue(Number.POSITIVE_INFINITY)).toBeNull()
    expect(toSqlValue(true)).toBe(1)
    expect(toSqlValue({})).toBeNull()
  })

  it('JSON 字段：undefined 也序列化成 "null" 字符串（JSON.stringify(undefined) 是 undefined）', () => {
    expect(toSqlJson(undefined)).toBe('null')
    expect(toSqlJson(null)).toBe('null')
    expect(toSqlJson([{ name: 'A', concentration: 1, concentrationUnit: 'μM' }])).toBe(
      '[{"name":"A","concentration":1,"concentrationUnit":"μM"}]'
    )
  })
})

describe('sqlSafe：试管历史条目容错', () => {
  it('没有 records 的条目 → 空数组，不抛错', () => {
    const out = normalizeTubeHistory({ tubeId: 't-1', tubeName: '试管1', tubeType: 'sample' })
    expect(out.records).toEqual([])
    expect(out.row.tubeId).toBe('t-1')
    expect(out.row.currentSubstances).toBe('null')
  })

  it('可选项缺失的明细行 → 全部 null，一行都不许留 undefined', () => {
    const out = normalizeTubeHistory({
      tubeId: 't-1',
      currentSubstances: [],
      records: [
        {
          id: 'r1',
          tubeId: 't-1',
          experimentId: 'exp-1',
          experimentName: '实验1',
          action: 'transfer_out',
          timestamp: '2026-11-23T00:00:00.000Z',
          volumeBefore: 200,
          volumeAfter: 100,
          volumeUnit: 'μL',
          substancesBefore: [],
          substancesAfter: []
          // transferFrom / transferTo / transferVolume 故意不写（真机就是这么来的）
        }
      ]
    })
    expect(out.records).toHaveLength(1)
    const record = out.records[0]
    expect(record.transferFrom).toBeNull()
    expect(record.transferTo).toBeNull()
    expect(record.transferVolume).toBeNull()
    for (const value of Object.values(record)) expect(value).not.toBeUndefined()
  })

  it('批量里混进 null / 非数组 → 丢掉脏条目，不炸整批', () => {
    expect(normalizeTubeHistories(undefined)).toEqual([])
    expect(normalizeTubeHistories([null, 42, { tubeId: 't-1' }])).toHaveLength(1)
  })
})

/**
 * 真数据库复现：sql.js 对 undefined 的态度。
 * 老写法（直接绑 record.transferFrom）必抛；规范化后整批写进去。
 */
describe('sqlSafe × sql.js：真机那条报错能被锁住', () => {
  const RECORD_SQL = `INSERT INTO tube_history_records (id, tube_id, experiment_id, experiment_name, action, timestamp, volume_before, volume_after, volume_unit, substances_before, substances_after, transfer_from, transfer_to, transfer_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

  async function makeDb() {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(`CREATE TABLE tube_histories (tube_id TEXT PRIMARY KEY, tube_name TEXT NOT NULL, tube_type TEXT NOT NULL, current_volume REAL, current_volume_unit TEXT, current_substances TEXT DEFAULT '[]')`)
    db.run(`CREATE TABLE tube_history_records (id TEXT PRIMARY KEY, tube_id TEXT NOT NULL, experiment_id TEXT, experiment_name TEXT, action TEXT NOT NULL, timestamp TEXT NOT NULL, volume_before REAL, volume_after REAL, volume_unit TEXT, substances_before TEXT DEFAULT '[]', substances_after TEXT DEFAULT '[]', transfer_from TEXT, transfer_to TEXT, transfer_volume REAL)`)
    return db
  }

  const drafts = () => ({
    tubeId: 't-1',
    tubeName: '试管1',
    tubeType: 'sample',
    currentVolume: 100,
    currentVolumeUnit: 'μL',
    currentSubstances: [],
    records: [
      {
        id: 'r1',
        tubeId: 't-1',
        experimentId: 'exp-1',
        experimentName: '结束实验',
        action: 'transfer_out',
        timestamp: '2026-11-23T00:00:00.000Z',
        volumeBefore: 200,
        volumeAfter: 100,
        volumeUnit: 'μL',
        substancesBefore: [],
        substancesAfter: [],
        transferFrom: undefined,
        transferTo: 'multiple',
        transferVolume: undefined
      }
    ]
  })

  it('老写法直接绑 undefined → 就是真机那条 Wrong API use', async () => {
    const db = await makeDb()
    const history = drafts()
    const record = history.records[0]
    expect(() =>
      db.run(RECORD_SQL, [record.id, history.tubeId, record.experimentId, record.experimentName, record.action, record.timestamp, record.volumeBefore, record.volumeAfter, record.volumeUnit, JSON.stringify(record.substancesBefore), JSON.stringify(record.substancesAfter), record.transferFrom, record.transferTo, record.transferVolume])
    ).toThrow(/unknown type/)
    db.close()
  })

  it('过一遍规范化 → 同一条历史写得进去，可选项落成 NULL', async () => {
    const db = await makeDb()
    const { row, records } = normalizeTubeHistory(drafts())
    db.run(`INSERT INTO tube_histories (tube_id, tube_name, tube_type, current_volume, current_volume_unit, current_substances) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.tubeId, row.tubeName, row.tubeType, row.currentVolume, row.currentVolumeUnit, row.currentSubstances])
    for (const record of records) {
      db.run(RECORD_SQL, [record.id, record.tubeId, record.experimentId, record.experimentName, record.action, record.timestamp, record.volumeBefore, record.volumeAfter, record.volumeUnit, record.substancesBefore, record.substancesAfter, record.transferFrom, record.transferTo, record.transferVolume])
    }
    const rows = db.exec(`SELECT transfer_from, transfer_to, transfer_volume, substances_after FROM tube_history_records`)
    expect(rows[0].values).toEqual([[null, 'multiple', null, '[]']])
    db.close()
  })
})

/**
 * 第二批：试管 / 实验正表。
 * 这三句以前也裸绑 undefined（db:addTube / db:updateTube / db:saveExperiment），
 * 而且都排在两个正本文件落地之后——抛一次就是「文件改了、界面报结束实验失败」。
 */
describe('sqlSafe × sql.js：试管/实验正表不再被 undefined 搞崩', () => {
  const ADD_TUBE_SQL = `INSERT INTO tubes (id, name, type, total_volume, total_volume_unit, remaining_volume, remaining_volume_unit, substances, created_at, updated_at, status, storage_location, storage_condition, notes, tags, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  const UPDATE_TUBE_SQL = `UPDATE tubes SET
       name = COALESCE(?, name), type = COALESCE(?, type),
       total_volume = COALESCE(?, total_volume), total_volume_unit = COALESCE(?, total_volume_unit),
       remaining_volume = COALESCE(?, remaining_volume), remaining_volume_unit = COALESCE(?, remaining_volume_unit),
       substances = COALESCE(?, substances), updated_at = COALESCE(?, updated_at),
       status = COALESCE(?, status),
       storage_location = ?, storage_condition = ?, notes = ?, tags = ?, group_id = ?
     WHERE id = ?`
  const INSERT_EXP_SQL = `INSERT INTO experiments (id, name, description, created_at, updated_at, completed_at, status, tubes, tube_positions, connections, warehouse_snapshot, initial_state_tubes, end_state_tubes, is_waste) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

  async function makeDb() {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(`CREATE TABLE tubes (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, total_volume REAL NOT NULL, total_volume_unit TEXT NOT NULL, remaining_volume REAL NOT NULL, remaining_volume_unit TEXT NOT NULL, substances TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', storage_location TEXT, storage_condition TEXT, notes TEXT, tags TEXT, group_id TEXT)`)
    db.run(`CREATE TABLE experiments (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL DEFAULT 'draft', tubes TEXT NOT NULL, tube_positions TEXT, connections TEXT NOT NULL, warehouse_snapshot TEXT, initial_state_tubes TEXT, end_state_tubes TEXT, is_waste INTEGER DEFAULT 0)`)
    return db
  }

  const one = (db: any, sql: string, params: any[] = []) => db.exec(sql, params)[0]?.values?.[0]

  it('addTube：可选字段全 undefined → 不抛错，可空列落 NULL、tags 落 "[]"', async () => {
    const db = await makeDb()
    const row = normalizeTubeInsert({
      id: 't1', name: '试管A', type: 'sample',
      totalVolume: 100, totalVolumeUnit: 'μL', remainingVolume: 100, remainingVolumeUnit: 'μL',
      substances: undefined, createdAt: undefined, updatedAt: undefined, status: undefined,
      storageLocation: undefined, storageCondition: undefined, notes: undefined, tags: undefined, groupId: undefined
    })
    expect(Object.values(row)).not.toContain(undefined)
    db.run(ADD_TUBE_SQL, [row.id, row.name, row.type, row.totalVolume, row.totalVolumeUnit, row.remainingVolume, row.remainingVolumeUnit, row.substances, row.createdAt, row.updatedAt, row.status, row.storageLocation, row.storageCondition, row.notes, row.tags, row.groupId])
    expect(one(db, `SELECT name, status, substances, tags, notes, storage_location, group_id, created_at FROM tubes WHERE id = 't1'`))
      .toEqual(['试管A', 'active', '[]', '[]', null, null, null, row.createdAt])
    db.close()
  })

  it('addTube：老写法（裸绑 undefined）仍然会炸 —— 锁住修复前后的差别', async () => {
    const db = await makeDb()
    expect(() => db.run(ADD_TUBE_SQL, ['t2', '试管B', 'sample', 100, 'μL', 100, 'μL', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined])).toThrow(/unknown type/)
    db.close()
  })

  it('updateTube：只传 id（其余全 undefined）→ 不抛错，不可空列保留原值、可空列落 NULL', async () => {
    const db = await makeDb()
    const base = normalizeTubeInsert({ id: 't1', name: '试管A', type: 'sample', totalVolume: 100, totalVolumeUnit: 'μL', remainingVolume: 100, remainingVolumeUnit: 'μL', substances: [{ name: 'A', concentration: 1, concentrationUnit: 'nM' }], status: 'active', notes: '旧备注', tags: ['x'], groupId: 'g1' })
    db.run(ADD_TUBE_SQL, [base.id, base.name, base.type, base.totalVolume, base.totalVolumeUnit, base.remainingVolume, base.remainingVolumeUnit, base.substances, base.createdAt, base.updatedAt, base.status, base.storageLocation, base.storageCondition, base.notes, base.tags, base.groupId])

    const row = normalizeTubeRow({ id: 't1' })
    expect(() => db.run(UPDATE_TUBE_SQL, [row.name, row.type, row.totalVolume, row.totalVolumeUnit, row.remainingVolume, row.remainingVolumeUnit, row.substances, row.updatedAt, row.status, row.storageLocation, row.storageCondition, row.notes, row.tags, row.groupId, row.id])).not.toThrow()
    expect(one(db, `SELECT name, status, remaining_volume, notes, tags, group_id FROM tubes WHERE id = 't1'`))
      .toEqual(['试管A', 'active', 100, null, null, null])
    db.close()
  })

  it('saveExperiment：缺 createdAt / updatedAt / status / tubes 也不抛错，兜底成 now / draft / "[]"', async () => {
    const db = await makeDb()
    const row = normalizeExperimentInsert({ id: 'e1', name: '结束实验' })
    expect(Object.values(row)).not.toContain(undefined)
    expect(() => db.run(INSERT_EXP_SQL, [row.id, row.name, row.description, row.createdAt, row.updatedAt, row.completedAt, row.status, row.tubes, row.tubePositions, row.connections, row.warehouseSnapshot, row.initialStateTubes, row.endStateTubes, row.isWaste])).not.toThrow()
    const [name, status, tubes, connections, snapshot, isWaste] = one(db, `SELECT name, status, tubes, connections, warehouse_snapshot, is_waste FROM experiments WHERE id = 'e1'`) as any[]
    expect([name, status, tubes, connections, snapshot, isWaste]).toEqual(['结束实验', 'draft', '[]', '[]', null, 0])
    db.close()
  })
})
