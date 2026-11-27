/**
 * 「改动没落盘」的常驻提示状态。
 *
 * 2026-11-27 事故：自动保存失败只发一条 2.6 秒就消失的轻提示，接着画布上的
 * 改动被磁盘内容覆盖，编辑动作又静默写进已经不在列表里的试管 —— 主人看到的是
 * 「界面卡死、怎么改都不动」。这里把「没存上」变成一条不会自己消失的横幅，
 * 直到真正写盘成功（或主人手动重新载入）才撤掉。
 */

import { useEffect, useState } from 'react'

export interface SaveAlert {
  text: string
  at: number
}

let current: SaveAlert | null = null
const listeners = new Set<(alert: SaveAlert | null) => void>()

function emit(): void {
  listeners.forEach((listener) => listener(current))
}

/** 报告一次「改动没落盘」。同一条文字重复上报不刷新时间，避免横幅闪动 */
export function reportSaveAlert(text: string): void {
  if (!text) return
  if (current && current.text === text) return
  current = { text, at: Date.now() }
  emit()
}

/** 写盘成功（或主人主动重新载入）后撤掉横幅 */
export function clearSaveAlert(): void {
  if (!current) return
  current = null
  emit()
}

export function peekSaveAlert(): SaveAlert | null {
  return current
}

/** 组件里读当前横幅（没有就是 null） */
export function useSaveAlert(): SaveAlert | null {
  const [alert, setAlert] = useState<SaveAlert | null>(current)

  useEffect(() => {
    setAlert(current)
    listeners.add(setAlert)
    return () => {
      listeners.delete(setAlert)
    }
  }, [])

  return alert
}
