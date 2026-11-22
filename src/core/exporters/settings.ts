/**
 * 导出设置与文件名规则。
 *
 * 单独一个文件、**不 import js-yaml**：主进程（electron/main.ts）只需要这几个默认值与校验，
 * 不该为了读一个默认值把 YAML 序列化库也带进主进程启动路径。
 */

import type { ProjectInput } from './types'

/** 导出设置（存 config:* 的那一份） */
export interface ExportSettings {
  /** 默认目录；空串 = 每次弹选择框 */
  directory: string
  /** 文件名模板，支持 <日期> <工程名> */
  fileNameTemplate: string
  /** 是否自动按工程名建子文件夹 */
  autoSubfolder: boolean
  /** 画布横向比例（1.0× = 白板原样），0.5–4.0，步长 0.1；默认 1.6× */
  scaleX: number
  /** 画布纵向比例，默认 1.6× */
  scaleY: number
  /** 实验模拟页点「保存」后是否自动重新导出（默认开） */
  autoExportOnSave: boolean
  /** 导出时是否写 `.canvas` 白板文件（默认开；关掉只写 .yml 和 .md） */
  exportCanvasFile: boolean
  /** 导出时是否额外画一张 `<工程名>.png` 流程图（默认开） */
  exportImage: boolean
  /**
   * 导出目录里是否再放一份工程 .yml（数据副本）。
   * 默认关：正本在 `工程/<工程名>.yml`，导出的副本**只当备份，永远不回读**。
   */
  exportDataFile: boolean
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  directory: '',
  fileNameTemplate: '<日期>-<工程名>',
  autoSubfolder: true,
  scaleX: 1.6,
  scaleY: 1.6,
  // 保存即导出：开
  autoExportOnSave: true,
  // 白板文件：默认关（笔记里看流程图有 PNG 就够了）
  exportCanvasFile: false,
  // 截图：开
  exportImage: true,
  // 数据副本：默认关，正本在 工程/ 里，导出的 yml 只当备份
  exportDataFile: false
}

/** 比例滑块的取值范围与步长（讲述者页与主进程共用一套） */
export const SCALE_MIN = 0.5
export const SCALE_MAX = 4
export const SCALE_STEP = 0.1

/** 旧版存的是像素净空（横向默认 160、纵向默认 100），读老配置时按这两档折算成倍数 */
const LEGACY_GAP_X = 160
const LEGACY_GAP_Y = 100

/**
 * 比例值规整：非数字回默认值，超范围夹到 0.5–4.0，再按 0.1 取整。
 */
export function normalizeScale(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, num))
  // 先按步长取整，再抹掉浮点尾巴（1.66 → 1.7000000000000002）
  const stepped = Math.round(clamped / SCALE_STEP) * SCALE_STEP
  return Math.round(stepped * 10) / 10
}

/**
 * 老配置（像素净空）→ 比例：按旧默认值 160 / 100 折算，160px 与 100px 都等于 1.0×。
 * 这样老用户升级后第一次导出的松紧程度和以前一样。
 */
function legacyGapToScale(gap: unknown, base: number): number | undefined {
  const num = typeof gap === 'number' ? gap : Number(gap)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return normalizeScale(num / base, 1)
}

/** 把设置里可能缺字段的旧值补成合法设置 */
export function normalizeExportSettings(raw: unknown): ExportSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<ExportSettings>
  return {
    directory: typeof value.directory === 'string' ? value.directory : DEFAULT_EXPORT_SETTINGS.directory,
    fileNameTemplate:
      typeof value.fileNameTemplate === 'string' && value.fileNameTemplate.trim()
        ? value.fileNameTemplate
        : DEFAULT_EXPORT_SETTINGS.fileNameTemplate,
    autoSubfolder:
      typeof value.autoSubfolder === 'boolean' ? value.autoSubfolder : DEFAULT_EXPORT_SETTINGS.autoSubfolder,
    scaleX: normalizeScale(
      value.scaleX !== undefined ? value.scaleX : legacyGapToScale((value as { spacingX?: unknown }).spacingX, LEGACY_GAP_X),
      DEFAULT_EXPORT_SETTINGS.scaleX
    ),
    scaleY: normalizeScale(
      value.scaleY !== undefined ? value.scaleY : legacyGapToScale((value as { spacingY?: unknown }).spacingY, LEGACY_GAP_Y),
      DEFAULT_EXPORT_SETTINGS.scaleY
    ),
    autoExportOnSave: normalizeSwitch(value.autoExportOnSave, DEFAULT_EXPORT_SETTINGS.autoExportOnSave),
    exportCanvasFile: normalizeSwitch(value.exportCanvasFile, DEFAULT_EXPORT_SETTINGS.exportCanvasFile),
    exportImage: normalizeSwitch(value.exportImage, DEFAULT_EXPORT_SETTINGS.exportImage),
    exportDataFile: normalizeSwitch(value.exportDataFile, DEFAULT_EXPORT_SETTINGS.exportDataFile)
  }
}

/** 开关值规整：只认真正的布尔值，其它（包括 undefined、字符串）回默认 */
export function normalizeSwitch(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 文件名里不能出现的字符换成 -，避免在 Windows 上写出失败 */
export function sanitizeFileName(text: string): string {
  return text
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
}

/** 渲染文件名模板：<日期> <工程名> 两个占位符 */
export function renderFileName(template: string, input: Pick<ProjectInput, 'name' | 'date'>): string {
  const rendered = (template || DEFAULT_EXPORT_SETTINGS.fileNameTemplate)
    .replace(/<日期>/g, input.date || '')
    .replace(/<工程名>/g, input.name || '')
  const safe = sanitizeFileName(rendered)
  return safe || sanitizeFileName(`${input.date || ''}-${input.name || 'LabFlow'}`) || 'LabFlow'
}

/**
 * 实际用的文件名（不含扩展名）。
 *
 * 开了「自动建子文件夹」时只用 `<工程名>`：目录已经是工程名，文件名再带日期就重复成
 * `AD-5.2/2026-11-18-AD-5.2.yml`。关掉子文件夹时仍按模板（默认 `<日期>-<工程名>`）。
 */
export function resolveBaseName(
  input: Pick<ProjectInput, 'name' | 'date'>,
  settings: Pick<ExportSettings, 'fileNameTemplate' | 'autoSubfolder'>
): string {
  if (settings.autoSubfolder) {
    const byName = sanitizeFileName(input.name || '')
    if (byName) return byName
  }
  return renderFileName(settings.fileNameTemplate, input)
}
