/**
 * 缺陷 1 / 3：工程正本的取名与查找
 * - 1：同名不同 id → 两个不同文件（不许后保存的整份覆盖前一个）；同名同 id → 复用同一个文件
 * - 3：先按工程 id 扫 工程/*.yml（文件被改名也认），再退回按名字；都没有才由 DB 生成
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PROJECT_DIR,
  ensureDataRoot,
  findProjectFileById,
  projectIdInFile,
  resolveProjectPath,
  writeFileAtomic
} from '../../electron/dataRoot'
import { projectFileText } from '../../src/core/store/projectFile'
import { toWarehouseYml } from '../../src/core/store/warehouseFile'
import type { Experiment, Tube } from '../../src/shared/types'
import { loadProjectSource, resetWarehouseReagentsCache } from '../../src/renderer/src/utils/projectSource'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labflow-fix-'))

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  ensureDataRoot(root)
})

function projectFile(id: string, name: string): string {
  return `schemaVersion: 2\nproject:\n  id: ${id}\n  name: ${name}\n`
}

function projectFiles(): string[] {
  return fs
    .readdirSync(path.join(root, PROJECT_DIR))
    .filter(file => file.endsWith('.yml'))
    .sort()
}

function sourceTube(): Tube {
  return {
    id: 'r-1',
    name: 'PBS',
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

function makeExperiment(): Experiment {
  return {
    id: 'id-b',
    name: '同名',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'draft',
    tubes: [sourceTube()],
    tubePositions: [],
    connections: []
  }
}

describe('工程正本取名（缺陷 1）', () => {
  it('同名不同 id → 落成两个不同文件，谁也没覆盖谁', () => {
    const first = resolveProjectPath(root, 'id-a', '同名')
    expect(path.basename(first)).toBe('同名.yml')
    writeFileAtomic(first, projectFile('id-a', '同名'))

    const taken = projectFiles()
    const second = resolveProjectPath(root, 'id-b', '同名', taken)
    expect(path.basename(second)).toBe('同名-2.yml')
    writeFileAtomic(second, projectFile('id-b', '同名'))

    expect(projectFiles()).toEqual(['同名-2.yml', '同名.yml'])
    expect(projectIdInFile(path.join(root, PROJECT_DIR, '同名.yml'))).toBe('id-a')
    expect(projectIdInFile(path.join(root, PROJECT_DIR, '同名-2.yml'))).toBe('id-b')
  })

  it('同名同 id → 复用同一个文件（不越攒越多）', () => {
    const first = resolveProjectPath(root, 'id-a', '同名')
    writeFileAtomic(first, projectFile('id-a', '同名'))

    const again = resolveProjectPath(root, 'id-a', '同名', projectFiles())
    expect(again).toBe(first)
    expect(projectFiles()).toEqual(['同名.yml'])
  })

  it('文件被改名后仍按 id 命中，不生成第二份', () => {
    const first = resolveProjectPath(root, 'id-b', '同名')
    writeFileAtomic(first, projectFile('id-b', '同名'))
    fs.renameSync(first, path.join(root, PROJECT_DIR, '改过的名字.yml'))

    const resolved = resolveProjectPath(root, 'id-b', '同名', projectFiles())
    expect(path.basename(resolved)).toBe('改过的名字.yml')
    expect(projectFiles()).toEqual(['改过的名字.yml'])
    expect(findProjectFileById(root, 'id-b')?.fileName).toBe('改过的名字.yml')
  })
})

describe('工程正本查找（缺陷 3）', () => {
  it('按名字找不到、按 id 找到改过名字的文件 → 用文件内容，不再生成第二份', async () => {
    const experiment = makeExperiment()
    const renamedContent = projectFileText(experiment)

    const readProject = vi.fn(async () => ({ ok: false as const, reason: 'not-found' as const }))
    const findProject = vi.fn(async (id: string) =>
      id === experiment.id
        ? {
            ok: true as const,
            path: 'D:/x/工程/改过的名字.yml',
            fileName: '改过的名字.yml',
            content: renamedContent,
            stat: { mtimeMs: 1, size: renamedContent.length }
          }
        : { ok: false as const, reason: 'not-found' as const }
    )
    const writeProject = vi.fn(async () => ({
      ok: true as const,
      path: 'D:/x/工程/同名.yml',
      fileName: '同名.yml',
      stat: { mtimeMs: 2, size: 10 }
    }))
    const warehouseText = toWarehouseYml({ reagents: [sourceTube()], groups: [] })

    ;(globalThis as any).window = {
      electronAPI: {
        dataRoot: {
          readProject,
          findProject,
          writeProject,
          readWarehouse: async () => ({
            ok: true as const,
            path: 'D:/x/仓库.yml',
            content: warehouseText,
            stat: { mtimeMs: 1, size: warehouseText.length }
          })
        },
        getTubes: async () => [sourceTube()]
      }
    }
    resetWarehouseReagentsCache()

    const entry = await loadProjectSource(experiment)

    expect(entry).not.toBeNull()
    expect(entry!.fromFile).toBe(true)
    expect(entry!.fileName).toBe('改过的名字.yml')
    expect(entry!.experiment.id).toBe(experiment.id)
    expect(writeProject).not.toHaveBeenCalled() // 没有凭空生成第二份
    expect(findProject).toHaveBeenCalledWith(experiment.id)
  })

  it('id 和名字都找不到 → 才由 DB 生成并写盘一次', async () => {
    const experiment = makeExperiment()
    const writeProject = vi.fn(async () => ({
      ok: true as const,
      path: 'D:/x/工程/同名.yml',
      fileName: '同名.yml',
      stat: { mtimeMs: 2, size: 10 }
    }))

    ;(globalThis as any).window = {
      electronAPI: {
        dataRoot: {
          readProject: async () => ({ ok: false as const, reason: 'not-found' as const }),
          findProject: async () => ({ ok: false as const, reason: 'not-found' as const }),
          writeProject,
          readWarehouse: async () => ({ ok: false as const, reason: 'not-found' as const })
        },
        getTubes: async () => []
      }
    }
    resetWarehouseReagentsCache()

    const entry = await loadProjectSource(experiment)

    expect(entry!.fromFile).toBe(false)
    expect(entry!.fileName).toBe('同名.yml')
    expect(writeProject).toHaveBeenCalledTimes(1)
  })
})
