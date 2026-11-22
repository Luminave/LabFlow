/**
 * 全局轻提示（第 5 步热加载用）：2.6 秒自动消失，不抢焦点。
 *
 * 用 CustomEvent 触发，任何地方都能 `showGlobalToast('...')`，
 * 不用把 toast 状态一层层往下传。
 */

import { useEffect, useState } from 'react'

const EVENT_NAME = 'labflow:global-toast'

export function showGlobalToast(text: string): void {
  if (!text) return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { text } }))
}

export function GlobalToast() {
  const [text, setText] = useState('')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail
      setText(detail?.text || '')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setText(''), 2600)
    }
    window.addEventListener(EVENT_NAME, onToast)
    return () => {
      window.removeEventListener(EVENT_NAME, onToast)
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!text) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 32,
        transform: 'translateX(-50%)',
        zIndex: 3000,
        padding: '10px 16px',
        borderRadius: 10,
        border: '1px solid var(--border-color)',
        background: 'var(--surface-color)',
        boxShadow: '0 6px 24px rgba(0,0,0,.12)',
        color: 'var(--text-primary)',
        fontSize: 13,
        pointerEvents: 'none'
      }}
      role="status"
    >
      {text}
    </div>
  )
}
