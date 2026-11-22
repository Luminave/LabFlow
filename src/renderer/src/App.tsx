import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Component, useEffect, type ReactNode } from 'react'
import { parseProjectLink, pickProject } from '@/core/deepLink'
import { useExperimentStore } from './stores/experimentStore'
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
import { GlobalToast } from './components/GlobalToast'
import { useStoreHotReload } from './utils/storeHotReload'
import { useWarehouseFileSync } from './utils/warehouseSync'

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

/**
 * 深链接：笔记里点 `labflow://open?project=…` 时，主进程把 URL 推过来，
 * 这里负责「找到工程 → 载入 → 跳到实验模拟页」。找不到就用弹框说清楚，不静默失败。
 */
function useProjectDeepLink() {
  const navigate = useNavigate()

  useEffect(() => {
    const subscribe = window.electronAPI?.onOpenProject
    if (!subscribe) return

    const openProject = async (url: string) => {
      const parsed = parseProjectLink(url)
      if (parsed.ok === false) {
        alert(`这个链接打不开：${parsed.detail}`)
        return
      }

      const store = useExperimentStore.getState()
      let match = pickProject(store.experiments || [], parsed)

      // 刚启动时工程列表可能还没加载，先拉一次再试
      if (!match && typeof store.fetchExperiments === 'function') {
        try {
          await store.fetchExperiments()
        } catch (e) {
          console.error('[DeepLink] 拉取工程列表失败:', e)
        }
        match = pickProject(useExperimentStore.getState().experiments || [], parsed)
      }

      if (!match) {
        alert(
          `在 LabFlow 里找不到工程「${parsed.project}」。\n` +
            `可能已经被删除，或者名字对不上（链接里的名字要和工程名完全一致）。`
        )
        return
      }

      const opened = useExperimentStore.getState().loadExperiment(match.id)
      if (!opened) {
        alert(`工程「${match.name}」读取失败，数据可能已损坏。`)
        return
      }
      navigate('/experiment')
    }

    // 冷启动时主进程会把链接留在 pending 里、不抢发（抢发那一次会早于这里的订阅而丢掉，
    // 2026-11-23 安装版实测）。所以订阅完之后主动问一次「有没有待处理链接」，
    // 有就立刻处理；主进程那边取走即清空，同一条不会处理两遍。
    // 先订阅再拉取：拉取期间到达的链接也接得住。
    const unsubscribe = subscribe((url: string) => {
      void openProject(url)
    })

    const takePending = window.electronAPI?.takePendingProjectLink
    if (typeof takePending === 'function') {
      void (async () => {
        try {
          const pending = await takePending()
          if (pending) void openProject(pending)
        } catch (e) {
          console.error('[DeepLink] 拉取待处理链接失败:', e)
        }
      })()
    }

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [navigate])
}

function App() {
  useProjectDeepLink()
  // 仓库正本（D:\学习\labflow\仓库.yml）：启动读一次，之后变动回写
  useWarehouseFileSync()
  // 正本文件被外部改动时热加载（防自激在主进程做）
  useStoreHotReload()
  return (
    <Layout>
      <GlobalToast />
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
