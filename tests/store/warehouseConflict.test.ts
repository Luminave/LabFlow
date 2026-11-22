/**
 * 缺陷 2 / 5 / 6：仓库正本的三条边界
 * - 2：文件存在但解析失败 → 只读内存、绝不写回，另存 `.broken-<时间戳>.yml` 留证 + 提示
 * - 5：写盘带 expect，外部改过 → 不写、重读文件、更新内存、提示「已重新载入」
 * - 6：减少必须来自显式删除动作（传 explicitDelete），删完重启不复活
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseWarehouseYml, toWarehouseYml, type WarehouseSnapshot } from '../../src/core/store/warehouseFile'
import type { Tube } from '../../src/shared/types'
import { useWarehouseStore } from '../../src/renderer/src/stores/warehouseStore'
import {
  loadWarehouseFile,
  resetWarehouseFileStat,
  saveWarehouseFile,
  warehouseFileStatSnapshot
} from '../../src/renderer/src/utils/warehouseSource'
import { bootstrapWarehouseFile, writeWarehouseNow } from '../../src/renderer/src/utils/warehouseSync'

function reagent(index: number, id = `r-${index}`): Tube {
  return {
    id,
    name: `试剂${index}`,
    type: 'source',
    totalVolume: 500,
    totalVolumeUnit: 'μL',
    remainingVolume: 500,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  }
}

const REAGENTS = Array.from({ length: 39 }, (_, index) => reagent(index + 1))

interface FakeWarehouseFs {
  content: string
  mtimeMs: number
  size: number
  /** 真正写进去的份数（冲突/拒绝时为 0） */
  writes: string[]
}

interface FakeApi {
  fs: FakeWarehouseFs
  toasts: string[]
  backups: string[]
  getTubes: ReturnType<typeof vi.fn>
}

/** 用内存字符串模拟 仓库.yml + 主进程的 expect 冲突检测（与 electron/main.ts 同规则） */
function installFakeApi(initialContent: string | null, dbRows: unknown[] = []): FakeApi {
  const fs: FakeWarehouseFs = {
    content: initialContent ?? '',
    mtimeMs: initialContent ? 1000 : 0,
    size: initialContent?.length ?? 0,
    writes: []
  }
  const toasts: string[] = []
  const backups: string[] = []

  const readWarehouse = vi.fn(async () => {
    if (!fs.content) return { ok: false as const, reason: 'not-found' as const }
    return { ok: true as const, path: 'D:/x/仓库.yml', content: fs.content, stat: { mtimeMs: fs.mtimeMs, size: fs.size } }
  })
  const writeWarehouse = vi.fn(
    async (payload: { content: string; expect?: { mtimeMs: number; size: number } | null }) => {
      const expect = payload.expect
      if (expect && (Math.abs(expect.mtimeMs - fs.mtimeMs) > 1 || expect.size !== fs.size)) {
        return { ok: false as const, conflict: true as const, stat: { mtimeMs: fs.mtimeMs, size: fs.size } }
      }
      fs.content = payload.content
      fs.mtimeMs += 10
      fs.size = payload.content.length
      fs.writes.push(payload.content)
      return { ok: true as const, path: 'D:/x/仓库.yml', stat: { mtimeMs: fs.mtimeMs, size: fs.size } }
    }
  )
  const backupWarehouse = vi.fn(async (payload: { content: string }) => {
    backups.push(payload.content)
    return { ok: true as const, path: 'D:/x/仓库.broken-1.yml', fileName: '仓库.broken-1.yml' }
  })
  const getTubes = vi.fn(async () => dbRows)

  const globalAny = globalThis as Record<string, unknown>
  if (typeof globalAny.CustomEvent !== 'function') {
    globalAny.CustomEvent = class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    }
  }

  globalAny.window = {
    electronAPI: {
      dataRoot: { readWarehouse, writeWarehouse, backupWarehouse },
      getTubes
    },
    dispatchEvent: (event: { type?: string; detail?: { text?: string } }) => {
      if (event?.type === 'labflow:global-toast') toasts.push(event.detail?.text ?? '')
      return true
    }
  }

  return { fs, toasts, backups, getTubes }
}

function fileReagents(content: string): Tube[] {
  return parseWarehouseYml(content).snapshot.reagents
}

beforeEach(() => {
  resetWarehouseFileStat()
  useWarehouseStore.setState({ tubes: [] })
})

describe('仓库正本：外部修改冲突（缺陷 5）', () => {
  it('外部改过文件 → 不写、重读文件覆盖内存、提示「已重新载入」', async () => {
    const api = installFakeApi(toWarehouseYml({ reagents: REAGENTS, groups: [] }))
    const loaded = await loadWarehouseFile()
    expect(loaded.state).toBe('ok')
    expect(warehouseFileStatSnapshot()).toEqual({ mtimeMs: 1000, size: api.fs.size })

    // 界面内存里多了一根试剂，准备写盘；此时文件被别的编辑器改过
    useWarehouseStore.setState({ tubes: [...REAGENTS, reagent(99, 'r-99')] })
    api.fs.content = `${api.fs.content}\n# 外部编辑器改了一行\n`
    api.fs.mtimeMs += 5000
    api.fs.size = api.fs.content.length

    const result = await writeWarehouseNow()

    expect(result).toMatchObject({ ok: false, conflict: true })
    expect(api.fs.writes).toHaveLength(0) // 一个字都没写
    expect(api.toasts.join('\n')).toContain('仓库文件已被外部修改，已重新载入')
    // 内存按文件重载：多出来的 r-99 被文件内容顶掉
    const memoryIds = useWarehouseStore.getState().tubes.map(tube => tube.id)
    expect(memoryIds).toEqual(REAGENTS.map(tube => tube.id))
  })
})

