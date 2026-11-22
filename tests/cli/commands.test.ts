import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseArgv } from '../../src/cli/args'
import {
  commandCalc,
  commandComplete,
  commandDiff,
  commandExport,
  commandList,
  commandLock,
  commandValidate
} from '../../src/cli/commands'
import { projectFileText } from '../../src/core/store/projectFile'
import { toWarehouseYml } from '../../src/core/store/warehouseFile'
import type { Experiment, TransferConnection, Tube } from '../../src/core/schema'

// ------------------------------------------------------------------ 夹具

function tube(over: Partial<Tube> & Pick<Tube, 'id' | 'name' | 'type'>): Tube {
  return {
    totalVolume: 100,
    totalVolumeUnit: 'μL',
    remainingVolume: 100,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '',
    updatedAt: '',
    status: 'active',
    ...over
  } as Tube
}

function connection(from: string, to: string, volume: number): TransferConnection {
  return { id: `${from}->${to}`, fromTubeId: from, toTubeId: to, volume, volumeUnit: 'μL' }
}

function makeExperiment(over: Partial<Experiment> = {}): Experiment {
  const tubes: Tube[] = [
    tube({
      id: 'src-e1',
      name: 'E1',
      type: 'source',
      totalVolume: 20,
      remainingVolume: 20,
      substances: [{ name: 'E1', concentration: 100, concentrationUnit: 'μM' }]
    }),
    tube({
      id: 'buf-pbs',
      name: 'PBS',
      type: 'buffer',
      totalVolume: 0,
      remainingVolume: 0,
      substances: []
    }),
    tube({
      id: 'mid-10e1',
      name: '10E1',
      type: 'intermediate',
      configOrder: 1,
      totalVolume: 50,
      remainingVolume: 0,
      substances: [{ name: 'E1', concentration: 10, concentrationUnit: 'μM' }]
    })
  ]

  return {
    id: 'exp-1',
    name: '演示工程',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    status: 'draft',
    tubes,
    tubePositions: [],
    connections: [connection('src-e1', 'mid-10e1', 5), connection('buf-pbs', 'mid-10e1', 45)],
    ...over
  }
}

let root = ''

