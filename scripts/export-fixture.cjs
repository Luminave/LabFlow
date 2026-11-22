/**
 * 从本机 LabFlow 数据库的**只读副本**导出真实工程 fixture（tests/fixtures/*.json）。
 * 用法：node scripts/export-fixture.cjs
 * 前置：先把 %APPDATA%\LabFlow\data\labflow.db 复制到 SRC 指定的临时路径（绝不直接读写原始库）。
 */
const fs = require('fs')
const path = require('path')
const initSqlJs = require('D:/project/LabFlow/node_modules/sql.js/dist/sql-wasm.js')

const SRC = 'D:/tmp/lf_fixture/labflow_copy.db'
const OUT = 'D:/project/LabFlow/tests/fixtures'

function P(v) {
  let cur = v
  for (let i = 0; i < 5; i++) {
    if (typeof cur !== 'string') return cur
    try { cur = JSON.parse(cur) } catch { return cur }
  }
  return cur
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '')

;(async () => {
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(SRC))
  const expRows = db.exec('SELECT * FROM experiments')
  const cols = expRows[0].columns
  const rows = expRows[0].values.map(v => Object.fromEntries(v.map((x, i) => [cols[i], x])))
  const tubeRows = db.exec('SELECT * FROM tubes')
  const tcols = tubeRows[0].columns
  const warehouse = tubeRows[0].values.map(v => Object.fromEntries(v.map((x, i) => [tcols[i], x])))

  const whTubes = warehouse.map(t => ({
    id: t.id,
    name: t.name,
    type: t.type,
    totalVolume: t.total_volume,
    totalVolumeUnit: t.total_volume_unit,
    remainingVolume: t.remaining_volume,
    remainingVolumeUnit: t.remaining_volume_unit,
    substances: P(t.substances) || [],
    status: t.status,
    createdAt: t.created_at,
    updatedAt: t.updated_at
  }))

  const manifest = []
  for (const r of rows) {
    const tubes = P(r.tubes) || []
    const positions = P(r.tube_positions) || []
    const connections = P(r.connections) || []
    const initial = r.initial_state_tubes ? P(r.initial_state_tubes) : null
    const fixture = {
      _comment: 'LabFlow 真实工程只读导出（原始 db 未修改）。由 scripts fixture-export 生成。',
      source: { database: 'C:/Users/27133/AppData/Roaming/LabFlow/data/labflow.db (read-only copy) ', exportedAt: '2026-11-22', rowId: r.id },
      experiment: {
        id: r.id,
        name: r.name,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        defaultBuffer: r.default_buffer === undefined ? undefined : r.default_buffer,
        tubes,
        tubePositions: positions,
        connections,
        initialStateTubes: initial
      },
      warehouseTubes: whTubes
    }
    const name = slug(r.name) || r.id
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(fixture, null, 2))
    manifest.push({ name, file: name + '.json', tubes: tubes.length, connections: connections.length, units: [...new Set(tubes.flatMap(t => (t.substances || []).map(s => s.concentrationUnit)))] })
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify(manifest, null, 2))
})()
