/**
 * 仓库正本（仓库.yml）的往返测试。
 */
import { describe, expect, it } from 'vitest'

import {
  parseWarehouseYml,
  toWarehouseYml,
  WAREHOUSE_FILE_VERSION,
  type WarehouseSnapshot
} from '../../src/core/store/warehouseFile'
import { fixtures } from '../helpers/fixtures'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!

function snapshot(): WarehouseSnapshot {
  return {
    reagents: ad52.warehouseTubes,
    groups: [
      {
        id: 'g1',
        name: '三角框架+HCR',
        color: '#22c55e',
        notes: '',
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z'
      } as any
    ]
  }
}

describe('仓库正本 —— 往返', () => {
  it('写出去再读回来，试剂数量/名称/浓度/体积不变', () => {
    const snap = snapshot()
    const text = toWarehouseYml(snap)
    const parsed = parseWarehouseYml(text)
    expect(parsed.warnings).toEqual([])
    expect(parsed.snapshot.reagents).toHaveLength(snap.reagents.length)
    expect(parsed.snapshot.groups).toHaveLength(1)
    const withSubs = snap.reagents.find(t => t.substances.some(s => s.concentration > 0))!
    const before = withSubs.substances.find(s => s.concentration > 0)!
    const afterTube = parsed.snapshot.reagents.find(t => t.id === withSubs.id)!
    const after = afterTube.substances.find(s => s.name === before.name)!
    expect(afterTube.type).toBe(withSubs.type)
    // 读回来统一归一化到 µM；1000 mM 的母液会变成 1000000 µM 这种，等值即可
    const factor = { nM: 0.001, 'μM': 1, mM: 1000, M: 1e6 } as Record<string, number>
    const expected = before.concentration * (factor[before.concentrationUnit] ?? 1)
    expect(after.concentration).toBeCloseTo(expected, 3)
  })

  it('往返两次文本完全一致（幂等）', () => {
    const text1 = toWarehouseYml(snapshot())
    const back = parseWarehouseYml(text1).snapshot
    const text2 = toWarehouseYml(back)
    expect(text2).toBe(text1)
  })

  it('文件头是 schemaVersion: 2', () => {
    expect(toWarehouseYml(snapshot())).toContain(`schemaVersion: ${WAREHOUSE_FILE_VERSION}`)
  })

  it('坏文件不抛异常，给出 warning', () => {
    const parsed = parseWarehouseYml('reagents:\n  - {}\n')
    expect(Array.isArray(parsed.snapshot.reagents)).toBe(true)
    expect(parsed.warnings.length).toBeGreaterThan(0)
  })
})
