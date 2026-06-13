import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/global.css'
import { initTheme } from './stores/themeStore'
import { initFontSize } from './stores/fontSizeStore'
import { migrateLocalStorageToSQLite } from './utils/migrateLocalStorage'

// 初始化主题和字号
initTheme()
initFontSize()

// 执行 localStorage 迁移（异步，不阻塞渲染）
migrateLocalStorageToSQLite().catch(e => {
  console.error('Migration failed:', e)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
