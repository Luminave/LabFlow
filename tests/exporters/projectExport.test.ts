import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildExportBundle } from '../../src/core/exporters'
import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings } from '../../src/core/exporters/settings'
import type { ProjectInput } from '../../src/core/exporters/types'
import { isExportInFlight, runProjectExport } from '../../src/renderer/src/utils/projectExport'
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

function okExport(files?: string[]) {
  return vi.fn(async (payload: { files: { name: string; content: string; encoding?: string }[] }) => ({
    success: true,
    directory: 'D:/tmp/labflow-export-img',
    files: files ?? payload.files.map(file => file.name)
  }))
}

describe('导出总入口（三件套 + 可选 PNG）', () => {
  beforeEach(() => {
    // 明确每次从「不在导出中」开始
    expect(isExportInFlight()).toBe(false)
  })

  it('三个开关都开：yml + canvas + md + png', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input,
      settings,
      deps: { exportProject: api as never, capture: async () => 'BASE64' }
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.count).toBe(4)
    const payload = api.mock.calls[0][0] as { files: { name: string; encoding?: string }[] }
    expect(payload.files.map(f => f.name)).toEqual([
      '261118-实际实验.yml',
      '261118-实际实验.canvas',
      '261118-实际实验.md',
      '261118-实际实验.png'
    ])
    // PNG 按 base64 写，其它按 utf8
    expect(payload.files.find(f => f.name.endsWith('.png'))!.encoding).toBe('base64')
    expect(payload.files.filter(f => !f.name.endsWith('.png')).every(f => f.encoding === undefined)).toBe(true)
  })

  it('关掉白板：不写 .canvas，其余照写', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input,
      settings: { ...settings, exportCanvasFile: false },
      deps: { exportProject: api as never, capture: async () => 'BASE64' }
    })
    const payload = api.mock.calls[0][0] as { files: { name: string }[] }
    expect(outcome.ok).toBe(true)
    expect(payload.files.map(f => f.name)).toEqual([
      '261118-实际实验.yml',
      '261118-实际实验.md',
      '261118-实际实验.png'
    ])
  })

  it('关掉图片：不写 .png', async () => {
    const api = okExport()
    await runProjectExport({
      input,
      settings: { ...settings, exportImage: false },
      deps: { exportProject: api as never, capture: async () => 'BASE64' }
    })
    const payload = api.mock.calls[0][0] as { files: { name: string }[] }
    expect(payload.files.some(f => f.name.endsWith('.png'))).toBe(false)
  })

  it('画图失败时 .yml/.md 照常写入（PNG 掉队不影响数据）', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input,
      settings,
      deps: {
        exportProject: api as never,
        capture: async () => {
          throw new Error('截图挂了')
        }
      }
    })
    const payload = api.mock.calls[0][0] as { files: { name: string }[] }
    expect(outcome.ok).toBe(true)
    expect(payload.files.map(f => f.name)).toEqual([
      '261118-实际实验.yml',
      '261118-实际实验.canvas',
      '261118-实际实验.md'
    ])
  })

  it('自动导出且目录为空：不调主进程、返回 no-directory', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input,
      settings: { ...settings, directory: '' },
      auto: true,
      deps: { exportProject: api as never, capture: async () => 'BASE64' }
    })
    expect(outcome.skipped).toBe('no-directory')
    expect(api).not.toHaveBeenCalled()
  })

  it('手动导出且目录为空：仍走主进程（由它弹选择框）', async () => {
    const api = okExport()
    const outcome = await runProjectExport({
      input,
      settings: { ...settings, directory: '' },
      deps: { exportProject: api as never, capture: async () => 'BASE64' }
    })
    expect(outcome.ok).toBe(true)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('防重入：上一轮没写完时，第二次直接返回 busy，不会并发写同一批文件', async () => {
    let release: (value: { success: boolean; directory: string; files: string[] }) => void = () => {}
    const pending = new Promise<{ success: boolean; directory: string; files: string[] }>(resolve => {
      release = resolve
    })
    const api = vi.fn(() => pending)

    const first = runProjectExport({
      input,
      settings,
      deps: { exportProject: api as never, capture: async () => 'BASE64' }
    })
    expect(isExportInFlight()).toBe(true)

    const second = await runProjectExport({
      input,
      settings,
      deps: { exportProject: api as never, capture: async () => 'BASE64' }
    })
    expect(second.skipped).toBe('busy')
    expect(api).toHaveBeenCalledTimes(1)

    release({ success: true, directory: 'D:/tmp', files: ['a'] })
    const firstOutcome = await first
    expect(firstOutcome.ok).toBe(true)
    expect(isExportInFlight()).toBe(false)
  })

  it('连点两次保存（串行）：只产生两轮写盘，且每轮都完整', async () => {
    const api = okExport()
    const deps = { exportProject: api as never, capture: async () => 'BASE64' }
    await runProjectExport({ input, settings, auto: true, deps })
    await runProjectExport({ input, settings, auto: true, deps })
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('主进程返回失败时把原因带回来', async () => {
    const outcome = await runProjectExport({
      input,
      settings,
      deps: {
        exportProject: (async () => ({ success: false, error: '目录不可写' })) as never,
        capture: async () => 'BASE64'
      }
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('目录不可写')
  })

  it('用户取消选择目录', async () => {
    const outcome = await runProjectExport({
      input,
      settings: { ...settings, directory: '' },
      deps: {
        exportProject: (async () => ({ success: false, canceled: true })) as never,
        capture: async () => 'BASE64'
      }
    })
    expect(outcome.canceled).toBe(true)
  })
})

describe('buildExportBundle 的开关与计数', () => {
  it('白板开、图片开：3 个文本文件 + 1 张图', () => {
    const bundle = buildExportBundle(input, settings)
    expect(bundle.files.map(f => f.name)).toHaveLength(3)
    expect(bundle.expectedCount).toBe(4)
  })

  it('白板关：2 个文本文件，expectedCount 跟着少 1', () => {
    const bundle = buildExportBundle(input, { ...settings, exportCanvasFile: false })
    expect(bundle.files.map(f => f.name)).toEqual(['261118-实际实验.yml', '261118-实际实验.md'])
    expect(bundle.expectedCount).toBe(3)
  })

  it('图片关：expectedCount 不含 PNG', () => {
    const bundle = buildExportBundle(input, { ...settings, exportImage: false })
    expect(bundle.expectedCount).toBe(3)
  })

  it('子文件夹开着时文件名只用工程名（含 .png）', () => {
    const bundle = buildExportBundle(input, { ...settings, autoSubfolder: true })
    expect(bundle.subfolder).toBe('261118-实际实验')
    expect(bundle.files[0].name).toBe('261118-实际实验.yml')
  })
})
