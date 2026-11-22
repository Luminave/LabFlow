/**
 * 第 1 条：锁必须挡住**所有写路径**，不只是把按钮变灰。
 *
 * 事故形状：`ExperimentPage.module.css` 的 `.toolbarFrozen{pointer-events:none}` 只让按钮点不动；
 * 弹窗照用、2 秒自动保存照跑、completeExperiment 不查锁 —— Agent 正在写文件时界面照样往上盖。
 * 现在：判定下沉到写入口（persistExperiment / completeExperiment / revertExperiment / deleteExperiment），
 * 被锁时 writeProject / writeWarehouse / saveExperiment / updateTube 全是 0 次调用，只给一句轻提示。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Experiment, Tube } from '../../src/shared/types'
import { hasPendingAutoSave, useExperimentStore } from '../../src/renderer/src/stores/experimentStore'
import { useWarehouseStore } from '../../src/renderer/src/stores/warehouseStore'
import { setWarehouseWriter } from '../../src/renderer/src/utils/warehouseWriteQueue'
import { AgentLockError, resetDeferredWriteNotice } from '../../src/renderer/src/utils/agentLock'

function sourceTube(): Tube {
  return {
    id: 'r-1',
    name: 'PBS',
    type: 'source',
    totalVolume: 200,
    totalVolumeUnit: 'μL',
    remainingVolume: 200,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  }
}

function sampleTube(): Tube {
  return {
    id: 's-1',
    name: '样品1',
    type: 'sample',
    totalVolume: 0,
    totalVolumeUnit: 'μL',
    remainingVolume: 0,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'active'
  }
}

function makeExperiment(): Experiment {
  return {
    id: 'exp-lock',
    name: '锁测试',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'draft',
    tubes: [sourceTube(), sampleTube()],
    tubePositions: [],
    connections: [{ id: 'c1', fromTubeId: 'r-1', toTubeId: 's-1', volume: 100, volumeUnit: 'μL' }],
    warehouseSnapshot: [sourceTube()]
  }
}

interface Installed {
  writeProject: ReturnType<typeof vi.fn>
  writeWarehouse: ReturnType<typeof vi.fn>
  saveExperiment: ReturnType<typeof vi.fn>
  updateTube: ReturnType<typeof vi.fn>
  deleteExperiment: ReturnType<typeof vi.fn>
  toasts: string[]
}

/** lock: 传 'none' 表示没有锁；传对象表示这把锁正锁着本工程 */
function installApi(lock: 'none' | { pid: number; agent: string; project: string }): Installed {
  const toasts: string[] = []
  const writeProject = vi.fn(async () => ({
    ok: true,
    path: 'D:/tmp/工程/锁测试.yml',
    fileName: '锁测试.yml',
    stat: { mtimeMs: 7, size: 120 }
  }))
  const writeWarehouse = vi.fn(async () => ({ ok: true, path: 'D:/tmp/仓库.yml', stat: { mtimeMs: 9, size: 300 } }))
  const saveExperiment = vi.fn(async () => ({ success: true }))
  const updateTube = vi.fn(async () => ({ success: true }))
  const deleteExperiment = vi.fn(async () => ({ success: true }))

  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear()
  }

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

  const agentLock =
    lock === 'none'
      ? null
      : { ...lock, note: '', startedAt: '2026-11-23T01:00:00.000Z' }

  ;(globalAny as any).window = {
    electronAPI: {
      getAgentLock: async () => agentLock,
      getTubes: async () => [],
      updateTube,
      addTube: async () => ({ success: true }),
      deleteTube: async () => ({ success: true }),
      saveExperiment,
      deleteExperiment,
      getExperiments: async () => [],
      getTubeHistories: async () => [],
      saveTubeHistories: async () => ({ success: true }),
      dataRoot: {
        writeProject,
        writeWarehouse,
        readWarehouse: async () => ({ ok: false, reason: 'not-found' }),
        deleteProject: async () => ({ ok: false, reason: 'not-found' })
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

  return { writeProject, writeWarehouse, saveExperiment, updateTube, deleteExperiment, toasts }
}

function seedStore(): void {
  const experiment = makeExperiment()
  useExperimentStore.setState({
    currentExperiment: experiment,
    currentTubes: experiment.tubes,
    connections: experiment.connections,
    tubePositions: [],
    experiments: [experiment],
    error: null
  })
  useWarehouseStore.setState({ tubes: [sourceTube()] })
}

beforeEach(() => {
  resetDeferredWriteNotice()
  setWarehouseWriter(null)
  seedStore()
})

afterEach(() => {
  vi.useRealTimers()
  setWarehouseWriter(null)
})

describe('被锁：三个写入口都拒绝落地（第 1 条）', () => {
  it('手动保存 → 抛 AgentLockError，writeProject / saveExperiment 都是 0 次，有轻提示', async () => {
    const api = installApi({ pid: 4242, agent: 'codex/墨林', project: '锁测试' })

    await expect(useExperimentStore.getState().saveCurrentExperiment()).rejects.toBeInstanceOf(AgentLockError)

    expect(api.writeProject).toHaveBeenCalledTimes(0)
    expect(api.saveExperiment).toHaveBeenCalledTimes(0)
    const toast = api.toasts.join('\n')
    expect(toast).toContain('Agent 正在操作，已暂缓写入')
    expect(toast).toContain('codex/墨林/4242')
  })

  it('自动保存（2 秒）→ 不写文件、保持 dirty、只提示一次「已暂缓写入」而不是「自动保存失败」', async () => {
    vi.useFakeTimers()
    const api = installApi({ pid: 4242, agent: 'codex/墨林', project: '锁测试' })

    useExperimentStore.getState().addSourceTube({ ...sourceTube(), id: 'r-2' })
    await vi.advanceTimersByTimeAsync(2000)

    expect(api.writeProject).toHaveBeenCalledTimes(0)
    expect(api.saveExperiment).toHaveBeenCalledTimes(0)
    expect(hasPendingAutoSave()).toBe(true)
    expect(api.toasts.join('\n')).toContain('已暂缓写入')
    expect(api.toasts.join('\n')).not.toContain('自动保存失败')

    // 再改一次、再等 2 秒：同一把锁只提示一次，不连珠炮
    useExperimentStore.getState().addSourceTube({ ...sourceTube(), id: 'r-3' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.toasts.filter(text => text.includes('已暂缓写入'))).toHaveLength(1)
    expect(api.writeProject).toHaveBeenCalledTimes(0)
  })

  it('结束实验 → 抛 AgentLockError，两个正本、数据库、仓库都没动', async () => {
    const api = installApi({ pid: 4242, agent: 'codex/墨林', project: '锁测试' })
    const writer = vi.fn(async () => ({ ok: true }))
    setWarehouseWriter(writer)

    await expect(useExperimentStore.getState().completeExperiment()).rejects.toBeInstanceOf(AgentLockError)

    expect(writer).toHaveBeenCalledTimes(0)
    expect(api.writeWarehouse).toHaveBeenCalledTimes(0)
    expect(api.writeProject).toHaveBeenCalledTimes(0)
    expect(api.updateTube).toHaveBeenCalledTimes(0)
    expect(api.saveExperiment).toHaveBeenCalledTimes(0)
    expect(useExperimentStore.getState().currentExperiment?.status).toBe('draft')
    expect(useWarehouseStore.getState().tubes.find(tube => tube.id === 'r-1')!.remainingVolume).toBe(200)
  })

  it('回退 → 返回 false，文件与数据库都没动', async () => {
    const api = installApi({ pid: 4242, agent: 'codex/墨林', project: '锁测试' })
    const writer = vi.fn(async () => ({ ok: true }))
    setWarehouseWriter(writer)
    useExperimentStore.setState({
      experiments: [{ ...makeExperiment(), status: 'completed' }]
    })

    await expect(useExperimentStore.getState().revertExperiment('exp-lock')).resolves.toBe(false)

    expect(writer).toHaveBeenCalledTimes(0)
    expect(api.writeProject).toHaveBeenCalledTimes(0)
    expect(api.saveExperiment).toHaveBeenCalledTimes(0)
    expect(api.toasts.join('\n')).toContain('回退失败')
  })

  it('删除工程 → 不搬文件、不删数据库，提示删除失败', async () => {
    const api = installApi({ pid: 4242, agent: 'codex/墨林', project: '锁测试' })
    const deleteProject = vi.fn(async () => ({ ok: true, fileName: '锁测试.yml' }))
    ;(window as any).electronAPI.dataRoot.deleteProject = deleteProject

    await useExperimentStore.getState().deleteExperiment('exp-lock')

    expect(deleteProject).toHaveBeenCalledTimes(0)
    expect(api.deleteExperiment).toHaveBeenCalledTimes(0)
    expect(api.toasts.join('\n')).toContain('删除工程失败')
  })
})

describe('没锁 / 锁的是别的工程：照常写（第 1 条）', () => {
  it('没有锁 → 手动保存真的写了正本', async () => {
    const api = installApi('none')

    await useExperimentStore.getState().saveCurrentExperiment()

    expect(api.writeProject).toHaveBeenCalledTimes(1)
    expect(api.saveExperiment).toHaveBeenCalledTimes(1)
    expect(api.toasts.join('\n')).not.toContain('已暂缓写入')
  })

  it('锁的是别的工程 → 本工程照写（不误伤）', async () => {
    const api = installApi({ pid: 4242, agent: 'codex/墨林', project: '别的工程' })

    await useExperimentStore.getState().saveCurrentExperiment()

    expect(api.writeProject).toHaveBeenCalledTimes(1)
    expect(api.toasts.join('\n')).not.toContain('已暂缓写入')
  })

  it('锁文件损坏（读不出三元组）→ 不挡人，照写', async () => {
    const globalAny = globalThis as any
    globalAny.window.electronAPI.getAgentLock = async () => ({ broken: true, raw: '{{{', reason: '不是合法的 JSON' })

    const api = installApi('none')
    globalAny.window.electronAPI.getAgentLock = async () => ({ broken: true, raw: '{{{', reason: '不是合法的 JSON' })

    await useExperimentStore.getState().saveCurrentExperiment()

    expect(api.writeProject).toHaveBeenCalledTimes(1)
  })
})
