import { Routes, Route, Navigate } from 'react-router-dom'
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

function App() {
  return (
    <Layout>
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
    </Layout>
  )
}

export default App
