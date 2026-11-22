/**
 * 第 1 步两条主路径的回归测试：
 * 1. 启动阶段**只读不写**（文件存在时一次都不许写）。
 * 2. 写 仓库.yml 之前有**截断护栏**（39 → 13 这种拒绝）。
 */
import { describe, expect, it, vi } from 'vitest'

import { bootstrapWarehouseFile } from '../../src/renderer/src/utils/warehouseSync'
import { saveWarehouseFile, warehouseTruncationGuard } from '../../src/renderer/src/utils/warehouseSource'
import { parseWarehouseYml, toWarehouseYml } from '../../src/core/store/warehouseFile'
import type { Tube } from '../../src/shared/types'
import { fixtures } from '../helpers/fixtures'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!
const reagents = ad52.warehouseTubes as Tube[]

function fakeFile(count: number) {
  return toWarehouseYml({ reagents: reagents.slice(0, count), groups: [] })
}

describe('启动序列：文件存在时只读不写', () => {
  it('文件存在 → 用文件覆盖内存，写盘函数一次都不调用', async () => {
    const saveFile = vi.fn(async () => true)
    const applyTubes = vi.fn()
    const applyGroups = vi.fn()

    const plan = await bootstrapWarehouseFile({
      loadFile: async () => ({ state: 'ok' as const, snapshot: { reagents, groups: [] }, warnings: [] }),
      saveFile,
      currentSnapshot: () => ({ reagents: [], groups: [] }),
      applyTubes,
      applyGroups,
      log: () => {}
    })

    expect(plan).toBe('used-file')
    expect(saveFile).toHaveBeenCalledTimes(0)
    expect(applyTubes).toHaveBeenCalledTimes(1)
    expect(applyTubes.mock.calls[0][0]).toHaveLength(reagents.length)
  })

  it('文件不存在 → 才由数据库生成一次', async () => {
    const saveFile = vi.fn(async () => true)
    const plan = await bootstrapWarehouseFile({
      loadFile: async () => ({ state: 'missing' as const, warnings: [] }),
      saveFile,
      currentSnapshot: () => ({ reagents, groups: [] }),
      applyTubes: () => {},
      applyGroups: () => {},
      log: () => {}
    })

    expect(plan).toBe('generated')
    expect(saveFile).toHaveBeenCalledTimes(1)
  })

  it('文件存在但内容为空（0 试剂 0 分组）→ 按「没有文件」处理', async () => {
    const saveFile = vi.fn(async () => true)
    const plan = await bootstrapWarehouseFile({
      loadFile: async () => ({ state: 'missing' as const, text: '', warnings: [] }),
      saveFile,
      currentSnapshot: () => ({ reagents, groups: [] }),
      applyTubes: () => {},
      applyGroups: () => {},
      log: () => {}
    })
    expect(plan).toBe('generated')
    expect(saveFile).toHaveBeenCalledTimes(1)
  })
})

describe('截断护栏：试剂条数不许变少', () => {
  it('新内容比现有文件少 → 拒绝写，并说明从几条降到几条', async () => {
    const writeWarehouse = vi.fn(async () => ({ ok: true, path: 'D:/x/仓库.yml' }))
    ;(globalThis as any).window = {
      electronAPI: {
        dataRoot: {
          readWarehouse: async () => ({ ok: true, content: fakeFile(39) }),
          writeWarehouse
        },
        getTubes: async () => new Array(39).fill({})
      }
    }

    const refusal = await warehouseTruncationGuard(13)
    expect(refusal).toContain('39')
    expect(refusal).toContain('13')

    const ok = await saveWarehouseFile({ reagents: reagents.slice(0, 13), groups: [] })
    expect(ok).toBe(false)
    expect(writeWarehouse).toHaveBeenCalledTimes(0)
  })

  it('新内容不少于现有文件时正常写', async () => {
    const writeWarehouse = vi.fn(async () => ({ ok: true, path: 'D:/x/仓库.yml' }))
    ;(globalThis as any).window = {
      electronAPI: {
        dataRoot: {
          readWarehouse: async () => ({ ok: true, content: fakeFile(13) }),
          writeWarehouse
        },
        getTubes: async () => new Array(13).fill({})
      }
    }
    const ok = await saveWarehouseFile({ reagents: reagents.slice(0, 13), groups: [] })
    expect(ok).toBe(true)
    expect(writeWarehouse).toHaveBeenCalledTimes(1)
  })
})

describe('仓库文件本身读得回来', () => {
  it('39 条写出去再读回来还是 39 条（不会被序列化悄悄合并）', () => {
    const parsed = parseWarehouseYml(toWarehouseYml({ reagents, groups: [] }))
    expect(parsed.warnings).toEqual([])
    expect(parsed.snapshot.reagents).toHaveLength(reagents.length)
  })
})
