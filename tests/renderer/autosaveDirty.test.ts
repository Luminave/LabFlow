/**
 * 缺陷 7：自动保存失败不能当成「已保存」
 * - 保存抛错 → hasPendingAutoSave() 保持 true，并给出提示
 * - 有未保存改动时热加载 → 一律不自动 reload（只挂提示条）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Experiment, Tube } from '../../src/shared/types'
import { hasPendingAutoSave, useExperimentStore } from '../../src/renderer/src/stores/experimentStore'
import { planHotReload } from '../../src/renderer/src/utils/storeHotReload'

function sourceTube(id = 'r-1'): Tube {
  return {
    id,
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

function makeExperiment(): Experiment {
  return {
    id: 'exp-1',
    name: '自动保存测试',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'draft',
    tubes: [],
    tubePositions: [],
    connections: []
  }
}

let saveExperiment: ReturnType<typeof vi.fn>
let toasts: string[]

beforeEach(() => {
  vi.useFakeTimers()
  toasts = []
  saveExperiment = vi.fn(async () => {
    throw new Error('数据库锁住了')
  })

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

  ;(globalAny as any).window = {
    electronAPI: { saveExperiment },
    dispatchEvent: (event: { type?: string; detail?: { text?: string } }) => {
      if (event?.type === 'labflow:global-toast') toasts.push(event.detail?.text ?? '')
      return true
    }
  }

  const experiment = makeExperiment()
  useExperimentStore.setState({
    currentExperiment: experiment,
    currentTubes: [],
    connections: [],
    tubePositions: [],
    experiments: []
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** 触发一次会走自动保存的改动 */
function touch(): void {
  useExperimentStore.getState().addSourceTube(sourceTube(`r-${Math.random()}`))
}

describe('自动保存失败 → 仍然 dirty（缺陷 7）', () => {
  it('保存抛错后不标记已保存、给出提示；修好后再保存才清 dirty', async () => {
    touch()
    expect(hasPendingAutoSave()).toBe(true) // 防抖窗口里

    await vi.advanceTimersByTimeAsync(2000)

    // 已经过了 2 秒窗口，但写盘失败 → 仍然算「有未保存改动」
    expect(hasPendingAutoSave()).toBe(true)
    expect(saveExperiment).toHaveBeenCalledTimes(1)
    expect(toasts.join('\n')).toContain('自动保存失败')

    // 这时热加载：不许自动 reload，只挂提示条
    const plan = planHotReload({
      payload: { warehouse: false, projects: ['自动保存测试.yml'] },
      currentProjectFile: '自动保存测试.yml',
      dirty: hasPendingAutoSave()
    })
    expect(plan.reloadProject).toBe(false)
    expect(plan.promptProject).toBe(true)

    // 数据库恢复后，下一次自动保存成功 → dirty 清掉
    saveExperiment.mockResolvedValue({ success: true })
    touch()
    await vi.advanceTimersByTimeAsync(2000)

    expect(hasPendingAutoSave()).toBe(false)
    expect(saveExperiment).toHaveBeenCalledTimes(2)

    const cleanPlan = planHotReload({
      payload: { warehouse: false, projects: ['自动保存测试.yml'] },
      currentProjectFile: '自动保存测试.yml',
      dirty: hasPendingAutoSave()
    })
    expect(cleanPlan.reloadProject).toBe(true)
    expect(cleanPlan.promptProject).toBe(false)
  })
})
