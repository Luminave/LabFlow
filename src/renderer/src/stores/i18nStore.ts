import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'zh' | 'en'

interface I18nState {
  language: Language
  setLanguage: (lang: Language) => void
  toggleLanguage: () => void
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      language: 'zh',
      setLanguage: (lang) => set({ language: lang }),
      toggleLanguage: () => set({ language: get().language === 'zh' ? 'en' : 'zh' })
    }),
    {
      name: 'labflow-language'
    }
  )
)
