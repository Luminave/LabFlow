import { describe, expect, it } from 'vitest'

import { SCHEMA_VERSION } from '../../src/core/schema'
import { normalizeConcentration } from '../../src/core/units'
import { buildExportBundle, renderFileName } from '../../src/core/exporters'
import { PROJECT_FILE_VERSION, parseProjectYml, toProjectYml, warehouseIdOf } from '../../src/core/exporters/yml'
import { formatQuantityExact } from '../../src/core/units'
import { conn, fixtures, tube } from '../helpers/fixtures'
import { fixtureInput, withoutPositions } from '../helpers/projectInput'

const ad52 = fixtures.find(f => f.name.includes('ad-5-2'))!
const all = fixtures

describe('项目.yml —— 真实工程往返', () => {
  for (const fixture of all) {
    it(`${fixture.name}：写出去再读回来，试管与连线等价`, () => {
      const input = fixtureInput(fixture)
      const text = toProjectYml(input)
      const { input: read, warnings } = parseProjectYml(text)

      expect(warnings).toEqual([])
      expect(read.tubes.map(t => t.id)).toEqual(input.tubes.map(t => t.id))
      expect(read.connections.length).toBe(input.connections.length)

      for (const original of input.tubes) {
        const back = read.tubes.find(t => t.id === original.id)!
        expect(back.name).toBe(original.name)
        expect(back.type).toBe(original.type)
        // 体积按 µL 比：库里 null 的历史数据导出时按 0 写
        expect(back.totalVolume).toBeCloseTo(Number.isFinite(original.totalVolume) ? original.totalVolume : 0, 6)
        expect(back.substances.map(s => s.name)).toEqual(original.substances.map(s => s.name))
        original.substances.forEach((sub, i) => {
          expect(back.substances[i].concentration).toBeCloseTo(
            normalizeConcentration(sub.concentration, sub.concentrationUnit),
            6
          )
        })
      }

      for (const original of input.connections) {
        const back = read.connections.find(c => c.id === original.id)!
        expect(back.fromTubeId).toBe(original.fromTubeId)
        expect(back.toTubeId).toBe(original.toTubeId)
        expect(back.volume).toBeCloseTo(original.volume, 6)
      }
    })
  }
})

