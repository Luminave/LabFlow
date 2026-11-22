/**
 * 真实工程 fixture 的读取工具。
 *
 * fixture 由 `%APPDATA%\LabFlow\data\labflow.db` 的**只读副本**导出
 * （副本 D:\tmp\lf_fixture\labflow_copy.db，原始库未被修改）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { TransferConnection, Tube } from '../../src/shared/types'

export interface FixtureExperiment {
  id: string
  name: string
  status: string
  createdAt?: string
  updatedAt?: string
  defaultBuffer?: string
  tubes: Tube[]
  tubePositions: { id: string; position: { x: number; y: number } }[]
  connections: TransferConnection[]
  initialStateTubes: Tube[] | null
}

export interface Fixture {
  name: string
  file: string
  experiment: FixtureExperiment
  warehouseTubes: Tube[]
}

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures')

const manifest: { name: string; file: string }[] = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8')
)

/** 全部真实工程 fixture（3 个） */
export const fixtures: Fixture[] = manifest.map(entry => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtureDir, entry.file), 'utf8'))
  return {
    name: entry.name,
    file: entry.file,
    experiment: raw.experiment as FixtureExperiment,
    warehouseTubes: raw.warehouseTubes as Tube[]
  }
})

/** 造一支最小可用的试管（测试内构造边界情况用） */
export function tube(partial: Partial<Tube> & Pick<Tube, 'id' | 'type'>): Tube {
  return {
    name: partial.id,
    totalVolume: 0,
    totalVolumeUnit: 'μL',
    remainingVolume: 0,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    ...partial
  } as Tube
}

/** 造一条连线 */
export function conn(from: string, to: string, volume: number, id = `${from}->${to}`): TransferConnection {
  return { id, fromTubeId: from, toTubeId: to, volume, volumeUnit: 'μL' }
}
