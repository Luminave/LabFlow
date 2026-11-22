/**
 * 第 1 步主路径回归：工程正本（工程/*.yml）必须真的压过数据库。
 *
 * 造一份「数据库里 E1 是 100 µM」的记录 + 「文件里 E1 是 120 µM」的正本，
 * 跑 setState 之外的真实入口 fetchExperiments()，断言内存里的工程取的是 120。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toProjectYml } from '../../src/core/exporters/yml'
import { projectInputFromExperiment } from '../../src/core/exporters/types'
import type { Experiment } from '../../src/shared/types'
import { fixtures } from '../helpers/fixtures'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!

/** fixture → 数据库记录形状（dbToExperiment 吃这个） */
function dbRecord() {
  const rawPositions = (ad52.experiment.tubePositions || []) as any[]
  return {
    id: 'exp-1',
    name: 'AD-5.2',
    description: null,
    created_at: '2026-09-09T08:54:16.163Z',
    updated_at: '2026-11-18T08:00:53.098Z',
    completed_at: null,
    status: 'draft',
    is_waste: 0,
    tubes: JSON.stringify(ad52.experiment.tubes),
    tube_positions: JSON.stringify(
      rawPositions.map(p => ({ tubeId: p.tubeId ?? p.id, x: p.x ?? p.position?.x ?? 0, y: p.y ?? p.position?.y ?? 0 }))
    ),
    connections: JSON.stringify(ad52.experiment.connections),
    warehouse_snapshot: JSON.stringify(ad52.warehouseTubes)
  }
}

function projectYmlWithE1Concentration(concentration: number): string {
  const rawPositions = (ad52.experiment.tubePositions || []) as any[]
  const experiment = {
    ...ad52.experiment,
    tubePositions: rawPositions.map(p => ({
      tubeId: p.tubeId ?? p.id,
      x: p.x ?? p.position?.x ?? 0,
      y: p.y ?? p.position?.y ?? 0
    })),
    warehouseSnapshot: ad52.warehouseTubes
  } as unknown as Experiment
  const text = toProjectYml(projectInputFromExperiment(experiment))
  return text.replace(/concentration: 100 μM/, `concentration: ${concentration} μM`)
}

describe('工程正本优先于数据库', () => {
  beforeEach(() => {
    vi.resetModules()
    // 让 store 里的 localStorage 调用落到假实现上，输出干净些
    ;(globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  })

  it('文件里 E1 改成 120 µM，fetchExperiments 之后内存里也是 120（不是数据库的 100）', async () => {
    const yml = projectYmlWithE1Concentration(120)

    ;(globalThis as any).window = {
      electronAPI: {
        getExperiments: async () => [dbRecord()],
        dataRoot: {
          readProject: async () => ({
            ok: true,
            content: yml,
            path: 'D:\\学习\\labflow\\工程\\AD-5.2.yml',
            stat: { mtimeMs: 1000, size: yml.length }
          }),
          readWarehouse: async () => ({ ok: false }),
          writeProject: async () => ({ ok: true, fileName: 'AD-5.2.yml', stat: { mtimeMs: 1000, size: yml.length } }),
          statProject: async () => ({ mtimeMs: 1000, size: yml.length })
        }
      },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    }

    const { useExperimentStore } = await import('../../src/renderer/src/stores/experimentStore')
    await useExperimentStore.getState().fetchExperiments()

    // 文件里带自己的 id（迁移时写进去的），所以按名字找
    const experiment = useExperimentStore.getState().experiments.find(e => e.name === 'AD-5.2')!
    expect(experiment).toBeTruthy()
    const e1 = experiment.tubes.find(t => t.name === 'E1')!
    expect(e1.substances[0].concentration).toBe(120)
  })

  it('文件不存在时退回数据库，并生成一份正本（写一次）', async () => {
    const writeProject = vi.fn(async () => ({
      ok: true,
      fileName: 'AD-5.2.yml',
      stat: { mtimeMs: 2000, size: 10 }
    }))

    ;(globalThis as any).window = {
      electronAPI: {
        getExperiments: async () => [dbRecord()],
        dataRoot: {
          readProject: async () => ({ ok: false }),
          readWarehouse: async () => ({ ok: false }),
          writeProject,
          statProject: async () => null
        }
      },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    }

    const { useExperimentStore } = await import('../../src/renderer/src/stores/experimentStore')
    await useExperimentStore.getState().fetchExperiments()

    expect(writeProject).toHaveBeenCalledTimes(1)
    const experiment = useExperimentStore.getState().experiments.find(e => e.id === 'exp-1')!
    expect(experiment.tubes.find(t => t.name === 'E1')!.substances[0].concentration).toBe(100)
  })
})