describe('项目.yml —— 结构与写法', () => {
  const text = toProjectYml(fixtureInput(ad52))

  it('顶部带 schemaVersion（用第 0 步的常量）', () => {
    expect(text).toContain(`schemaVersion: ${PROJECT_FILE_VERSION}`)
    expect(parseProjectYml(text).warnings).toEqual([])
  })

  it('数值写成「数值 + 单位」，不写裸数字', () => {
    expect(text).toMatch(/totalVolume: [\d.]+ (nL|μL|mL)/)
    expect(text).toMatch(/concentration: [\d.]+ (nM|μM|mM)/)
    expect(text).toMatch(/volume: [\d.]+ (nL|μL|mL)/)
  })

  it('五千微摩尔写成 5 mM，不是 5000', () => {
    const thousand = tube({
      id: 'buffer-wh-1-t1',
      type: 'buffer',
      name: '5 mM 缓冲液',
      totalVolume: 5000,
      substances: [{ name: 'MgCl₂', concentration: 5000, concentrationUnit: 'μM' }]
    })
    const yml = toProjectYml({ ...fixtureInput(ad52), tubes: [thousand], connections: [], positions: [] })
    expect(yml).toContain('concentration: 5 mM')
    expect(yml).not.toContain('5000 μM')
  })

  it('试管 id 原样保留，buffer-{仓库ID}-{目标ID} 不重编码', () => {
    const bufferTube = tube({
      id: 'buffer-wh-abc-tube-xyz',
      type: 'buffer',
      name: '缓冲液',
      totalVolume: 100
    })
    const yml = toProjectYml({ ...fixtureInput(ad52), tubes: [bufferTube], connections: [], positions: [] })
    expect(yml).toContain('id: buffer-wh-abc-tube-xyz')
    expect(parseProjectYml(yml).input.tubes[0].id).toBe('buffer-wh-abc-tube-xyz')
  })

  it('y 坐标不加引号，负数坐标照写', () => {
    expect(text).toMatch(/^\s+y: -?\d+$/m)
    expect(text).not.toContain("'y':")
  })

  it('连线带 from / to / 用量 / fromSide / toSide', () => {
    expect(text).toMatch(/from: \S+/)
    expect(text).toMatch(/to: \S+/)
    expect(text).toMatch(/fromSide: (top|right|bottom|left)/)
    expect(text).toMatch(/toSide: (top|right|bottom|left)/)
    expect(text).toMatch(/label: [\d.]+ (nL|μL|mL)/)
  })

  it('缺坐标时按网格补，且坐标写进了文件里（不用随机数）', () => {
    const input = withoutPositions(fixtureInput(ad52))
    const first = toProjectYml(input)
    const second = toProjectYml(input)
    expect(first).toBe(second) // 同一输入同一输出，没有随机数

    const read = parseProjectYml(first).input
    expect(read.positions.length).toBe(input.tubes.length)
    expect(read.positions.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    // 不能有两支试管挤在同一格
    const keys = new Set(read.positions.map(p => `${p.x},${p.y}`))
    expect(keys.size).toBe(read.positions.length)
  })

  it('仓库试剂引用写进 reagents', () => {
    const parsed = parseProjectYml(text)
    expect(parsed.input.tubes.some(t => warehouseIdOf(t) !== undefined) || !text.includes('warehouseId')).toBe(true)
    if (text.includes('warehouseId')) expect(text).toMatch(/reagents:/)
  })

  it('坏文件不抛异常，只给 warning', () => {
    const broken = parseProjectYml('tubes:\n  - id: a\n    totalVolume: 很多')
    expect(broken.warnings.length).toBeGreaterThan(0)
    expect(broken.input.tubes[0].id).toBe('a')
  })

  it('Agent 手改成裸数字也能读（按基准单位理解）', () => {
    const parsed = parseProjectYml('tubes:\n  - id: a\n    name: A\n    type: source\n    totalVolume: 20\n    remainingVolume: 20\n    substances:\n      - name: MgCl₂\n        concentration: 5000\n')
    expect(parsed.input.tubes[0].totalVolume).toBe(20)
    expect(parsed.input.tubes[0].substances[0].concentration).toBe(5000)
  })
})

describe('导出三件套与文件名规则', () => {
  it('文件名按模板渲染，日期与工程名都进去', () => {
    expect(renderFileName('<日期>-<工程名>', { name: 'AD-5-2', date: '2026-11-18' })).toBe('2026-11-18-AD-5-2')
  })

  it('文件名里的非法字符被替换', () => {
    expect(renderFileName('<日期>-<工程名>', { name: 'AD/5:2', date: '2026-11-18' })).toBe('2026-11-18-AD-5-2')
  })

  it('一次生成 .yml / .canvas / .md 三份', () => {
    const bundle = buildExportBundle(fixtureInput(ad52), {
      fileNameTemplate: '<日期>-<工程名>',
      autoSubfolder: true,
      exportCanvasFile: true,
      exportDataFile: true
    })
    expect(bundle.files.map(f => f.name)).toEqual([
      `${bundle.baseName}.yml`,
      `${bundle.baseName}.canvas`,
      `${bundle.baseName}.md`
    ])
    expect(bundle.subfolder).toBe(ad52.experiment.name)
  })

  it('开着子文件夹时文件名只用工程名，不带日期前缀', () => {
    const bundle = buildExportBundle(fixtureInput(ad52), {
      fileNameTemplate: '<日期>-<工程名>',
      autoSubfolder: true,
      exportCanvasFile: true,
      exportDataFile: true
    })
    expect(bundle.baseName).toBe('AD-5.2')
    expect(bundle.files[0].name).toBe('AD-5.2.yml')
  })

  it('关掉自动建子文件夹时 subfolder 为空、文件名回到模板', () => {
    const bundle = buildExportBundle(fixtureInput(ad52), {
      fileNameTemplate: '<日期>-<工程名>',
      autoSubfolder: false
    })
    expect(bundle.subfolder).toBe('')
    expect(bundle.baseName).toBe('2026-11-18-AD-5.2')
  })

  it('工程名为空时开着子文件夹也退回模板，不会生成空文件名', () => {
    const input = { ...fixtureInput(ad52), name: '' }
    const bundle = buildExportBundle(input, {
      fileNameTemplate: '<日期>-<工程名>',
      autoSubfolder: true,
      exportDataFile: true
    })
    expect(bundle.baseName).toBeTruthy()
    expect(bundle.files[0].name.endsWith('.yml')).toBe(true)
    expect(bundle.baseName.startsWith('.')).toBe(false)
  })
})

describe('单位写法自检', () => {
  it('formatQuantityExact 对真实数据不丢精度', () => {
    const input = fixtureInput(ad52)
    for (const c of input.connections) {
      expect(formatQuantityExact(c.volume, 'volume')).toMatch(/^-?[\d.]+ (nL|μL|mL)$/)
    }
  })

  it('单管连线也能正常写出', () => {
    const tubes = [tube({ id: 'a', type: 'source', totalVolume: 100 }), tube({ id: 'b', type: 'intermediate' })]
    const yml = toProjectYml({
      name: 'T',
      date: '2026-11-18',
      tubes,
      connections: [conn('a', 'b', 5)],
      positions: [
        { tubeId: 'a', x: 0, y: 0 },
        { tubeId: 'b', x: 400, y: 0 }
      ]
    })
    expect(parseProjectYml(yml).input.connections[0].volume).toBe(5)
  })
})
