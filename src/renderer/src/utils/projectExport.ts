/**
 * 渲染进程这一侧的导出总入口：讲述者页的「导出」按钮和实验模拟页的「保存后自动导出」都走这里。
 *
 * 这里做三件事：
 *   1. 用 `buildExportBundle` 算出文本文件（.yml / .md，必要时 .canvas）
 *   2. 需要的话用 canvas 现画一张流程图 PNG 一起带上
 *   3. 交给主进程 `export:project` 一次写完
 *
 * 自动导出要防重入：连点保存不该并发写同一批文件，所以用一个模块级标记挡住第二次。
 */

import {
  buildExportBundle,
  buildImageFileName,
  normalizeExportSettings,
  type ExportFile,
  type ExportSettings
} from '../../../core/exporters'
import type { ProjectInput } from '../../../core/exporters/types'
import { captureBoardPng } from './boardCapture'

export interface ExportOutcome {
  ok: boolean
  /** 用户取消选择目录 */
  canceled?: boolean
  /** 这次没导出的原因（都是给 toast 用的中文短句） */
  skipped?: 'no-directory' | 'busy' | 'no-api'
  /** 想要图片但没截到（看板没打开这个工程） */
  imageSkipped?: 'board-not-open'
  error?: string
  directory?: string
  /** 实际写出的文件数 */
  count?: number
  files?: string[]
}

/** 同一时刻只允许一轮导出（连点保存不会并发） */
let inFlight = false

export function isExportInFlight(): boolean {
  return inFlight
}

export interface RunExportOptions {
  input: ProjectInput
  settings: Partial<ExportSettings>
  /** 自动导出（保存触发）：目录为空就跳过，不弹选择框 */
  auto?: boolean
  /** 测试注入：截图与 IPC（默认用真实实现） */
  deps?: {
    /** 截图：给工程 id，返回 PNG 的 base64；截不到返回 null */
    capture?: (experimentId: string) => Promise<string | null>
    exportProject?: (payload: {
      directory?: string
      subfolder?: string
      files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]
    }) => Promise<{ success: boolean; canceled?: boolean; directory?: string; files?: string[]; error?: string }>
  }
}

export async function runProjectExport(options: RunExportOptions): Promise<ExportOutcome> {
  const config = normalizeExportSettings(options.settings)
  const api = options.deps?.exportProject ?? window.electronAPI?.exportProject
  const capture = options.deps?.capture ?? captureBoardPng

  if (options.auto && !config.directory.trim()) {
    return { ok: false, skipped: 'no-directory' }
  }
  if (!api) {
    return { ok: false, skipped: 'no-api' }
  }
  if (inFlight) {
    return { ok: false, skipped: 'busy' }
  }

  inFlight = true
  try {
    const bundle = buildExportBundle(options.input, config)
    const files: ExportFile[] = [...bundle.files]

    let imageSkipped: ExportOutcome['imageSkipped']
    if (config.exportImage) {
      // 截当前看板（实验模拟页）——和主人手动截图是同一张图；截不到不影响数据文件
      const experimentId = options.input.id
      let base64: string | null = null
      if (experimentId) {
        try {
          base64 = await capture(experimentId)
        } catch (error) {
          console.error('[Export] 看板截图失败，其余文件照常导出：', error)
        }
      }
      if (base64) {
        files.push({ name: buildImageFileName(bundle.baseName), content: base64, encoding: 'base64' })
      } else {
        imageSkipped = 'board-not-open'
      }
    }

    const result = await api({
      directory: config.directory,
      subfolder: bundle.subfolder,
      files: files.map(file => ({ name: file.name, content: file.content, encoding: file.encoding }))
    })

    if (result?.canceled) return { ok: false, canceled: true }
    if (!result?.success) return { ok: false, error: result?.error || '未知错误' }

    return {
      ok: true,
      directory: result.directory,
      count: result.files?.length ?? files.length,
      files: result.files,
      imageSkipped
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  } finally {
    inFlight = false
  }
}

/** 把结果转成一句人话（给 toast 用） */
export function describeExportOutcome(outcome: ExportOutcome, language: 'zh' | 'en' = 'zh'): string {
  const zh = language === 'zh'
  if (outcome.ok) {
    return zh ? `已导出 ${outcome.count} 个文件` : `Exported ${outcome.count} file(s)`
  }
  if (outcome.skipped === 'no-directory') return zh ? '未设置导出目录，未自动导出' : 'No export folder set — skipped'
  if (outcome.skipped === 'busy') return zh ? '上一次导出还没写完，已跳过' : 'Previous export still running — skipped'
  if (outcome.skipped === 'no-api') return zh ? '导出需要在桌面应用里使用' : 'Export requires the desktop app'
  if (outcome.canceled) return zh ? '已取消导出' : 'Export canceled'
  return zh ? `导出失败：${outcome.error}` : `Export failed: ${outcome.error}`
}
