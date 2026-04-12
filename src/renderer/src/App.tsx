import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import WarehousePage from './pages/WarehousePage'
import ExperimentPage from './pages/ExperimentPage'
import HistoryPage from './pages/HistoryPage'
import TracePage from './pages/TracePage'
import SettingsPage from './pages/SettingsPage'
import BackupPage from './pages/BackupPage'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<WarehousePage />} />
        <Route path="/warehouse" element={<WarehousePage />} />
        <Route path="/experiment" element={<ExperimentPage />} />
        <Route path="/experiment/:id" element={<ExperimentPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/trace" element={<TracePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/backup" element={<BackupPage />} />
      </Routes>
    </Layout>
  )
}

export default App