function writeProject(experiment: Experiment, stem = experiment.name): string {
  const dir = path.join(root, '工程')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${stem}.yml`)
  fs.writeFileSync(file, projectFileText(experiment), 'utf8')
  return file
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'labflow-cli-'))
  writeProject(makeExperiment())
  // 仓库里必须真有「E1」这根试剂：第 7 条起「源试管引用的试剂找不到」会报 warehouse_ref_missing，
  // 空仓库的夹具会让「没问题的工程」那条变成有问题的工程
  fs.writeFileSync(
    path.join(root, '仓库.yml'),
    toWarehouseYml({ groups: [], reagents: [makeExperiment().tubes[0]] }),
    'utf8'
  )
})

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    // 临时目录删不掉不影响测试结论
  }
})

function run(argv: string[]) {
  const args = parseArgv([...argv, '--root', root])
  switch (args.command) {
    case 'list':
      return commandList(args)
    case 'validate':
      return commandValidate(args)
    case 'calc':
      return commandCalc(args)
    case 'diff':
      return commandDiff(args)
    case 'export':
      return commandExport(args)
    case 'lock':
      return commandLock({ ...args, positionals: ['lock', ...args.positionals] })
    case 'unlock':
      return commandLock({ ...args, positionals: ['unlock', ...args.positionals] })
    case 'status':
      return commandLock({ ...args, positionals: ['status', ...args.positionals] })
    default:
      throw new Error(`测试里没接这个命令：${args.command}`)
  }
}

// ------------------------------------------------------------------ list

describe('cli list', () => {
  it('列出工程名、管数、连线数', () => {
    const result = run(['list'])
    expect(result.code).toBe(0)
    expect(result.text).toContain('演示工程')
    expect(result.text).toContain('3 支试管 / 2 条连线')
  })

  it('--json 给数组', () => {
    const result = run(['list', '--json'])
    const json = result.json as { projects: { name: string; tubes: number }[] }
    expect(Array.isArray(json.projects)).toBe(true)
    expect(json.projects[0].name).toBe('演示工程')
    expect(json.projects[0].tubes).toBe(3)
  })

  it('上锁后列表带锁标记', () => {
    run(['lock', '--project', '演示工程'])
    const result = run(['list'])
    expect(result.text).toContain('🔒')
    run(['unlock'])
  })
})

// ------------------------------------------------------------------ validate

describe('cli validate', () => {
  it('没问题的工程退出码 0', () => {
    const result = run(['validate', '演示工程'])
    expect(result.code).toBe(0)
    expect(result.text).toContain('没有发现问题')
  })

  it('把浓度改成 0 → 退出码 1、错误码 zero_concentration、指出哪根管', () => {
    const broken = makeExperiment()
    broken.tubes = broken.tubes.map(item =>
      item.id === 'mid-10e1' ? { ...item, substances: [{ name: 'E1', concentration: 0, concentrationUnit: 'μM' }] } : item
    )
    writeProject(broken, '坏工程')

    const result = run(['validate', '坏工程'])
    expect(result.code).toBe(1)
    expect(result.text).toContain('[zero_concentration]')
    expect(result.text).toContain('管「10E1」')
  })

  it('--json 给结构化 issues', () => {
    const result = run(['validate', '坏工程', '--json'])
    const json = result.json as { ok: boolean; issues: { code: string; tubeName: string }[] }
    expect(json.ok).toBe(false)
    expect(json.issues[0].code).toBe('zero_concentration')
    expect(json.issues[0].tubeName).toBe('10E1')
  })

  it('找不到的工程退出码 1', () => {
    const result = run(['validate', '根本没有这个工程'])
    expect(result.code).toBe(1)
    expect(result.text).toContain('找不到工程')
  })

  it('缺工程参数退出码 2', () => {
    expect(run(['validate']).code).toBe(2)
  })
})

// ------------------------------------------------------------------ calc

describe('cli calc', () => {
  it('中间产物：体积按入边合计（含缓冲液）、浓度按稀释算', () => {
    const result = run(['calc', '演示工程', '--tube', '10E1'])
    expect(result.code).toBe(0)
    expect(result.text).toContain('体积 50 μL')
    expect(result.text).toContain('E1 10 μM')
  })

  it('源试管给出仓库余量与预计剩余', () => {
    const result = run(['calc', '演示工程', '--tube', 'E1'])
    expect(result.text).toContain('仓库余量 20 μL')
    expect(result.text).toContain('预计剩余 15 μL')
  })

  it('1 M 母液按好读单位写', () => {
    const big = makeExperiment()
    big.tubes = big.tubes.map(item =>
      item.id === 'src-e1'
        ? { ...item, substances: [{ name: 'Mg', concentration: 1, concentrationUnit: 'M' }] }
        : item
    )
    writeProject(big, '大浓度')
    const result = run(['calc', '大浓度', '--tube', 'E1'])
    expect(result.text).toContain('Mg 1 M')
  })

  it('--json 给结构化试管', () => {
    const result = run(['calc', '演示工程', '--json'])
    const json = result.json as { tubes: { name: string; volume: number }[] }
    expect(json.tubes.length).toBe(3)
    expect(json.tubes.find(item => item.name === '10E1')?.volume).toBe(50)
  })
})

// ------------------------------------------------------------------ diff

describe('cli diff', () => {
  it('没有差异', () => {
    const result = run(['diff', '演示工程', '演示工程'])
    expect(result.code).toBe(0)
    expect(result.text).toContain('没有差异')
  })

  it('浓度变了能精确指出来', () => {
    const changed = makeExperiment()
    changed.tubes = changed.tubes.map(item =>
      item.id === 'mid-10e1' ? { ...item, substances: [{ name: 'E1', concentration: 25, concentrationUnit: 'μM' }] } : item
    )
    writeProject(changed, '改浓度')
    const result = run(['diff', '演示工程', '改浓度'])
    expect(result.text).toContain('浓度变了：10E1 E1 10 μM → 25 μM')
  })

  it('体积变了能指出来', () => {
    const changed = makeExperiment()
    changed.tubes = changed.tubes.map(item => (item.id === 'mid-10e1' ? { ...item, totalVolume: 60 } : item))
    writeProject(changed, '改体积')
    expect(run(['diff', '演示工程', '改体积']).text).toContain('体积变了：10E1 50 μL → 60 μL')
  })

  it('只在一边的试管也列出来', () => {
    const changed = makeExperiment()
    changed.tubes = [...changed.tubes, tube({ id: 'mid-extra', name: '多余管', type: 'intermediate' })]
    writeProject(changed, '多一管')
    const result = run(['diff', '演示工程', '多一管'])
    expect(result.text).toContain('只在 B：多余管')
  })

  it('--json 三类差异都在结构里', () => {
    const result = run(['diff', '演示工程', '改浓度', '--json'])
    const json = result.json as { same: boolean; concentrationChanges: unknown[] }
    expect(json.same).toBe(false)
    expect(json.concentrationChanges.length).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------------ export

describe('cli export', () => {
  it('默认只写请求的文件：--sop 只写 SOP', () => {
    const outDir = path.join(root, '导出A')
    const result = run(['export', '演示工程', '--sop', '--out', outDir])
    expect(result.code).toBe(0)
    const files = fs.readdirSync(outDir)
    expect(files).toEqual(['演示工程-SOP.md'])
    expect(fs.readFileSync(path.join(outDir, files[0]), 'utf8')).toContain('操作步骤')
  })

  it('--yml 只写 yml，且内容是合法正本', () => {
    const outDir = path.join(root, '导出B')
    run(['export', '演示工程', '--yml', '--out', outDir])
    const files = fs.readdirSync(outDir)
    expect(files).toEqual(['演示工程.yml'])
    expect(fs.readFileSync(path.join(outDir, files[0]), 'utf8')).toContain('schemaVersion: 2')
  })

  it('都不给时两个都写', () => {
    const outDir = path.join(root, '导出C')
    run(['export', '演示工程', '--out', outDir])
    expect(fs.readdirSync(outDir).sort()).toEqual(['演示工程-SOP.md', '演示工程.yml'])
  })

  it('--png 提示要用界面并返回 1', () => {
    const result = run(['export', '演示工程', '--png', '--out', path.join(root, '导出D')])
    expect(result.code).toBe(1)
    expect(result.text).toContain('LabFlow 界面')
  })
})

// ------------------------------------------------------------------ lock

describe('cli lock', () => {
  it('lock → status → unlock 三步走', () => {
    expect(run(['lock', '--project', '演示工程', '--note', '改浓度']).code).toBe(0)
    const status = run(['status', '--json'])
    const json = status.json as { lock: { project: string; note: string } }
    expect(json.lock.project).toBe('演示工程')
    expect(json.lock.note).toBe('改浓度')

    expect(run(['unlock']).code).toBe(0)
    expect((run(['status']).text as string)).toContain('没有锁')
  })

  it('--minutes 16 造出「可能忘记解锁了」', () => {
    run(['lock', '--project', '演示工程', '--minutes', '16'])
    expect(run(['status']).text).toContain('可能忘记解锁了')
    run(['unlock'])
  })

  it('缺 --project 返回 2', () => {
    expect(run(['lock']).code).toBe(2)
  })
})

// ------------------------------------------------------------------ complete（第 4 步结算）

describe('CLI：complete 结算', () => {
  function setupSettleProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labflow-complete-'))
    const projectDir = path.join(dir, '工程')
    fs.mkdirSync(projectDir, { recursive: true })

    const source = tube({
      id: 'mg',
      name: '1M Mg',
      type: 'source',
      totalVolume: 100,
      remainingVolume: 100,
      substances: [{ name: 'Mg', concentration: 1000, concentrationUnit: 'mM' }]
    })
    const target = tube({ id: 't5', name: '260910-Tube 5', type: 'intermediate', totalVolume: 0, remainingVolume: 0 })
    const experiment = makeExperiment({
      id: 'exp-settle',
      name: '结算演示',
      tubes: [source, target],
      connections: [connection('mg', 't5', 15)]
    })

    const projectPath = path.join(projectDir, '结算演示.yml')
    fs.writeFileSync(projectPath, projectFileText(experiment), 'utf8')
    const warehousePath = path.join(dir, '仓库.yml')
    fs.writeFileSync(warehousePath, toWarehouseYml({ groups: [], reagents: [source] }), 'utf8')
    return { dir, projectPath, warehousePath, experiment, source }
  }

  it('默认只算不写：mtime 不变，输出 before → after', () => {
    const { dir, projectPath, warehousePath } = setupSettleProject()
    const before = { p: fs.statSync(projectPath).mtimeMs, w: fs.statSync(warehousePath).mtimeMs }

    const result = runWithRoot(['complete', '结算演示'], dir)
    expect(result.code).toBe(0)
    expect(result.text).toContain('结算预览（未写任何文件）')
    expect(result.text).toContain('1M Mg：100 μL → 85 μL（扣 15 μL）')

    expect(fs.statSync(projectPath).mtimeMs).toBe(before.p)
    expect(fs.statSync(warehousePath).mtimeMs).toBe(before.w)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('--apply 才写：仓库余量 100 → 85，工程 status 变 completed', () => {
    const { dir, projectPath, warehousePath } = setupSettleProject()

    const result = runWithRoot(['complete', '结算演示', '--apply'], dir)
    expect(result.code).toBe(0)
    expect(result.text).toContain('已结算：结算演示')

    const warehouseYml = fs.readFileSync(warehousePath, 'utf8')
    expect(warehouseYml).toContain('1M Mg')
    expect(warehouseYml).toContain('85 μL')

    const projectYml = fs.readFileSync(projectPath, 'utf8')
    expect(projectYml).toContain('status: completed')
    expect(projectYml).toContain('260910-Tube 5')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('--json 输出的 usage 与 core settleExperiment 逐字段一致', () => {
    const { dir } = setupSettleProject()
    const result = runWithRoot(['complete', '结算演示', '--json'], dir)
    const payload = result.json as any
    expect(payload.usage[0]).toEqual(
      expect.objectContaining({ reagentId: 'mg', name: '1M Mg', used: 15, before: 100, after: 85, depleted: false })
    )
    expect(payload.created.map((c: any) => c.name)).toContain('260910-Tube 5')
    expect(payload.applied).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

function runWithRoot(argv: string[], dataRoot: string) {
  const args = parseArgv([...argv, '--root', dataRoot])
  if (args.command === 'complete') return commandComplete(args)
  throw new Error(`测试里没接这个命令：${args.command}`)
}
