/**
 * 「改动没落盘」的常驻横幅（2026-11-27 事故修复的第 3 条）。
 *
 * 与 GlobalToast 的区别：这个不自动消失。它只在两件事发生后才撤掉——
 * 写盘真的成功了，或者主人按「重新载入」放弃界面上的改动。
 *
 * 两个按钮：
 * - 立即保存：把界面上的当前工程立刻写进 工程/*.yml（不等 2 秒防抖）
 * - 重新载入：放弃界面改动，按磁盘上的工程重新铺画布
 */

import { useState, type CSSProperties } from 'react'
import { clearSaveAlert, useSaveAlert } from '../stores/saveAlert'
import { useExperimentStore } from '../stores/experimentStore'
import { useI18nStore } from '../stores/i18nStore'
import { ProjectFileConflictError } from '../utils/projectSource'
import { showGlobalToast } from './GlobalToast'

export function SaveFailureBanner() {
  const alert = useSaveAlert()
  const { language } = useI18nStore()
  const [busy, setBusy] = useState(false)
  const zh = language === 'zh'

  if (!alert) return null

  const onSaveNow = async () => {
    const state = useExperimentStore.getState()
    if (!state.currentExperiment) return
    setBusy(true)
    try {
      const ok = await state.saveCurrentExperiment(undefined)
      if (ok) {
        clearSaveAlert()
        showGlobalToast(zh ? '已写入工程文件' : 'Saved to project file')
      }
    } catch (e) {
      // 工程正本被外部改过：留给实验页弹「重新载入 / 用界面覆盖」
      if (e instanceof ProjectFileConflictError) {
        showGlobalToast(
          zh ? '工程文件已被外部修改，请到实验页选择重新载入或用界面覆盖' : 'File changed externally — resolve it in the experiment page'
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const onReload = async () => {
    const state = useExperimentStore.getState()
    const id = state.currentExperiment?.id
    if (!id) return
    setBusy(true)
    try {
      await state.reloadExperimentFromFile(id)
      clearSaveAlert()
      showGlobalToast(zh ? '已按磁盘上的工程重新载入' : 'Reloaded from project file')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 3001,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        background: '#fff4e5',
        borderBottom: '1px solid #f0c37a',
        color: '#7a4b00',
        fontSize: 13
      }}
    >
      <span style={{ flex: 1 }}>⚠️ {alert.text}</span>
      <button type="button" onClick={onSaveNow} disabled={busy} style={buttonStyle}>
        {zh ? '立即保存' : 'Save now'}
      </button>
      <button type="button" onClick={onReload} disabled={busy} style={buttonStyle}>
        {zh ? '重新载入' : 'Reload'}
      </button>
    </div>
  )
}

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #d8a24a',
  background: '#fff',
  color: '#7a4b00',
  cursor: 'pointer',
  fontSize: 12
}
