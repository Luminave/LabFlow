/**
 * 字号状态管理
 */

import { create } from 'zustand'

interface FontSizeState {
  fontSize: number
  setFontSize: (size: number) => void
}

const FONT_SIZE_KEY = 'labflow_font_size'
const MIN_SIZE = 12
const MAX_SIZE = 20
const DEFAULT_SIZE = 14

export const useFontSizeStore = create<FontSizeState>((set) => ({
  fontSize: Math.min(MAX_SIZE, Math.max(MIN_SIZE, parseInt(localStorage.getItem(FONT_SIZE_KEY) || String(DEFAULT_SIZE), 10))),
  
  setFontSize: (size: number) => {
    const clampedSize = Math.min(MAX_SIZE, Math.max(MIN_SIZE, size))
    localStorage.setItem(FONT_SIZE_KEY, String(clampedSize))
    document.documentElement.style.fontSize = `${clampedSize}px`
    set({ fontSize: clampedSize })
  }
}))

// 初始化字号
export function initFontSize() {
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, parseInt(localStorage.getItem(FONT_SIZE_KEY) || String(DEFAULT_SIZE), 10)))
  document.documentElement.style.fontSize = `${size}px`
}

export { MIN_SIZE, MAX_SIZE, DEFAULT_SIZE }
