/**
 * CLI 侧的四道闸门（第 1、2、3、7 条）。
 *
 * - 第 2 条：`unlock` 要校验三元组，不是自己的锁只提示、不删；`--force` 才真删。
 * - 第 3 条：`complete --apply` 写盘前按内容哈希校验两份正本，冲突就一个文件都不写。
 * - 第 1 条：工程被 Agent 锁着时 `complete --apply` 拒绝写入（退出码 1 + 中文原因）。
 * - 第 7 条：源试管引用的试剂在仓库里找不到 → 拒绝结算，并列出是哪几管。
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseArgv } from '../../src/cli/args'
import { commandComplete, commandLock } from '../../src/cli/commands'
import { projectFileText } from '../../src/core/store/projectFile'
import { toWarehouseYml } from '../../src/core/store/warehouseFile'
import type { Experiment, TransferConnection, Tube } from '../../src/core/schema'

/**
 * 造「读到 A、写之前被人改成 B」的时序：CLI 是一次进程跑完的，
 * 中间那段窗口只能靠钩子插进去。statFile 在 write 阶段会被再调一次做冲突判定，
 * 钩子里就在那一刻把文件替换掉——真实场景就是「Agent 正在结算，主人在编辑器里存了一下」。
 */
const hooks = vi.hoisted(() => ({
  onStat: undefined as undefined | ((file: string) => void)
}))

vi.mock('../../electron/dataRoot', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/dataRoot')>()
  return {
    ...actual,
    statFile: (file: string) => {
      hooks.onStat?.(file)
      return actual.statFile(file)
    }
  }
})

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

function makeSource(over: Partial<Tube> = {}): Tube {
  return tube({
    id: 'e1',
    name: 'E1',
    type: 'source',
    totalVolume: 100,
    remainingVolume: 100,
    substances: [{ name: 'E1', concentration: 100, concentrationUnit: 'μM' }],
    ...over
  })
}

function makeExperiment(over: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-guard',
    name: '闸门工程',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    status: 'draft',
    tubes: [
      makeSource(),
      tube({ id: 't-1', name: '260910-Tube 1', type: 'intermediate', totalVolume: 0, remainingVolume: 0 })
    ],
    tubePositions: [],
    connections: [connection('e1', 't-1', 5)],
    ...over
  }
}

let root = ''

function setupRoot(experiment = makeExperiment(), warehouseReagents: Tube[] = [makeSource()]): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'labflow-guards-'))
  fs.mkdirSync(path.join(root, '工程'), { recursive: true })
  fs.writeFileSync(path.join(root, '工程', `${experiment.name}.yml`), projectFileText(experiment), 'utf8')
  fs.writeFileSync(path.join(root, '仓库.yml'), toWarehouseYml({ groups: [], reagents: warehouseReagents }), 'utf8')
  return root
}

const warehousePath = (): string => path.join(root, '仓库.yml')
const projectPath = (): string => path.join(root, '工程', '闸门工程.yml')
const lockFile = (): string => path.join(root, '.agent-lock')

function complete(argv: string[]) {
  return commandComplete(parseArgv([...argv, '--root', root]))
}

/** 和 src/cli/index.ts 一样：把子命令塞进 positionals[0] */
function lock(argv: string[]) {
  const args = parseArgv([...argv, '--root', root])
  return commandLock({ ...args, positionals: [args.command, ...args.positionals] })
}

beforeEach(() => {
  root = ''
  hooks.onStat = undefined
})

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = ''
})

