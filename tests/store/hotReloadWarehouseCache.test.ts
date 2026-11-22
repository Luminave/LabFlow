/**
 * 审查第 7 条：热加载只改内存、不重置 `warehouseReagentsCache`（projectSource.ts:21-44），
 * 重载后载入工程时余量仍按旧缓存算。
 *
 * 修法：仓库文件被外部改（热加载）或被自己写盘/恢复之后，缓存一律作废。
 * 这条测试走真链路：改 仓库.yml 里某试剂余量 → reloadWarehouseFromFile() → 再载入工程 → 余量按新值。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { projectFileText } from '../../src/core/store/projectFile'
import { toWarehouseYml } from '../../src/core/store/warehouseFile'
import type { Experiment, Tube } from '../../src/shared/types'
import {
  loadProjectSource,
  resetWarehouseReagentsCache
} from '../../src/renderer/src/utils/projectSource'
import { reloadWarehouseFromFile } from '../../src/renderer/src/utils/storeHotReload'
import { resetWarehouseFileStat } from '../../src/renderer/src/utils/warehouseSource'

function reagent(remainingVolume: number): Tube {
  return {
    id: 'r-1',
    name: 'PBS',
    type: 'source',
    totalVolume: 500,
    totalVolumeUnit: 'μL',
    remainingVolume,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  }
}

function experiment(): Experiment {
  return {
    id: 'exp-1',
    name: '缓存测试',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'draft',
    tubes: [reagent(500)],
    tubePositions: [],
    connections: []
  }
}

interface Installed {
  toasts: string[]
  setWarehouseVolume: (volume: number) => void
}

/** 一个会变的 仓库.yml + 一份引用了 r-1 的 工程 yml */
function installApi(startVolume: number): Installed {
  let warehouseText = toWarehouseYml({ reagents: [reagent(startVolume)], groups: [] })
  const projectText = projectFileText(experiment())
  const toasts: string[] = []

  ;(globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {}
  }

  ;(globalThis as any).window = {
    electronAPI: {
      getTubes: async () => [reagent(startVolume)],
      getTubeHistories: async () => [],
      dataRoot: {
        readWarehouse: async () => ({
          ok: true,
          path: 'D:/x/仓库.yml',
          content: warehouseText,
          stat: { mtimeMs: 1, size: warehouseText.length }
        }),
        findProject: async () => ({
          ok: true,
          path: 'D:/x/工程/缓存测试.yml',
          fileName: '缓存测试.yml',
          content: projectText,
          stat: { mtimeMs: 2, size: projectText.length }
        }),
        readProject: async () => ({ ok: false, reason: 'not-found' }),
        writeProject: async () => ({
          ok: true,
          path: 'D:/x/工程/缓存测试.yml',
          fileName: '缓存测试.yml',
          stat: { mtimeMs: 3, size: projectText.length }
        })
      }
    },
    dispatchEvent: (event: any) => {
      const text = event?.detail?.text
      if (typeof text === 'string') toasts.push(text)
      return true
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }

  return {
    toasts,
    setWarehouseVolume: (volume: number) => {
      // 模拟「外面的 Agent 改了 仓库.yml」：内容换了，文件本身还是那一份
      warehouseText = toWarehouseYml({ reagents: [reagent(volume)], groups: [] })
    }
  }
}

/** 工程里 r-1 这根管现在按多少算 */
async function volumeInProject(): Promise<number | undefined> {
  const entry = await loadProjectSource(experiment())
  return entry?.experiment.tubes.find(tube => tube.id === 'r-1')?.remainingVolume
}

beforeEach(() => {
  resetWarehouseReagentsCache()
  resetWarehouseFileStat()
  vi.restoreAllMocks()
})

describe('仓库缓存随热加载失效（审查第 7 条）', () => {
  it('改 仓库.yml 里某试剂余量 → 热重载 → 工程里该试剂按新值算', async () => {
    const api = installApi(500)
    expect(await volumeInProject()).toBe(500)

    // 外部把手改：余量 500 → 120
    api.setWarehouseVolume(120)
    // 没重载之前，缓存还在：工程里仍是旧值（这正是第 7 条说的问题）
    expect(await volumeInProject()).toBe(500)

    const reloaded = await reloadWarehouseFromFile()
    expect(reloaded).toBe(true)

    expect(await volumeInProject()).toBe(120)
  })

  it('热重载成功返回 true（提示由 useStoreHotReload 发，不在这个函数里）', async () => {
    installApi(500)
    expect(await reloadWarehouseFromFile()).toBe(true)
  })

  it('仓库文件读不懂 → 不清缓存、也不把内存覆盖掉', async () => {
    installApi(500)
    expect(await volumeInProject()).toBe(500)

    // 文件被写坏
    ;(globalThis as any).window.electronAPI.dataRoot.readWarehouse = async () => ({
      ok: true,
      path: 'D:/x/仓库.yml',
      content: '这不是: [合法的: yaml: 结构',
      stat: { mtimeMs: 9, size: 20 }
    })

    const reloaded = await reloadWarehouseFromFile()
    expect(reloaded).toBe(false)
    // 缓存没被清，工程里还是原来那份余量（不跟着坏文件走）
    expect(await volumeInProject()).toBe(500)
  })
})
