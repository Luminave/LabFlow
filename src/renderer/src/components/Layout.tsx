import { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import styles from './Layout.module.css'

interface LayoutProps {
  children: ReactNode
}

// GitHub 仓库地址
const GITHUB_REPO_URL = 'https://github.com/Luminave/LabFlow'

export default function Layout({ children }: LayoutProps) {
  const { language, toggleLanguage } = useI18nStore()
  
  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <div className={styles.logoMain}>
            <span className={styles.logoIcon}>🧪</span>
            <span className={styles.logoText}>LabFlow</span>
          </div>
          <span className={styles.logoSubtitle}>{t('app.subtitle', language)}</span>
        </div>
        
        <nav className={styles.nav}>
          <NavLink 
            to="/home" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>🏠</span>
            {t('nav.home', language)}
          </NavLink>
          
          <NavLink 
            to="/warehouse" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>📦</span>
            {t('nav.warehouse', language)}
          </NavLink>
          
          <NavLink 
            to="/experiment" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>🔬</span>
            {t('nav.experiment', language)}
          </NavLink>
          
          <NavLink 
            to="/narrator" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>📖</span>
            {t('nav.narrator', language)}
          </NavLink>
          
          <NavLink 
            to="/history" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>📋</span>
            {t('nav.history', language)}
          </NavLink>
          
          <NavLink 
            to="/trace" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>🔍</span>
            {t('nav.trace', language)}
          </NavLink>
          
          <NavLink 
            to="/settings" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>🎨</span>
            {t('nav.settings', language)}
          </NavLink>
          
          <NavLink 
            to="/tools" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>🔧</span>
            {t('nav.tools', language)}
          </NavLink>
          
          <NavLink 
            to="/backup" 
            className={({ isActive }) => isActive ? styles.navItemActive : styles.navItem}
          >
            <span className={styles.navIcon}>💾</span>
            {t('nav.backup', language)}
          </NavLink>
        </nav>
        
        <div className={styles.sidebarFooter}>
          <a 
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.githubBtn}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub
          </a>
          <button className={styles.langBtn} onClick={toggleLanguage}>
            {t('language.switch', language)}
          </button>
          <span className={styles.version}>v0.2.1</span>
        </div>
      </aside>
      
      <main className={styles.main}>
        {children}
      </main>
    </div>
  )
}
