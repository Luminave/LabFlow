/**
 * 目录里有、数据库没有的工程：启动/热重载时应该被导入。
 *
 * 只假造 `window.electronAPI`，不碰真磁盘（同 projectFileRead.test.ts 的做法）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const STAT = { mtimeMs: 1000, size: 100 }

/** 最小可解析的工程正本；id 不传就是「文件缺 project.id」 */
function projectYml(opts: { id?: string; name: string }): string {
  return [
    'schemaVersion: 2',
    'project:',
    ...(opts.id ? [`  id: ${opts.id}`] : []),
    `  name: ${opts.name}`,
    '  status: draft',
    "  createdAt: '2026-11-23T01:00:00.000Z'",
    "  updatedAt: '2026-11-23T01:00:00.000Z'",
    'tubes:',
    '  - id: tube-e1',
    '    name: E1',
    '    type: source',
    '    totalVolume: 100 μL',
    '    remainingVolume: 100 μL',
    '    substances:',
    '      - name: E1',
    '        concentration: 100 μM',
    '    x: 10',
    '    y: 20',
    'connections: []',
    ''
  ].join('\n')
}

function dbRecord(overrides: { id: string; name: string }): Record<string, unknown> {
  return {
    id: overrides.id,
    name: overrides.name,
    description: null,
    created_at: '2026-11-23T01:00:00.000Z',
    updated_at: '2026-11-23T01:00:00.000Z',
    completed_at: null,
    status: 'draft',
    is_waste: 0,
    tubes: JSON.stringify([]),
    tube_positions: JSON.stringify([]),
    connections: JSON.stringify([]),
    warehouse_snapshot: null
  }
}

interface FakeOptions {
  records?: Record<string, unknown>[]
  /** 目录里的文件（listProjects 的返回） */
  files?: { name: string; fileName: string }[]
  /** 文件名（带不带 .yml 都行）→ 正本内容 */
  contents?: Record<string, string>
}

function setupWindow(options: FakeOptions) {
  const db = [...(options.records || [])]
  const saveExperiment = vi.fn(async (exp: any) => {
    db.push(exp)
    return exp
  })

  const lookup = (key: string): string | undefined => {
    const contents = options.contents || {}
    return contents[key] ?? contents[key.replace(/\.yml$/i, '')] ?? contents[`${key.replace(/\.yml$/i, '')}.yml`]
  }

  const readProject = vi.fn(async (key: string) => {
    const content = lookup(key)
    return content
      ? { ok: true as const, path: `D:\\学习\\labflow\\工程\\${key}`, content, stat: STAT }
      : { ok: false as const, reason: 'not-found' as const }
  })

  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  }
  ;(globalThis as any).localStorage = storage
  ;(globalThis as any).window = {
    electronAPI: {
      getExperiments: async () => db,
      saveExperiment,
      dataRoot: {
        listProjects: async () =>
          (options.files || []).map(file => ({
            ...file,
            path: `D:\\学习\\labflow\\工程\\${file.fileName}`,
            stat: STAT
          })),
        readProject,
        readWarehouse: async () => ({ ok: false }),
        writeProject: vi.fn(async () => ({ ok: true, fileName: 'x.yml', stat: STAT })),
        statProject: async () => STAT
      }
    },
    localStorage: storage
  }

  return { db, saveExperiment, readProject }
}

async function loadStore() {
  const { useExperimentStore } = await import('../../src/renderer/src/stores/experimentStore')
  await useExperimentStore.getState().fetchExperiments()
  return useExperimentStore.getState().experiments
}

describe('导入 工程/*.yml 里有、数据库里没有的工程', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('库空 + 目录 1 个文件 → 导入后列表 1 条', async () => {
    const { saveExperiment } = setupWindow({
      files: [{ name: '261123', fileName: '261123.yml' }],
      contents: { '261123.yml': projectYml({ id: 'proj-261123', name: '261123' }) }
    })

    const experiments = await loadStore()

    expect(experiments).toHaveLength(1)
    expect(experiments[0].id).toBe('proj-261123')
    expect(experiments[0].name).toBe('261123')
    expect(experiments[0].tubes).toHaveLength(1)
    expect(saveExperiment).toHaveBeenCalledTimes(1)
  })

  it('库里已有同名同 id → 不重复导入', async () => {
    const { saveExperiment } = setupWindow({
      records: [dbRecord({ id: 'proj-261123', name: '261123' })],
      files: [{ name: '261123', fileName: '261123.yml' }],
      contents: { '261123.yml': projectYml({ id: 'proj-261123', name: '261123' }) }
    })

    const experiments = await loadStore()

    expect(experiments).toHaveLength(1)
    expect(experiments[0].id).toBe('proj-261123')
    expect(saveExperiment).not.toHaveBeenCalled()
  })

  it('同名不同 id → 不新增行、用库 id、有 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { saveExperiment } = setupWindow({
      records: [dbRecord({ id: 'db-id', name: '261123' })],
      files: [{ name: '261123', fileName: '261123.yml' }],
      contents: { '261123.yml': projectYml({ id: 'file-id', name: '261123' }) }
    })

    const experiments = await loadStore()

    expect(experiments).toHaveLength(1)
    expect(experiments[0].id).toBe('db-id')
    expect(saveExperiment).not.toHaveBeenCalled()
    expect(warn.mock.calls.some(args => String(args[0]).includes('不一致'))).toBe(true)
  })

  it('文件缺 project.id → 用文件名当 name、生成 id 并导入', async () => {
    const { saveExperiment } = setupWindow({
      files: [{ name: '无id工程', fileName: '无id工程.yml' }],
      contents: { '无id工程.yml': projectYml({ name: '文件里写的名字' }) }
    })

    const experiments = await loadStore()

    expect(experiments).toHaveLength(1)
    expect(experiments[0].name).toBe('无id工程')
    expect(experiments[0].id).toBeTruthy()
    expect(saveExperiment).toHaveBeenCalledTimes(1)
  })
})
