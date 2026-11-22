/**
 * 工程正本（工程/<名>.yml）的读写测试：幂等、坏文件不崩、试剂引用一致。
 */
import { describe, expect, it } from 'vitest'

import {
  experimentFromProjectFile,
  missingReagentRefs,
  projectFileText,
  readVersion,
  PROJECT_FILE_VERSION
} from '../../src/core/store/projectFile'
import { projectInputFromExperiment } from '../../src/core/exporters/types'
import type { Experiment } from '../../src/shared/types'
import { fixtures } from '../helpers/fixtures'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!
const real = fixtures.find(f => f.name.includes('261118-实际实验'))!

function asExperiment(fixture: typeof ad52): Experiment {
  const rawPositions = (fixture.experiment.tubePositions || []) as any[]
  return {
    ...fixture.experiment,
    tubePositions: rawPositions.map(p => ({
      tubeId: p.tubeId ?? p.id,
      x: p.x ?? p.position?.x ?? 0,
      y: p.y ?? p.position?.y ?? 0
    })),
    warehouseSnapshot: fixture.warehouseTubes
  } as unknown as Experiment
}

describe('工程正本 —— 往返幂等', () => {
  it('db → yml → db → yml：两次文本完全一致', () => {
    const first = asExperiment(ad52)
    const text1 = projectFileText(first)
    const back = experimentFromProjectFile(text1, first)
    expect(back).not.toBeNull()
    const text2 = projectFileText(back!.experiment)
    expect(text2).toBe(text1)
  })

  it('真实实验（31 管 28 连线）往返也稳定', () => {
    const first = asExperiment(real)
    const text1 = projectFileText(first)
    const back = experimentFromProjectFile(text1, first)!
    expect(projectFileText(back.experiment)).toBe(text1)
    expect(back.experiment.tubes).toHaveLength(first.tubes.length)
    expect(back.experiment.connections).toHaveLength(first.connections.length)
  })

  it('文件头写的是 schemaVersion: 2，且能被 readVersion 识别', () => {
    const text = projectFileText(asExperiment(ad52))
    expect(text).toContain(`schemaVersion: ${PROJECT_FILE_VERSION}`)
    expect(readVersion(text)).toBe(PROJECT_FILE_VERSION)
  })

  it('旧版（schemaVersion: 1）的导出文件也能读回来', () => {
    const text = projectFileText(asExperiment(ad52)).replace('schemaVersion: 2', 'schemaVersion: 1')
    const parsed = experimentFromProjectFile(text, asExperiment(ad52))
    expect(parsed).not.toBeNull()
    expect(parsed!.experiment.tubes.length).toBe(asExperiment(ad52).tubes.length)
  })
})

describe('工程正本 —— 改文件后读回来跟着变', () => {
  it('改一根管的某条成分浓度，解析结果跟着变', () => {
    const experiment = asExperiment(ad52)
    const text = projectFileText(experiment)
    const changed = text.replace('concentration: 10 μM', 'concentration: 22 μM')
    expect(changed).not.toBe(text)
    const parsed = experimentFromProjectFile(changed, experiment)!
    const tube = parsed.experiment.tubes.find(t => t.substances.some(s => s.name === 'E1' && s.concentration === 22))
    expect(tube).toBeTruthy()
  })

  it('改连线体积，解析结果跟着变', () => {
    const experiment = asExperiment(ad52)
    const text = projectFileText(experiment)
    const changed = text.replace(/volume: 5 μL/, 'volume: 6 μL')
    const parsed = experimentFromProjectFile(changed, experiment)!
    expect(parsed.experiment.connections.some(c => c.volume === 6)).toBe(true)
  })
})

describe('工程正本 —— 文件被改坏时不崩', () => {
  it('删掉必填字段（tubes）只报 warning，不抛异常', () => {
    const experiment = asExperiment(ad52)
    const text = projectFileText(experiment)
    const broken = text.replace(/^tubes:/m, '# tubes:')
    const parsed = experimentFromProjectFile(broken, experiment)
    expect(parsed).not.toBeNull()
    expect(parsed!.warnings.length).toBeGreaterThan(0)
    // 坏文件不应该把工程变成空的：退回 fallback 的管
    expect(parsed!.experiment.tubes.length).toBe(experiment.tubes.length)
  })

  it('完全不认识的文本（不是 yml）也能安全返回', () => {
    const experiment = asExperiment(ad52)
    const parsed = experimentFromProjectFile('这不是 yml：{ [', experiment)
    expect(parsed === null || parsed.warnings.length > 0).toBe(true)
    if (parsed) expect(parsed.experiment.tubes.length).toBe(experiment.tubes.length)
  })

  it('版本号比支持的更新时给出 warning', () => {
    const text = projectFileText(asExperiment(ad52)).replace('schemaVersion: 2', 'schemaVersion: 99')
    const parsed = experimentFromProjectFile(text, asExperiment(ad52))
    expect(parsed!.warnings.join('；')).toMatch(/schemaVersion/)
  })
})

describe('工程正本 —— 试剂引用一致性', () => {
  it('工程引用的仓库试剂 id 都能在仓库里找到时，不报缺失', () => {
    const experiment = asExperiment(ad52)
    const input = projectInputFromExperiment(experiment)
    const warehouseIds = new Set((experiment.warehouseSnapshot || []).map(t => t.id))
    const missing = missingReagentRefs(input, warehouseIds)
    expect(missing).toEqual([])
  })

  it('仓库里缺了某试剂时，能点名报出来（而不是静默丢）', () => {
    const experiment = asExperiment(ad52)
    const input = projectInputFromExperiment(experiment)
    const warehouseIds = new Set((experiment.warehouseSnapshot || []).map(t => t.id))
    const someId = [...warehouseIds][0]
    warehouseIds.delete(someId)
    const missing = missingReagentRefs(input, warehouseIds)
    expect(missing.length).toBeGreaterThan(0)
  })
})