describe('unlock：校验不过就不许删（第 2 条）', () => {
  it('用别人的 agent 身份解锁 → 退出码 1、锁文件仍在、提示锁属于谁', () => {
    setupRoot()
    expect(lock(['lock', '--project', '闸门工程', '--agent', 'codex/墨林']).code).toBe(0)
    expect(fs.existsSync(lockFile())).toBe(true)

    const result = lock(['unlock', '--agent', 'codex/别人'])
    expect(result.code).toBe(1)
    expect(result.text).toContain('锁属于')
    expect(result.text).toContain('codex/墨林')
    expect(result.text).toContain('未删除')
    expect(result.text).toContain('--force')
    expect(fs.existsSync(lockFile())).toBe(true)
  })

  it('--json 里能看出是被拒的（ok:false, released:false）', () => {
    setupRoot()
    lock(['lock', '--project', '闸门工程', '--agent', 'codex/墨林'])

    const result = lock(['unlock', '--agent', 'codex/别人', '--json'])
    const payload = result.json as { ok: boolean; released: boolean; reason: string }
    expect(result.code).toBe(1)
    expect(payload.ok).toBe(false)
    expect(payload.released).toBe(false)
    expect(payload.reason).toContain('未删除')
    expect(fs.existsSync(lockFile())).toBe(true)
  })

  it('带上 --force：明知不是自己的锁也删掉', () => {
    setupRoot()
    lock(['lock', '--project', '闸门工程', '--agent', 'codex/墨林'])

    const result = lock(['unlock', '--agent', 'codex/别人', '--force'])
    expect(result.code).toBe(0)
    expect(result.text).toContain('已解锁')
    expect(fs.existsSync(lockFile())).toBe(false)
  })

  /**
   * 必修 2：以前这里是「同 pid + 同 agent 就能解」——同进程跑的，属于假通过。
   * 真实使用里 unlock 是**另一个进程**，pid 必然不同，所以永远解不掉自己的锁。
   * 现在锁里带一个与进程无关的 owner 凭据：显式传 caller（只带 owner、不带 pid）才代表「跨进程」。
   */
  it('自己的锁（同 owner 凭据，模拟换了个进程）→ 不带 --force 也能解', () => {
    setupRoot()
    const created = lock(['lock', '--project', '闸门工程', '--agent', 'codex/墨林', '--json'])
    const owner = (created.json as { lock: { owner: string } }).lock.owner
    expect(owner).toMatch(/^owner-[0-9a-f]{8}$/)

    // 只带 owner 凭据：pid 是「加锁那次进程」的，这里根本不指望它相等
    expect(lock(['unlock', '--agent', 'codex/墨林', '--owner', owner]).code).toBe(0)
    expect(fs.existsSync(lockFile())).toBe(false)
  })

  it('别的 agent 拿着自己的 owner 凭据 → 解不掉（跨 owner 不可互删）', () => {
    setupRoot()
    lock(['lock', '--project', '闸门工程', '--agent', 'codex/墨林'])

    const result = lock(['unlock', '--agent', 'codex/别人', '--owner', 'owner-deadbeef'])
    expect(result.code).toBe(1)
    expect(result.text).toContain('owner 凭据对不上')
    expect(result.text).toContain('--force')
    expect(fs.existsSync(lockFile())).toBe(true)
  })

  it('不认凭据也不 --force → 拒绝，并把这把锁的 owner 说出来（以前只报 pid 不一致）', () => {
    setupRoot()
    const created = lock(['lock', '--project', '闸门工程', '--agent', 'codex/墨林', '--json'])
    const owner = (created.json as { lock: { owner: string } }).lock.owner

    const result = lock(['unlock', '--agent', 'codex/墨林'])
    expect(result.code).toBe(1)
    expect(result.text).toContain(owner)
    expect(fs.existsSync(lockFile())).toBe(true)
  })
})

describe('complete --apply：外部改过就一个文件都不写（第 3 条）', () => {
  it('读到之后 仓库.yml 被外部改了 → 退出码 1、两份文件都不动', () => {
    setupRoot()
    const projectBefore = fs.readFileSync(projectPath(), 'utf8')
    const external = `${toWarehouseYml({ groups: [], reagents: [makeSource({ remainingVolume: 42 })] })}# 主人刚在编辑器里存的\n`

    // 第一次 statFile(仓库.yml) 是读入阶段，第二次是写盘前的冲突判定 —— 在第二次之前替换文件
    let seen = 0
    hooks.onStat = file => {
      if (!file.endsWith('仓库.yml')) return
      seen += 1
      if (seen === 2) fs.writeFileSync(file, external, 'utf8')
    }

    const result = complete(['complete', '闸门工程', '--apply'])

    expect(seen).toBe(2)
    expect(result.code).toBe(1)
    expect(result.text).toContain('已被外部修改')
    expect(result.text).toContain('一个文件都没写')
    expect(result.text).toContain('仓库.yml')
    // 仓库保持外部内容，工程正本一个字没动
    expect(fs.readFileSync(warehousePath(), 'utf8')).toBe(external)
    expect(fs.readFileSync(projectPath(), 'utf8')).toBe(projectBefore)
    expect(fs.readFileSync(projectPath(), 'utf8')).not.toContain('status: completed')
  })

  it('--json 里 conflict:true、wroteWarehouse / wroteProject 都是 false', () => {
    setupRoot()
    const external = `${toWarehouseYml({ groups: [], reagents: [makeSource({ remainingVolume: 42 })] })}# 外部改的\n`
    let seen = 0
    hooks.onStat = file => {
      if (!file.endsWith('仓库.yml')) return
      seen += 1
      if (seen === 2) fs.writeFileSync(file, external, 'utf8')
    }

    const result = complete(['complete', '闸门工程', '--apply', '--json'])
    const payload = result.json as {
      ok: boolean
      conflict?: boolean
      conflicts?: string[]
      wroteWarehouse?: boolean
      wroteProject?: boolean
    }
    expect(result.code).toBe(1)
    expect(payload.ok).toBe(false)
    expect(payload.conflict).toBe(true)
    expect(payload.wroteWarehouse).toBe(false)
    expect(payload.wroteProject).toBe(false)
    expect(payload.conflicts).toContain('仓库.yml')
  })

  it('没人动过文件 → 照常写（证明上面那条不是钩子自己造的假）', () => {
    setupRoot()
    hooks.onStat = () => {}

    const result = complete(['complete', '闸门工程', '--apply'])
    expect(result.code).toBe(0)
    expect(fs.readFileSync(projectPath(), 'utf8')).toContain('status: completed')
    expect(fs.readFileSync(warehousePath(), 'utf8')).toContain('95 μL')
  })
})