describe('仓库正本：坏文件只读不写（缺陷 2）', () => {
  const BROKEN = 'reagents: [ 这不是: [合法的 yaml'

  it('解析失败 → state:broken，原文保留', async () => {
    installFakeApi(BROKEN)
    const loaded = await loadWarehouseFile()
    expect(loaded.state).toBe('broken')
    expect(loaded.text).toBe(BROKEN)
    expect(loaded.warnings.join('；')).toContain('YAML 解析失败')
    expect(loaded.snapshot).toBeUndefined()
  })

  it('bootstrap 遇坏文件：不写回、不覆盖内存、备份留证、给提示', async () => {
    const api = installFakeApi(BROKEN)
    const saveFile = vi.fn(async () => true)
    const applyTubes = vi.fn()
    const applyGroups = vi.fn()
    const notify = vi.fn()

    const plan = await bootstrapWarehouseFile({
      loadFile: loadWarehouseFile,
      saveFile,
      currentSnapshot: () => ({ reagents: REAGENTS, groups: [] }),
      applyTubes,
      applyGroups,
      backupFile: async text => {
        await (globalThis as any).window.electronAPI.dataRoot.backupWarehouse({ content: text })
        return '仓库.broken-1.yml'
      },
      notify
    })

    expect(plan).toBe('kept-broken')
    expect(saveFile).not.toHaveBeenCalled() // 绝不写回
    expect(api.fs.writes).toHaveLength(0)
    expect(applyTubes).not.toHaveBeenCalled() // 内存保持数据库那份
    expect(api.backups).toEqual([BROKEN]) // 坏文件原样留证
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('仓库.broken-1.yml')
    expect(notify.mock.calls[0][0]).toContain('未回写')
  })
})

describe('仓库正本：显式删除要真落盘（缺陷 6）', () => {
  it('界面删一个试剂 → 文件少一条；重启 bootstrap 后不复活', async () => {
    const api = installFakeApi(toWarehouseYml({ reagents: REAGENTS, groups: [] }), REAGENTS)
    await loadWarehouseFile()

    const removed = REAGENTS[0]
    const next: WarehouseSnapshot = { reagents: REAGENTS.slice(1), groups: [] }
    // warehouseStore.deleteTube 的顺序是先删数据库、再请求写盘，所以写盘时 DB 已经是 38 条
    api.getTubes.mockImplementation(async () => REAGENTS.slice(1))
    const saved = await saveWarehouseFile(next, { explicitDelete: [removed.id] })

    expect(saved).toBe(true)
    expect(api.fs.writes).toHaveLength(1)
    expect(fileReagents(api.fs.content).map(tube => tube.id)).not.toContain(removed.id)

    // 模拟重启：重新读文件 → bootstrap 用文件覆盖内存
    resetWarehouseFileStat()
    api.getTubes.mockImplementation(async () => REAGENTS.slice(1)) // DB 里也已经删了
    const applyTubes = vi.fn()
    const plan = await bootstrapWarehouseFile({
      loadFile: loadWarehouseFile,
      saveFile: vi.fn(async () => true),
      currentSnapshot: () => ({ reagents: REAGENTS, groups: [] }),
      applyTubes,
      applyGroups: vi.fn()
    })

    expect(plan).toBe('used-file')
    const loadedIds = (applyTubes.mock.calls[0][0] as Tube[]).map(tube => tube.id)
    expect(loadedIds).not.toContain(removed.id) // 没复活
    expect(loadedIds).toHaveLength(38)
  })

  it('非显式删除导致骤降 → 仍然拒绝写，文件一个字节不动', async () => {
    const api = installFakeApi(toWarehouseYml({ reagents: REAGENTS, groups: [] }), REAGENTS)
    await loadWarehouseFile()

    const saved = await saveWarehouseFile({ reagents: REAGENTS.slice(0, 13), groups: [] })

    expect(saved).toBe(false)
    expect(api.fs.writes).toHaveLength(0)
    expect(fileReagents(api.fs.content)).toHaveLength(39)
  })

  it('只放行被点名的那个 id，别的减少依然拒绝', async () => {
    const api = installFakeApi(toWarehouseYml({ reagents: REAGENTS, groups: [] }), REAGENTS)
    await loadWarehouseFile()

    const saved = await saveWarehouseFile({ reagents: REAGENTS.slice(0, 38), groups: [] }, { explicitDelete: ['r-38'] })

    expect(saved).toBe(false) // r-39 不见了，但没被点名
    expect(api.fs.writes).toHaveLength(0)
  })
})
