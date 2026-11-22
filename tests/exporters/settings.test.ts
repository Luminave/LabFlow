import { describe, expect, it } from 'vitest'

import { computeBounds, resolveLayout } from '../../src/core/exporters/layout'
import { toCanvasObject } from '../../src/core/exporters/canvas'
import { buildExportBundle } from '../../src/core/exporters/index'
import {
  DEFAULT_EXPORT_SETTINGS,
  normalizeExportSettings,
  normalizeScale,
  SCALE_MAX,
  SCALE_MIN
} from '../../src/core/exporters/settings'
import { fixtures } from '../helpers/fixtures'
import { fixtureInput } from '../helpers/projectInput'

const real = fixtures.find(f => f.name.includes('实际实验'))!

describe('导出设置：画布比例（横向/纵向倍数）', () => {
  it('默认值：不配置时是 1.6× / 1.6×（主人 2026-11-22 定）', () => {
    expect(DEFAULT_EXPORT_SETTINGS.scaleX).toBe(1.6)
    expect(DEFAULT_EXPORT_SETTINGS.scaleY).toBe(1.6)
    const settings = normalizeExportSettings({})
    expect(settings.scaleX).toBe(1.6)
    expect(settings.scaleY).toBe(1.6)
  })

  it('老配置缺比例字段时补齐成 1.6×，不报错', () => {
    const legacy = normalizeExportSettings({
      directory: 'D:\\exports',
      fileNameTemplate: '<工程名>',
      autoSubfolder: false
    })
    expect(legacy).toMatchObject({
      directory: 'D:\\exports',
      fileNameTemplate: '<工程名>',
      autoSubfolder: false,
      scaleX: 1.6,
      scaleY: 1.6
    })
    expect(normalizeExportSettings(null).scaleX).toBe(1.6)
    expect(normalizeExportSettings({ scaleX: 'abc' }).scaleX).toBe(1.6)
  })

  it('更老的像素净空配置换算成比例：160px / 100px = 1.0×', () => {
    expect(normalizeExportSettings({ spacingX: 160, spacingY: 100 }).scaleX).toBe(1)
    expect(normalizeExportSettings({ spacingX: 160, spacingY: 100 }).scaleY).toBe(1)
    // 320px 横向 = 2.0×
    expect(normalizeExportSettings({ spacingX: 320, spacingY: 200 }).scaleX).toBe(2)
    expect(normalizeExportSettings({ spacingX: 320, spacingY: 200 }).scaleY).toBe(2)
    // 新字段优先于旧字段
    expect(normalizeExportSettings({ scaleX: 3, spacingX: 320 }).scaleX).toBe(3)
  })

  it('边界值钳制：小于 0.5 抬到 0.5，大于 4 压到 4，并按 0.1 取整', () => {
    expect(normalizeScale(0.1, 1)).toBe(SCALE_MIN)
    expect(normalizeScale(0, 1)).toBe(SCALE_MIN)
    expect(normalizeScale(-3, 1)).toBe(SCALE_MIN)
    expect(normalizeScale(9, 1)).toBe(SCALE_MAX)
    expect(normalizeScale(4, 1)).toBe(4)
    expect(normalizeScale(1.66, 1)).toBe(1.7)
    expect(normalizeScale(undefined, 1)).toBe(1)
  })

  it('比例透传：包围盒随倍数单调变大，1.0× 时宽度等于白板原宽度', () => {
    const input = fixtureInput(real)
    const board = computeBounds(input.positions.map(p => ({ x: p.x, y: p.y, width: 0, height: 0 })))
    const byScale = [1, 2, 3].map(scale => computeBounds(toCanvasObject(input, { scaleX: scale, scaleY: scale }).nodes))
    expect(byScale[0].width).toBeLessThan(byScale[1].width)
    expect(byScale[1].width).toBeLessThan(byScale[2].width)
    // 1.0× 的坐标就是白板坐标，包围盒的偏移也应一致
    expect(byScale[0].minX).toBe(board.minX)
    expect(byScale[0].minY).toBe(board.minY)
  })

  it('导出三件套用配置里的比例，.yml 与 .canvas 坐标一致', () => {
    const input = fixtureInput(real)
    const bundle = buildExportBundle(input, {
      ...DEFAULT_EXPORT_SETTINGS,
      scaleX: 2,
      scaleY: 1.5,
      exportCanvasFile: true,
      exportDataFile: true
    })
    const canvas = bundle.files.find(file => file.name.endsWith('.canvas'))!
    const nodes = JSON.parse(canvas.content).nodes as { id: string; x: number; y: number }[]

    const layout = resolveLayout(input, { scaleX: 2, scaleY: 1.5 })
    for (const tube of layout.tubes) {
      const node = nodes.find(n => n.id === tube.tube.id)
      expect(node, `${tube.tube.name} 应出现在 canvas 里`).toBeTruthy()
      expect(node!.x).toBe(tube.x)
      expect(node!.y).toBe(tube.y)
    }
  })

  it('预计尺寸与实际导出包围盒一致（同一套 layout）', () => {
    for (const fixture of fixtures) {
      const input = fixtureInput(fixture)
      const scale = { scaleX: 1.8, scaleY: 1.2 }
      const expected = computeBounds(resolveLayout(input, scale).tubes)
      const actual = computeBounds(toCanvasObject(input, scale).nodes)
      expect(actual).toEqual(expected)
    }
  })
})
