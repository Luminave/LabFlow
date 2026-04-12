/**
 * 主题状态管理
 */

import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const THEME_KEY = 'labflow_theme'

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (localStorage.getItem(THEME_KEY) as Theme) || 'light',
  
  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light'
    localStorage.setItem(THEME_KEY, newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    set({ theme: newTheme })
  },
  
  setTheme: (theme: Theme) => {
    localStorage.setItem(THEME_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  }
}))

// 初始化主题
export function initTheme() {
  const theme = (localStorage.getItem(THEME_KEY) as Theme) || 'light'
  document.documentElement.setAttribute('data-theme', theme)
}
