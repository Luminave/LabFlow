import { useState, useEffect, useMemo, useRef } from 'react'
import { useExperimentStore } from '../stores/experimentStore'
import { useI18nStore } from '../stores/i18nStore'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { t } from '../i18n/translations'
import { narrationText } from '@/core/narration'
import { buildProjectLink } from '@/core/deepLink'
import type { ExportSettings } from '@/core/exporters'
import { describeExportOutcome, runProjectExport } from '../utils/projectExport'
import {
  computeBounds,
  DEFAULT_EXPORT_SETTINGS,
  normalizeExportSettings,
  projectInputFromExperiment,
  renderFileName,
  resolveBaseName,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  toCanvasObject
} from '@/core/exporters'
import styles from './NarratorPage.module.css'

export default function NarratorPage() {
  const { experiments, fetchExperiments } = useExperimentStore()
  const { language } = useI18nStore()
  // 成分背景色：导出画布时按最接近的 Obsidian 预设色上色（原色值写 .yml）
  const { colors: substanceColors, loadColors } = useSubstanceColorStore()
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>('')
  const [narratedSteps, setNarratedSteps] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [useTubeNumber, setUseTubeNumber] = useState(false) // 使用管号替代试管名称

  // 导出设置（默认目录 / 文件名模板 / 自动建子文件夹）
  const [exportSettings, setExportSettings] = useState(DEFAULT_EXPORT_SETTINGS)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  // 画布间距（横向/纵向净空）：拖动即写配置，下次导出就用新值
  const [boardBounds, setBoardBounds] = useState<{ width: number; height: number } | null>(null)
  const scaleSaveTimer = useRef<number | null>(null)

  // 导出成功后的轻提示：2.5 秒自己淡出；点一下复制完整路径
  const [toast, setToast] = useState<{ text: string; fullPath: string; action?: string } | null>(null)
  const [toastCopied, setToastCopied] = useState(false)
  const toastTimer = useRef<number | null>(null)

  const showToast = (text: string, fullPath: string, action?: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToastCopied(false)
    setToast({ text, fullPath, action })
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current)
    }
  }, [])

  // 复制文本：navigator.clipboard 在窗口没聚焦（比如 DevTools 抢了焦点）时会拒绝，
  // 所以退一步用隐藏 textarea + execCommand，这条路在 Electron 里始终可用
  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 继续走兜底
    }
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }

  const copyToastPath = async () => {
    if (!toast) return
    if (await copyText(toast.fullPath)) setToastCopied(true)
  }

  // 加载实验数据
  useEffect(() => {
    fetchExperiments()
    loadColors?.()
  }, [fetchExperiments, loadColors])

  // 成分名 → 背景色（导出时给画布上色用）
  const substanceColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    substanceColors?.forEach((value: { bgColor?: string }, name: string) => {
      if (value?.bgColor) map[name] = value.bgColor
    })
    return map
  }, [substanceColors])

  // 加载已保存的导出设置
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.config
      ?.getExportSettings?.()
      .then(saved => {
        if (!cancelled) setExportSettings(normalizeExportSettings(saved))
      })
      .catch(() => {
        // 读不到就用默认值，不影响生成步骤
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 可用的实验列表（草稿和已完成的都可以选择）
  const availableExperiments = useMemo(
    () => experiments.filter(e => e.status === 'completed' || e.status === 'draft'),
    [experiments]
  )

  const selectedExperiment = useMemo(
    () => experiments.find(e => e.id === selectedExperimentId),
    [experiments, selectedExperimentId]
  )

  // 按配置序号排序的中间产物试管（列表展示用）
  const sortedTubes = useMemo(
    () =>
      selectedExperiment
        ? selectedExperiment.tubes
            .filter(tube => tube.type === 'intermediate' && !tube.asSource)
            .sort((a, b) => (a.configOrder || 999999) - (b.configOrder || 999999))
        : [],
    [selectedExperiment]
  )

  // 选择实验后自动生成讲述（与导出 SOP 走同一个函数，数字写法一致）
  useEffect(() => {
    if (selectedExperiment) {
      setNarratedSteps(narrationText(selectedExperiment, useTubeNumber, language === 'zh' ? '空' : 'Empty'))
    } else {
      setNarratedSteps('')
    }
  }, [selectedExperiment, useTubeNumber, language])

  // 保存导出设置
  const saveExportSettings = async (): Promise<boolean> => {
    const save = window.electronAPI?.config?.setExportSettings
    if (!save) {
      setExportMessage('保存设置需要在桌面应用里使用（当前是浏览器预览）')
      return false
    }
    try {
      const result = await save(exportSettings)
      if (result?.success && result.settings) {
        setExportSettings(normalizeExportSettings(result.settings))
      }
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
      return true
    } catch (error) {
      setExportMessage(`保存设置失败：${(error as Error).message}`)
      return false
    }
  }

  // 改比例：先更新界面，再防抖写配置（拖动滑块时不必每次刷盘）
  const updateScale = (patch: Partial<ExportSettings>) => {
    const next = normalizeExportSettings({ ...exportSettings, ...patch })
    setExportSettings(next)
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current)
    scaleSaveTimer.current = window.setTimeout(() => {
      window.electronAPI?.config?.setExportSettings?.(next).catch(() => {
        // 写配置失败不打断调参，导出时还会再写一次
      })
    }, 300)
  }

  const resetScale = () => {
    updateScale({ scaleX: DEFAULT_EXPORT_SETTINGS.scaleX, scaleY: DEFAULT_EXPORT_SETTINGS.scaleY })
  }

  // 选择默认导出目录
  const chooseDirectory = async () => {
    const result = await window.electronAPI?.config?.showFolderDialog?.({
      title: '选择默认导出目录',
      defaultPath: exportSettings.directory || undefined
    })
    if (result && !result.canceled && result.filePaths[0]) {
      setExportSettings({ ...exportSettings, directory: result.filePaths[0] })
    }
  }

  // 导出三件套：.yml（数据真相源）、.canvas（白板）、.md（SOP）
  // 复制 labflow:// 链接：贴进 Obsidian 笔记里，点一下就能打开这个工程
  const copyProjectLink = async () => {
    if (!selectedExperiment) return
    const link = buildProjectLink(selectedExperiment.name, selectedExperiment.id)
    if (await copyText(link)) {
      showToast(
        language === 'zh' ? '已复制工程链接' : 'Project link copied',
        link,
        language === 'zh' ? '点击再复制一次' : 'Click to copy again'
      )
    } else {
      setExportMessage(
        language === 'zh' ? `剪贴板不可用，请手动复制：${link}` : `Clipboard unavailable, copy manually: ${link}`
      )
    }
  }

  const handleExport = async () => {
    if (!selectedExperiment) return

    setExporting(true)
    setExportMessage('')
    try {
      // 先把设置落盘，下次打开就是这次选的默认值
      await saveExportSettings()

      const input = {
        ...projectInputFromExperiment(selectedExperiment),
        substanceColors: substanceColorMap
      }
      const outcome = await runProjectExport({ input, settings: exportSettings })

      if (outcome.ok) {
        const folder = String(outcome.directory || '').split(/[\\/]/).filter(Boolean).pop() || ''
        const tail = outcome.imageSkipped
          ? language === 'zh' ? '（流程图没截图：需要先在实验模拟页打开这个工程）' : ' (board screenshot skipped)'
          : ''
        showToast(
          `已导出 ${outcome.count} 个文件到 ${folder || '所选目录'}${tail}`,
          String(outcome.directory || '')
        )
        setExportMessage('')
      } else if (outcome.canceled) {
        setExportMessage('已取消导出')
      } else {
        setExportMessage(describeExportOutcome(outcome, language === 'zh' ? 'zh' : 'en'))
      }
    } catch (error) {
      setExportMessage(`导出失败：${(error as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  // 预计画布尺寸：拿选中的工程直接跑一遍 layout（渲染进程里算，不打扰主进程），防抖 200ms
  const scaleX = exportSettings.scaleX
  const scaleY = exportSettings.scaleY
  useEffect(() => {
    if (!selectedExperiment) {
      setBoardBounds(null)
      return
    }
    const timer = window.setTimeout(() => {
      try {
        const input = {
          ...projectInputFromExperiment(selectedExperiment),
          substanceColors: substanceColorMap
        }
        const canvas = toCanvasObject(input, { scaleX, scaleY })
        const bounds = computeBounds(canvas.nodes)
        setBoardBounds({ width: bounds.width, height: bounds.height })
      } catch {
        setBoardBounds(null)
      }
    }, 200)
    return () => window.clearTimeout(timer)
  }, [selectedExperiment, scaleX, scaleY, substanceColorMap])

  // 面板里实时预览文件名，免得导出后才发现名字不对
  // 开了子文件夹 → 文件名只用工程名；关掉 → 按模板（默认 <日期>-<工程名>）
  const previewInput = selectedExperiment ? projectInputFromExperiment(selectedExperiment) : null
  const fileNamePreview = previewInput ? resolveBaseName(previewInput, exportSettings) : ''
  const templatePreview = previewInput ? renderFileName(exportSettings.fileNameTemplate, previewInput) : ''
  // 反例提示用：不管当前开关，开子文件夹时文件名长什么样（只取工程名）
  const projectOnlyPreview = previewInput
    ? resolveBaseName(previewInput, { ...exportSettings, autoSubfolder: true })
    : ''
  const subfolderPreview = exportSettings.autoSubfolder ? fileNamePreview : ''

  const filePreviewHint = () => {
    if (!fileNamePreview) return language === 'zh' ? '（选工程后预览）' : '(preview after selecting a project)'
    const files = `${fileNamePreview}.yml / .canvas / .md`
    const folder = subfolderPreview ? `${subfolderPreview}/` : ''
    const other = exportSettings.autoSubfolder
      ? language === 'zh'
        ? `；关掉子文件夹则用模板名：${templatePreview}.yml`
        : `; without subfolder: ${templatePreview}.yml`
      : language === 'zh'
        ? `；打开子文件夹则只用工程名：${projectOnlyPreview}.yml`
        : `; with subfolder: ${projectOnlyPreview}.yml`
    return `${folder}${files}${other}`
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>📖 {t('nav.narrator', language)}</h1>
        <p className={styles.subtitle}>{language === 'zh' ? '选择实验工程，按配置序号生成实验操作步骤' : 'Select project, generate steps by config order'}</p>
        <p className={styles.hint}>💡 {language === 'zh' ? '提示：回退的工程需要另存为新工程之后才能使用讲述者' : 'Tip: Reverted projects must be saved as new before using Narrator'}</p>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={useTubeNumber}
            onChange={e => setUseTubeNumber(e.target.checked)}
          />
          {language === 'zh' ? '使用管号' : 'Use Tube Number'}
        </label>
      </header>

      <div className={styles.content}>
        {/* 实验选择区域 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>1. {language === 'zh' ? '选择实验工程' : 'Select Project'}</h2>
          <select
            className={styles.select}
            value={selectedExperimentId}
            onChange={e => {
              setSelectedExperimentId(e.target.value)
              setExportMessage('')
            }}
          >
            <option value="">-- {language === 'zh' ? '请选择实验' : 'Select Experiment'} --</option>
            {availableExperiments.map(exp => (
              <option key={exp.id} value={exp.id}>
                {exp.name} [{exp.status === 'completed' ? t('status.completed', language) : t('status.draft', language)}] ({exp.completedAt ? new Date(exp.completedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US') : new Date(exp.updatedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')})
              </option>
            ))}
          </select>
        </div>

        {/* 试管列表显示 */}
        {selectedExperimentId && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>2. {language === 'zh' ? '试管配置顺序' : 'Tube Config Order'}</h2>
            {sortedTubes.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>🧪</div>
                <p>{language === 'zh' ? '该实验没有中间产物试管' : 'No intermediate tubes in this experiment'}</p>
                <p className={styles.hint}>{language === 'zh' ? '请先在实验模拟中配置试管的"配置序号"' : 'Please set "Config Order" in Experiment first'}</p>
              </div>
            ) : (
              <>
                <div className={styles.tubeList}>
                  {sortedTubes.map((tube, index) => (
                    <div key={tube.id} className={styles.tubeCard}>
                      <div className={styles.tubeOrder}>
                        {tube.configOrder || '?'}
                      </div>
                      <div className={styles.tubeInfo}>
                        <div className={styles.tubeName}>{tube.name}</div>
                        <div className={styles.tubeVolume}>
                          {language === 'zh' ? '序号:' : 'Order:'} {tube.configOrder || (language === 'zh' ? '未设置' : 'Not Set')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {!sortedTubes.every(t => t.configOrder) && (
                  <p className={styles.warning}>⚠️ {language === 'zh' ? '部分试管未设置配置序号，请在实验模拟中补充' : 'Some tubes missing config order, please set in Experiment'}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* 讲述结果 */}
        {narratedSteps && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{language === 'zh' ? '实验操作步骤' : 'Experiment Steps'}</h2>
            <div className={styles.stepsOutput}>
              <pre className={styles.stepsText}>{narratedSteps}</pre>
              <button
                className={styles.copyBtn}
                onClick={() => {
                  navigator.clipboard.writeText(narratedSteps)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? `✅ ${language === 'zh' ? '已复制' : 'Copied'}` : `📋 ${language === 'zh' ? '复制' : 'Copy'}`}
              </button>
            </div>
          </div>
        )}

        {/* 导出：.yml（数据真相源）+ .canvas + SOP */}
        {selectedExperiment && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>3. {language === 'zh' ? '导出工程' : 'Export Project'}</h2>
            <p className={styles.hint}>
              {language === 'zh'
                ? '一次写出三份：.yml（数据真相源，给 Agent 读改）、.canvas（白板，Obsidian 里打开就是框图）、.md（SOP，照着配液）'
                : 'Writes three files: .yml (source of truth), .canvas (board), .md (SOP)'}
            </p>

            <label className={styles.fieldLabel}>
              {language === 'zh' ? '默认目录' : 'Default folder'}
            </label>
            <div className={styles.fieldRow}>
              <input
                className={styles.textInput}
                value={exportSettings.directory}
                placeholder={language === 'zh' ? '留空则每次导出时选择' : 'Empty = ask every time'}
                onChange={e => setExportSettings({ ...exportSettings, directory: e.target.value })}
              />
              <button className={styles.smallBtn} onClick={chooseDirectory}>
                {language === 'zh' ? '选择…' : 'Browse…'}
              </button>
            </div>

            <label className={styles.fieldLabel}>{language === 'zh' ? '文件名模板' : 'File name template'}</label>
            <input
              className={styles.textInput}
              value={exportSettings.fileNameTemplate}
              onChange={e => setExportSettings({ ...exportSettings, fileNameTemplate: e.target.value })}
              disabled={exportSettings.autoSubfolder}
            />
            <p className={styles.hint}>{filePreviewHint()}</p>

            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={exportSettings.autoSubfolder}
                onChange={e => setExportSettings({ ...exportSettings, autoSubfolder: e.target.checked })}
              />
              {language === 'zh' ? '自动按工程名建子文件夹' : 'Auto subfolder by project name'}
            </label>
            {exportSettings.autoSubfolder && (
              <p className={styles.hint}>
                {language === 'zh'
                  ? '已开子文件夹：文件名只用工程名，模板暂时不生效（关掉开关就按模板）'
                  : 'Subfolder on: file name is the project name; template applies when off'}
              </p>
            )}

            <div className={styles.switchGroup}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={exportSettings.autoExportOnSave}
                  onChange={e => updateScale({ autoExportOnSave: e.target.checked })}
                />
                {language === 'zh' ? '保存实验时自动重新导出' : 'Re-export after saving the experiment'}
              </label>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={exportSettings.exportCanvasFile}
                  onChange={e => updateScale({ exportCanvasFile: e.target.checked })}
                />
                {language === 'zh' ? '导出白板文件（.canvas）' : 'Export the .canvas board'}
              </label>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={exportSettings.exportImage}
                  onChange={e => updateScale({ exportImage: e.target.checked })}
                />
                {language === 'zh' ? '导出流程图图片（.png）' : 'Export the flow chart (.png)'}
              </label>
            </div>

            <label className={styles.fieldLabel}>
              {language === 'zh' ? '画布比例（按倍数整体拉开，白板上的相对位置不变）' : 'Canvas scale'}
            </label>
            <div className={styles.spacingRow}>
              <span className={styles.spacingName}>{language === 'zh' ? '横向比例' : 'Horizontal'}</span>
              <input
                className={styles.slider}
                type="range"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={SCALE_STEP}
                value={exportSettings.scaleX}
                onChange={e => updateScale({ scaleX: Number(e.target.value) })}
              />
              <span className={styles.spacingValue}>{exportSettings.scaleX.toFixed(1)}×</span>
            </div>
            <div className={styles.spacingRow}>
              <span className={styles.spacingName}>{language === 'zh' ? '纵向比例' : 'Vertical'}</span>
              <input
                className={styles.slider}
                type="range"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={SCALE_STEP}
                value={exportSettings.scaleY}
                onChange={e => updateScale({ scaleY: Number(e.target.value) })}
              />
              <span className={styles.spacingValue}>{exportSettings.scaleY.toFixed(1)}×</span>
            </div>
            <p className={styles.hint}>
              {language === 'zh' ? '预计 ' : 'Estimated '}
              {boardBounds ? `${boardBounds.width} × ${boardBounds.height}` : '—'}
              <button className={styles.smallBtn} onClick={resetScale} style={{ marginLeft: 12 }}>
                {language === 'zh' ? '恢复默认（1.6× / 1.6×）' : 'Reset (1.6× / 1.6×)'}
              </button>
            </p>

            <div className={styles.fieldRow}>
              <button className={styles.primaryBtn} onClick={handleExport} disabled={exporting}>
                {exporting
                  ? language === 'zh' ? '导出中…' : 'Exporting…'
                  : `📤 ${language === 'zh' ? '导出' : 'Export'}`}
              </button>
              <button className={styles.smallBtn} onClick={saveExportSettings}>
                {settingsSaved
                  ? `✅ ${language === 'zh' ? '已保存' : 'Saved'}`
                  : language === 'zh' ? '保存为默认设置' : 'Save as default'}
              </button>
              <button
                className={styles.smallBtn}
                onClick={copyProjectLink}
                disabled={!selectedExperiment}
                title={language === 'zh' ? '复制 labflow:// 链接，贴进笔记点一下就打开这个工程' : 'Copy a labflow:// link'}
              >
                {language === 'zh' ? '🔗 复制工程链接' : '🔗 Copy project link'}
              </button>
            </div>

            {exportMessage && <p className={styles.hint}>{exportMessage}</p>}
          </div>
        )}
      </div>

      {/* 导出成功的轻提示：自己淡出；悬停看完整路径，点一下复制 */}
      {toast && (
        <div
          className={styles.toast}
          title={toast.fullPath}
          onClick={copyToastPath}
          role="status"
        >
          ✅ {toast.text}
          <span className={styles.toastPath}>
            {toastCopied
              ? language === 'zh' ? '已复制' : 'Copied'
              : toast.action || (language === 'zh' ? '点击复制路径' : 'Click to copy path')}
          </span>
        </div>
      )}
    </div>
  )
}
