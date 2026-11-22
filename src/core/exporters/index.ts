/**
 * 导出三件套的统一入口：一个工程 → `项目.yml` + `项目.canvas` + `<日期>.md`（+ 可选的 `.png`）。
 *
 * 文件名与目录规则在 ./settings.ts（不依赖 js-yaml，主进程也用它），这里只做组装。
 * PNG 需要 canvas，只能在渲染进程里画，所以这里只留出文件名与开关；真正落笔在
 * `src/renderer/src/utils/projectExport.ts`。
 */

import { toCanvasFile } from './canvas'
import { normalizeExportSettings, resolveBaseName, sanitizeFileName, type ExportSettings } from './settings'
import { toSopMarkdown } from './sop'
import { toProjectYml } from './yml'
import type { ProjectInput } from './types'

export * from './types'
export * from './layout'
export * from './settings'
export * from './nodeText'
export * from './canvasColor'
export * from './yml'
export * from './canvas'
export * from './sop'

export interface ExportFile {
  /** 相对目标目录的文件名 */
  name: string
  /** 文本内容；`encoding: 'base64'` 时是 base64 字符串（PNG 用） */
  content: string
  /** 写盘编码，默认 utf8 */
  encoding?: 'utf8' | 'base64'
}

export interface ExportBundle {
  baseName: string
  /** 若开了自动建子文件夹，就是子文件夹名；否则空串 */
  subfolder: string
  files: ExportFile[]
  /** 这次导出应该出几个文件（含 PNG 的话会由渲染进程补上） */
  expectedCount: number
}

/**
 * 生成文本类文件（.yml / .canvas / .md）。
 * 文件名规则：
 *   `<实际文件名>.yml` / `.canvas` / `.md`
 * 开了自动建子文件夹时，文件放进以工程名命名的子目录，文件名也只留工程名
 * （否则会出现 `AD-5.2/2026-11-18-AD-5.2.yml` 这种重复）；关掉时按文件名模板渲染。
 *
 * `exportCanvasFile` 关掉时**不写 .canvas**（主人要的就是「只留工程文件和 SOP」）；
 * `exportImage` 只影响 expectedCount 与文件名，PNG 由渲染进程画完再追加。
 */
export function buildExportBundle(input: ProjectInput, settings?: Partial<ExportSettings>): ExportBundle {
  const config = normalizeExportSettings(settings)
  const baseName = resolveBaseName(input, config)
  const subfolder = config.autoSubfolder ? sanitizeFileName(input.name) || baseName : ''
  const scale = { scaleX: config.scaleX, scaleY: config.scaleY }

  const files: ExportFile[] = []
  // 数据副本默认不写：正本在 工程/<工程名>.yml，导出目录里的 .yml 只是备份，永远不回读
  if (config.exportDataFile) {
    files.push({ name: `${baseName}.yml`, content: toProjectYml(input, scale) })
  }
  if (config.exportCanvasFile) {
    files.push({ name: `${baseName}.canvas`, content: toCanvasFile(input, scale) })
  }
  files.push({ name: `${baseName}.md`, content: toSopMarkdown(input) })

  return {
    baseName,
    subfolder,
    files,
    expectedCount: files.length + (config.exportImage ? 1 : 0)
  }
}

/** PNG 的文件名（与三件套同一个 basename，方便笔记里一起链） */
export function buildImageFileName(baseName: string): string {
  return `${baseName}.png`
}
