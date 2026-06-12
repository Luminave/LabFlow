import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/global.css'
import { initTheme } from './stores/themeStore'
import { initFontSize } from './stores/fontSizeStore'

// 初始化主题和字号
initTheme()
initFontSize()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
