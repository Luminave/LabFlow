/**
 * 源试管的余量以 仓库.yml 为准（工程 yml 只记引用）。
 *
 * 造一份「工程里 E1 余量 15 µL / 仓库里 20 µL」的数据，走真实 loadProjectSource()，
 * 断言拿到的工程余量是 20；工程自产的中间产物不受仓库影响。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toProjectYml } from '../../src/core/exporters/yml'
import { projectInputFromExperiment } from '../../src/core/exporters/types'
import { toWarehouseYml } from '../../src/core/store/warehouseFile'
import type { Experiment } from '../../src/shared/types'
import { fixtures } from '../helpers/fixtures'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!

function experiment(): Experiment {
  const rawPositions = (ad52.experiment.tubePositions || []) as any[]
  return {
    ...ad52.experiment,
    tubePositions: rawPositions.map(p => ({
      tubeId: p.tubeId ?? p.id,
      x: p.x ?? p.position?.x ?? 0,
      y: p.y ?? p.position?.y ?? 0
    })),
    warehouseSnapshot: ad52.warehouseTubes
  } as unknown as Experiment
}

describe('源试管余量：以仓库正本为准', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  })

  it('仓库文件 20 µL、工程文件 15 µL 时取 20；中间产物保持工程里的值', async () => {
    const base = experiment()
    // 工程文件：E1 余量写成 15
    const projectText = toProjectYml(projectInputFromExperiment(base)).replace(
      /(- id: [^\n]*\n(?:.*\n)*?    remainingVolume: )\d+( μL)/,
      '$115$2'
    )

    // 前提：工程文件里确实写成了 15（否则这条测试等于没测）
    expect(projectText).toContain('remainingVolume: 15 μL')

    // 仓库文件：E1 余量 20
    const warehouseText = toWarehouseYml({
      reagents: ad52.warehouseTubes.map(t =>
        t.name === 'E1' ? { ...t, remainingVolume: 20, remainingVolumeUnit: 'μL' } : t
      ),
      groups: []
    })

    ;(globalThis as any).window = {
      electronAPI: {
        dataRoot: {
          readProject: async () => ({
            ok: true,
            content: projectText,
            path: 'D:\\学习\\labflow\\工程\\AD-5.2.yml',
            stat: { mtimeMs: 1, size: projectText.length }
          }),
          readWarehouse: async () => ({ ok: true, content: warehouseText }),
          writeProject: async () => ({ ok: true, fileName: 'AD-5.2.yml', stat: { mtimeMs: 1, size: 1 } })
        }
      }
    }

    const { loadProjectSource } = await import('../../src/renderer/src/utils/projectSource')
    const loaded = await loadProjectSource(base)
    expect(loaded).toBeTruthy()

    const e1 = loaded!.experiment.tubes.find(t => t.name === 'E1')!
    expect(e1.remainingVolume).toBe(20)

    // 中间产物不在仓库里，保持工程文件里的值
    const intermediate = loaded!.experiment.tubes.find(t => t.type === 'intermediate')!
    const fromFile = base.tubes.find(t => t.id === intermediate.id)!
    expect(intermediate.remainingVolume).toBe(fromFile.remainingVolume)
  })
})