describe('complete --apply：工程被锁着就不写（第 1 条）', () => {
  it('退出码 1、提示「正被 Agent 锁着」，两份文件 mtime 不变', () => {
    setupRoot()
    lock(['lock', '--project', '闸门工程'])
    const before = { w: fs.statSync(warehousePath()).mtimeMs, p: fs.statSync(projectPath()).mtimeMs }

    const result = complete(['complete', '闸门工程', '--apply'])
    expect(result.code).toBe(1)
    expect(result.text).toContain('正被 Agent 锁着')
    expect(result.text).toContain('一个文件都没改')

    expect(fs.statSync(warehousePath()).mtimeMs).toBe(before.w)
    expect(fs.statSync(projectPath()).mtimeMs).toBe(before.p)
    expect(fs.readFileSync(projectPath(), 'utf8')).not.toContain('status: completed')
  })

  it('--json 里 locked:true，并指认锁的主人', () => {
    setupRoot()
    lock(['lock', '--project', '闸门工程'])
    const result = complete(['complete', '闸门工程', '--apply', '--json'])
    const payload = result.json as { ok: boolean; locked?: boolean; holder?: string }
    expect(result.code).toBe(1)
    expect(payload.ok).toBe(false)
    expect(payload.locked).toBe(true)
    expect(payload.holder).toContain('codex/墨林')
  })

  /** 必修 2：Agent 上锁 → 自己跑 complete --apply，以前一定被自己的锁挡住 */
  it('锁是自己上的（带 owner 凭据）→ 放行，正常结算', () => {
    setupRoot()
    const created = lock(['lock', '--project', '闸门工程', '--agent', 'codex/墨林', '--json'])
    const owner = (created.json as { lock: { owner: string } }).lock.owner

    const result = complete(['complete', '闸门工程', '--apply', '--owner', owner])
    expect(result.code).toBe(0)
    expect(fs.readFileSync(projectPath(), 'utf8')).toContain('status: completed')
  })

  it('锁是别人上的（owner 对不上）→ 照样挡住', () => {
    setupRoot()
    lock(['lock', '--project', '闸门工程', '--agent', 'codex/别人'])
    const before = fs.statSync(warehousePath()).mtimeMs

    const result = complete(['complete', '闸门工程', '--apply', '--owner', 'owner-deadbeef'])
    expect(result.code).toBe(1)
    expect(result.text).toContain('正被 Agent 锁着')
    expect(fs.statSync(warehousePath()).mtimeMs).toBe(before)
  })
})

describe('complete：引用缺失就拒绝结算（第 7 条）', () => {
  it('源试管引用的试剂不在仓库 → 退出码 1、列出管名，什么都不写', () => {
    // 仓库里换成另一根试剂，画布引用的 e1 找不到
    setupRoot(makeExperiment(), [makeSource({ id: 'e2', name: 'E2' })])
    const before = fs.readFileSync(warehousePath(), 'utf8')

    const result = complete(['complete', '闸门工程', '--apply'])
    expect(result.code).toBe(1)
    expect(result.text).toContain('拒绝结算')
    expect(result.text).toContain('「E1」')
    expect(result.text).toContain('e1')
    expect(fs.readFileSync(warehousePath(), 'utf8')).toBe(before)
  })

  it('--json 里 missingRefs 带 id 与名字', () => {
    setupRoot(makeExperiment(), [makeSource({ id: 'e2', name: 'E2' })])
    const result = complete(['complete', '闸门工程', '--json'])
    const payload = result.json as { ok: boolean; missingRefs: { id: string; name: string }[] }
    expect(result.code).toBe(1)
    expect(payload.ok).toBe(false)
    expect(payload.missingRefs).toEqual([{ id: 'e1', name: 'E1' }])
  })
})
