/**
 * 测试用：把真实 fixture 包成导出器吃的 ProjectInput。
 * fixture 里的坐标是 `{ id, position: { x, y } }` 形状，这里转成 `{ tubeId, x, y }`。
 */
import type { Experiment } from '../../src/shared/types'
import { projectInputFromExperiment, type ProjectInput } from '../../src/core/exporters/types'
import type { Fixture } from './fixtures'

export function fixtureInput(fixture: Fixture): ProjectInput {
  const rawPositions = (fixture.experiment.tubePositions || []) as any[]
  const experiment = {
    ...fixture.experiment,
    tubePositions: rawPositions.map(p => {
      // fixture 里可能有两种形状：{ id, position: { x, y } } 或已经是 { tubeId, x, y }
      const tubeId = p.tubeId ?? p.id
      const x = p.x ?? p.position?.x
      const y = p.y ?? p.position?.y
      return { tubeId, x, y }
    }),
    warehouseSnapshot: fixture.warehouseTubes
  } as unknown as Experiment

  return projectInputFromExperiment(experiment)
}

/** 去掉坐标，模拟「工程里根本没存坐标」的情况 */
export function withoutPositions(input: ProjectInput): ProjectInput {
  return { ...input, positions: [] }
}
