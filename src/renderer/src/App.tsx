import { Routes, Route, Navigate } from 'react-router-dom'
import { Component, type ReactNode } from 'react'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import WarehousePage from './pages/WarehousePage'
import ExperimentPage from './pages/ExperimentPage'
import HistoryPage from './pages/HistoryPage'
import TracePage from './pages/TracePage'
import SettingsPage from './pages/SettingsPage'
import ToolsPage from './pages/ToolsPage'
import BackupPage from './pages/BackupPage'
import NarratorPage from './pages/NarratorPage'

// 错误边界组件：防止页面白屏
interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          color: '#ef4444',
          backgroundColor: '#fef2f2',
          borderRadius: '8px',
          margin: '20px',
          border: '1px solid #fecaca'
        }}>
          <h2 style={{ marginBottom: '16px' }}>⚠️ 页面加载出错</h2>
          <p style={{ color: '#991b1b', marginBottom: '16px' }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            🔄 重新加载
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  return (
    <Layout>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/warehouse" element={<WarehousePage />} />
          <Route path="/experiment" element={<ExperimentPage />} />
          <Route path="/experiment/:id" element={<ExperimentPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/trace" element={<TracePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/narrator" element={<NarratorPage />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  )
}

export default App
