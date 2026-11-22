import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings } from '../../src/core/exporters/settings'
import type { ProjectInput } from '../../src/core/exporters/types'
import { runProjectExport } from '../../src/renderer/src/utils/projectExport'
import { fixtures } from '../helpers/fixtures'
import { fixtureInput } from '../helpers/projectInput'

const experimental = fixtures.find(f => f.name.includes('261118-实际实验'))!
const input: ProjectInput = fixtureInput(experimental)
// 第 1 步新默认：数据/白板默认关；这些用例测的是开关组合，所以显式全开
const settings = normalizeExportSettings({
  ...DEFAULT_EXPORT_SETTINGS,
  directory: 'D:/tmp/labflow-export-img',
  exportDataFile: true,
  exportCanvasFile: true
})

function okExport() {
  return vi.fn(async (payload: { files: { name: string; content: string; encoding?: string }[] }) => ({
    success: true,
    directory: 'D:/tmp/labflow-export-img',
    files: payload.files.map(file => file.name)
  }))
}

describe('导出图片 = 看板真实截图', () => {
  it('截图成功：PNG 走 base64，和 .yml/.canvas/.md 同一批写出', async () => {
    const api = okExport()
    const seen: string[] = []
    await runProjectExport({
      input,
      settings,
      deps: {
        exportProject: api as never,
        capture: async id => {
          seen.push(id)
          return 'PNGDATA'
        }
      }
    })
    const payload = api.mock.calls[0][0] as { files: { name: string; content: string; encoding?: string }[] }
    const png = payload.files.find(file => file.name.endsWith('.png'))!
    expect(seen).toEqual([input.id])
    expect(png.encoding).toBe('base64')
    expect(png.content).toBe('PNGDATA')
  })

  it('看板没打开这个工程：不写 PNG，其余照写，并带回 imageSkipped', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input,
      settings,
      deps: { exportProject: api as never, capture: async () => null }
    })
    const payload = api.mock.calls[0][0] as { files: { name: string }[] }
    expect(outcome.ok).toBe(true)
    expect(outcome.imageSkipped).toBe('board-not-open')
    expect(payload.files.map(file => file.name)).toEqual([
      '261118-实际实验.yml',
      '261118-实际实验.canvas',
      '261118-实际实验.md'
    ])
  })

  it('截图抛错也不影响数据文件', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input,
      settings,
      deps: {
        exportProject: api as never,
        capture: async () => {
          throw new Error('capturePage 挂了')
        }
      }
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.imageSkipped).toBe('board-not-open')
  })

  it('工程没有 id 时直接跳过截图（不知道截哪张板）', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input: { ...input, id: undefined },
      settings,
      deps: { exportProject: api as never, capture: async () => 'PNGDATA' }
    })
    expect(outcome.imageSkipped).toBe('board-not-open')
  })

  it('关掉图片开关就完全不截图（连 capture 都不调）', async () => {
    const api = okExport()
    const capture = vi.fn(async () => 'PNGDATA')
    await runProjectExport({
      input,
      settings: { ...settings, exportImage: false },
      deps: { exportProject: api as never, capture }
    })
    expect(capture).not.toHaveBeenCalled()
  })
})
