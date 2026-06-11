import { useState, useRef, useEffect } from 'react'
import { useI18nStore } from '../stores/i18nStore'
import { useBackupStore, Snapshot } from '../stores/backupStore'
import styles from './BackupPage.module.css'

// 备份数据结构（用于浏览器下载）
interface BackupData {
  version: string
  timestamp: string
  snapshots?: Snapshot[] // 包含快照列表
  data: {
    labflow_tubes: string | null
    labflow_current_experiment: string | null
    labflow_experiments: string | null
    labflow_tube_histories: string | null
    substance_colors: string | null
    labflow_groups: string | null
  }
}

const BACKUP_VERSION = '1.2.0'
const BACKUP_EXTENSION = '.labflow'

export default function BackupPage() {
  const { language } = useI18nStore()
  const { 
    snapshots, 
    settings, 
    loadSnapshots, 
    saveSnapshot, 
    restoreSnapshot,
    deleteSnapshot,
    updateSettings
  } = useBackupStore()
  
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [intervalInput, setIntervalInput] = useState(settings.intervalMinutes.toString())
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSnapshots()
  }, [loadSnapshots])

  useEffect(() => {
    setIntervalInput(settings.intervalMinutes.toString())
  }, [settings.intervalMinutes])

  // 浏览器下载备份
  const handleExport = () => {
    setExporting(true)
    try {
      const backupData: BackupData = {
        version: BACKUP_VERSION,
        timestamp: new Date().toISOString(),
        snapshots: snapshots, // 包含快照列表
        data: {
          labflow_tubes: localStorage.getItem('labflow_tubes'),
          labflow_current_experiment: localStorage.getItem('labflow_current_experiment'),
          labflow_experiments: localStorage.getItem('labflow_experiments'),
          labflow_tube_histories: localStorage.getItem('labflow_tube_histories'),
          substance_colors: localStorage.getItem('substance_colors'),
          labflow_groups: localStorage.getItem('labflow_groups')
        }
      }

      const jsonString = JSON.stringify(backupData, null, 2)
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      
      const now = new Date()
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
      const filename = `LabFlow-备份-${dateStr}-${timeStr}${BACKUP_EXTENSION}`
      
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      alert(language === 'zh' ? '✅ 数据备份成功！' : '✅ Backup successful!')
    } catch (error) {
      console.error('Export failed:', error)
      alert(language === 'zh' ? '❌ 备份失败：' + (error as Error).message : '❌ Backup failed: ' + (error as Error).message)
    } finally {
      setExporting(false)
    }
  }

  // 立即备份到本地快照
  const handleImmediateBackup = () => {
    setSaving(true)
    try {
      const saved = saveSnapshot(false) // 立即备份不跳过相同数据
      if (saved) {
        alert(language === 'zh' ? '✅ 快照已保存！' : '✅ Snapshot saved!')
      } else {
        alert(language === 'zh' ? '⚠️ 数据无变化，未创建新快照' : '⚠️ No changes detected')
      }
    } catch (error) {
      console.error('Save snapshot failed:', error)
      alert(language === 'zh' ? '❌ 保存失败：' + (error as Error).message : '❌ Save failed: ' + (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // 更新定时备份间隔
  const handleIntervalChange = () => {
    const minutes = parseInt(intervalInput, 10)
    if (isNaN(minutes) || minutes < 1) {
      alert(language === 'zh' ? '请输入有效的分钟数（至少1分钟）' : 'Please enter valid minutes (at least 1)')
      return
    }
    updateSettings({ intervalMinutes: minutes })
    alert(language === 'zh' ? `✅ 已设置每 ${minutes} 分钟自动备份` : `✅ Auto backup set to every ${minutes} minutes`)
  }

  // 切换定时备份
  const handleToggleAutoBackup = () => {
    const newEnabled = !settings.enabled
    updateSettings({ enabled: newEnabled })
    if (newEnabled) {
      handleIntervalChange() // 确保间隔已更新
    }
  }

  // 切换"无变化时跳过"
  const handleToggleSkipUnchanged = () => {
    updateSettings({ skipIfUnchanged: !settings.skipIfUnchanged })
  }

  // 导入数据
  const handleImportClick = () => {
    if (confirm(language === 'zh' 
      ? '⚠️ 导入数据会将当前实验室数据覆盖，是否继续？' 
      : '⚠️ Importing will overwrite all current data. Continue?')) {
      fileInputRef.current?.click()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith(BACKUP_EXTENSION)) {
      alert(language === 'zh' 
        ? `❌ 请选择 ${BACKUP_EXTENSION} 格式的备份文件` 
        : `❌ Please select a ${BACKUP_EXTENSION} backup file`)
      return
    }

    setImporting(true)
    try {
      const text = await file.text()
      const backupData: BackupData = JSON.parse(text)
      
      if (!backupData.version || !backupData.data) {
        throw new Error(language === 'zh' ? '无效的备份文件格式' : 'Invalid backup file format')
      }

      // 导入主数据
      const keys = [
        'labflow_tubes',
        'labflow_current_experiment', 
        'labflow_experiments',
        'labflow_tube_histories',
        'substance_colors',
        'labflow_groups'
      ] as const

      for (const key of keys) {
        const value = backupData.data[key]
        if (value !== null) {
          localStorage.setItem(key, value)
        } else {
          localStorage.removeItem(key)
        }
      }

      // 如果备份文件包含快照，也导入
      if (backupData.snapshots && backupData.snapshots.length > 0) {
        localStorage.setItem('labflow_snapshots', JSON.stringify(backupData.snapshots))
      }

      alert(language === 'zh' 
        ? '✅ 数据导入成功！\n页面将重新加载以应用新数据。'
        : '✅ Import successful!\nThe page will reload to apply new data.')
      
      window.location.reload()
    } catch (error) {
      console.error('Import failed:', error)
      alert(language === 'zh' 
        ? '❌ 导入失败：' + (error as Error).message 
        : '❌ Import failed: ' + (error as Error).message)
    } finally {
      setImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // 恢复到指定快照
  const handleRestoreSnapshot = (snapshot: Snapshot) => {
    if (confirm(language === 'zh'
      ? `⚠️ 确定要恢复到此快照？\n\n时间：${new Date(snapshot.timestamp).toLocaleString()}\n试剂：${snapshot.stats.tubes} | 实验：${snapshot.stats.experiments} | 历史：${snapshot.stats.histories} | 分组：${snapshot.stats.groups}\n\n当前数据将被覆盖！`
      : `⚠️ Restore to this snapshot?\n\nTime: ${new Date(snapshot.timestamp).toLocaleString()}\nReagents: ${snapshot.stats.tubes} | Experiments: ${snapshot.stats.experiments} | Histories: ${snapshot.stats.histories} | Groups: ${snapshot.stats.groups}\n\nCurrent data will be overwritten!`)) {
      const success = restoreSnapshot(snapshot.id)
      if (success) {
        alert(language === 'zh' ? '✅ 已恢复到快照，页面将重新加载' : '✅ Restored, page will reload')
        window.location.reload()
      } else {
        alert(language === 'zh' ? '❌ 恢复失败' : '❌ Restore failed')
      }
    }
  }

  // 删除快照
  const handleDeleteSnapshot = (snapshot: Snapshot) => {
    if (confirm(language === 'zh'
      ? `确定删除此快照？\n时间：${new Date(snapshot.timestamp).toLocaleString()}`
      : `Delete this snapshot?\nTime: ${new Date(snapshot.timestamp).toLocaleString()}`)) {
      deleteSnapshot(snapshot.id)
    }
  }

  // 获取当前数据统计
  const getDataStats = () => {
    const tubes = localStorage.getItem('labflow_tubes')
    const experiments = localStorage.getItem('labflow_experiments')
    const histories = localStorage.getItem('labflow_tube_histories')
    const colors = localStorage.getItem('substance_colors')
    const groups = localStorage.getItem('labflow_groups')

    return {
      tubes: tubes ? JSON.parse(tubes).length : 0,
      experiments: experiments ? JSON.parse(experiments).length : 0,
      histories: histories ? JSON.parse(histories).length : 0,
      colors: colors ? JSON.parse(colors).length : 0,
      groups: groups ? JSON.parse(groups).length : 0
    }
  }

  const stats = getDataStats()

  // 格式化时间
  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {language === 'zh' ? '数据备份' : 'Data Backup'}
        </h1>
        <p className={styles.subtitle}>
          {language === 'zh' 
            ? '备份和恢复您的实验室数据' 
            : 'Backup and restore your lab data'}
        </p>
      </header>

      <div className={styles.content}>
        {/* 当前数据概览 */}
        <div className={styles.statsSection}>
          <h3>{language === 'zh' ? '当前数据' : 'Current Data'}</h3>
          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>{stats.tubes}</span>
              <span className={styles.statLabel}>
                {language === 'zh' ? '试剂' : 'Reagents'}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>{stats.experiments}</span>
              <span className={styles.statLabel}>
                {language === 'zh' ? '实验记录' : 'Experiments'}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>{stats.histories}</span>
              <span className={styles.statLabel}>
                {language === 'zh' ? '试管历史' : 'Tube Histories'}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>{stats.colors}</span>
              <span className={styles.statLabel}>
                {language === 'zh' ? '颜色配置' : 'Colors'}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>{stats.groups}</span>
              <span className={styles.statLabel}>
                {language === 'zh' ? '分组' : 'Groups'}
              </span>
            </div>
          </div>
        </div>

        {/* 云端备份（浏览器下载） */}
        <div className={styles.actionSection}>
          <div className={styles.actionCard}>
            <div className={styles.actionIcon}>📦</div>
            <h3>{language === 'zh' ? '导出备份' : 'Export Backup'}</h3>
            <p className={styles.actionDesc}>
              {language === 'zh' 
                ? '下载包含所有数据和快照记录的备份文件' 
                : 'Download a backup file with all data and snapshots'}
            </p>
            <button 
              className={styles.primaryBtn}
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting 
                ? (language === 'zh' ? '导出中...' : 'Exporting...') 
                : (language === 'zh' ? '下载备份文件' : 'Download Backup')}
            </button>
          </div>

          <div className={styles.actionCard}>
            <div className={styles.actionIcon}>📥</div>
            <h3>{language === 'zh' ? '导入数据' : 'Import Data'}</h3>
            <p className={styles.actionDesc}>
              {language === 'zh' 
                ? '从之前导出的备份文件恢复数据' 
                : 'Restore data from a previously exported backup file'}
            </p>
            <button 
              className={styles.secondaryBtn}
              onClick={handleImportClick}
              disabled={importing}
            >
              {importing 
                ? (language === 'zh' ? '导入中...' : 'Importing...') 
                : (language === 'zh' ? '选择文件' : 'Select File')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={BACKUP_EXTENSION}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        {/* 定时备份设置 */}
        <div className={styles.scheduleSection}>
          <h3>{language === 'zh' ? '⏰ 定时备份' : '⏰ Scheduled Backup'}</h3>
          
          <div className={styles.scheduleContent}>
            {/* 立即备份按钮 */}
            <div className={styles.scheduleRow}>
              <button 
                className={styles.scheduleBtn}
                onClick={handleImmediateBackup}
                disabled={saving}
              >
                {saving 
                  ? (language === 'zh' ? '保存中...' : 'Saving...') 
                  : (language === 'zh' ? '💾 立即备份' : '💾 Backup Now')}
              </button>
              <span className={styles.scheduleDesc}>
                {language === 'zh' 
                  ? '立即创建快照保存到本地' 
                  : 'Create a snapshot now'}
              </span>
            </div>

            {/* 定时备份间隔 */}
            <div className={styles.scheduleRow}>
              <div className={styles.intervalInput}>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={handleToggleAutoBackup}
                  id="autoBackupEnabled"
                />
                <label htmlFor="autoBackupEnabled">
                  {language === 'zh' ? '每' : 'Every'}
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={intervalInput}
                  onChange={(e) => setIntervalInput(e.target.value)}
                  onBlur={handleIntervalChange}
                  className={styles.minutesInput}
                />
                <label>
                  {language === 'zh' ? '分钟自动备份' : 'minutes auto backup'}
                </label>
              </div>
              {settings.enabled && (
                <span className={styles.scheduleStatus}>
                  ✅ {language === 'zh' ? '自动备份已启用' : 'Auto backup enabled'}
                </span>
              )}
            </div>

            {/* 无变化时跳过 */}
            <div className={styles.scheduleRow}>
              <div className={styles.intervalInput}>
                <input
                  type="checkbox"
                  checked={settings.skipIfUnchanged}
                  onChange={handleToggleSkipUnchanged}
                  id="skipIfUnchanged"
                />
                <label htmlFor="skipIfUnchanged">
                  {language === 'zh' 
                    ? '数据无变化时跳过备份' 
                    : 'Skip backup if no changes'}
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* 备份记录 */}
        <div className={styles.snapshotSection}>
          <h3>
            {language === 'zh' ? '📋 备份记录' : '📋 Backup History'}
            <span className={styles.snapshotCount}>({snapshots.length})</span>
          </h3>
          
          {snapshots.length === 0 ? (
            <div className={styles.emptySnapshots}>
              {language === 'zh' ? '暂无备份记录' : 'No snapshots yet'}
            </div>
          ) : (
            <div className={styles.snapshotList}>
              {snapshots.map((snapshot) => (
                <div key={snapshot.id} className={styles.snapshotItem}>
                  <div className={styles.snapshotInfo}>
                    <div className={styles.snapshotTime}>
                      {formatTime(snapshot.timestamp)}
                    </div>
                    <div className={styles.snapshotStats}>
                      <span>{language === 'zh' ? '试剂' : 'Reagents'}: {snapshot.stats.tubes}</span>
                      <span>{language === 'zh' ? '实验' : 'Experiments'}: {snapshot.stats.experiments}</span>
                      <span>{language === 'zh' ? '历史' : 'Histories'}: {snapshot.stats.histories}</span>
                      <span>{language === 'zh' ? '分组' : 'Groups'}: {snapshot.stats.groups}</span>
                    </div>
                  </div>
                  <div className={styles.snapshotActions}>
                    <button 
                      className={styles.restoreBtn}
                      onClick={() => handleRestoreSnapshot(snapshot)}
                    >
                      {language === 'zh' ? '恢复到此快照' : 'Restore'}
                    </button>
                    <button 
                      className={styles.deleteBtn}
                      onClick={() => handleDeleteSnapshot(snapshot)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 说明 */}
        <div className={styles.noticeSection}>
          <h4>{language === 'zh' ? '💡 使用说明' : '💡 Instructions'}</h4>
          <ul>
            <li>
              {language === 'zh' 
                ? '定时备份会自动创建快照，可在备份记录中恢复'
                : 'Scheduled backups create snapshots that can be restored from history'}
            </li>
            <li>
              {language === 'zh' 
                ? '导出的 .labflow 文件包含所有数据和快照记录'
                : 'Exported .labflow files include all data and snapshots'}
            </li>
            <li>
              {language === 'zh' 
                ? '建议定期导出备份文件到安全位置'
                : 'Regularly export backup files to a safe location'}
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
