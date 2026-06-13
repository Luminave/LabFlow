import { useState, useEffect } from 'react'
import { useI18nStore } from '../stores/i18nStore'
import { useBackupStore, SnapshotInfo } from '../stores/backupStore'
import styles from './BackupPage.module.css'

export default function BackupPage() {
  const { language } = useI18nStore()
  const {
    snapshots,
    settings,
    dbPath,
    backupDir,
    loading,
    loadSnapshots,
    loadPaths,
    exportBackup,
    importBackup,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    updateSettings,
    openBackupFolder
  } = useBackupStore()

  const [intervalInput, setIntervalInput] = useState(settings.intervalMinutes.toString())
  const isElectron = !!window.electronAPI

  useEffect(() => {
    loadSnapshots()
    if (isElectron) {
      loadPaths()
    }
  }, [loadSnapshots, loadPaths, isElectron])

  useEffect(() => {
    setIntervalInput(settings.intervalMinutes.toString())
  }, [settings.intervalMinutes])

  // 导出备份
  const handleExport = async () => {
    await exportBackup()
  }

  // 导入备份
  const handleImport = async () => {
    if (!confirm(language === 'zh'
      ? '⚠️ 导入数据会将当前实验室数据覆盖，是否继续？'
      : '⚠️ Importing will overwrite all current data. Continue?')) {
      return
    }

    const result = await importBackup()
    if (result.success && result.needsReload) {
      window.location.reload()
    }
  }

  // 立即创建快照
  const handleCreateSnapshot = async () => {
    await createSnapshot()
  }

  // 恢复快照
  const handleRestoreSnapshot = (snapshot: SnapshotInfo) => {
    const timeStr = new Date(snapshot.timestamp).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')
    const historiesCount = snapshot.stats.tubeHistories || snapshot.stats.histories
    const colorsCount = snapshot.stats.substanceColors || 0
    if (!confirm(language === 'zh'
      ? `⚠️ 确定要恢复到此快照？\n\n时间：${timeStr}\n试剂：${snapshot.stats.tubes} | 实验：${snapshot.stats.experiments} | 历史：${historiesCount} | 分组：${snapshot.stats.groups} | 颜色：${colorsCount}\n\n当前数据将被覆盖！`
      : `⚠️ Restore to this snapshot?\n\nTime: ${timeStr}\nReagents: ${snapshot.stats.tubes} | Experiments: ${snapshot.stats.experiments} | Histories: ${historiesCount} | Groups: ${snapshot.stats.groups} | Colors: ${colorsCount}\n\nCurrent data will be overwritten!`)) {
      return
    }

    restoreSnapshot(snapshot.id).then(success => {
      if (success) {
        alert(language === 'zh' ? '✅ 已恢复到快照，页面将重新加载' : '✅ Restored, page will reload')
        window.location.reload()
      }
    })
  }

  // 删除快照
  const handleDeleteSnapshot = (snapshot: SnapshotInfo) => {
    const timeStr = new Date(snapshot.timestamp).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')
    if (confirm(language === 'zh'
      ? `确定删除此快照？\n时间：${timeStr}`
      : `Delete this snapshot?\nTime: ${timeStr}`)) {
      deleteSnapshot(snapshot.id)
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
      handleIntervalChange()
    }
  }

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
            ? '备份和恢复您的实验室数据（数据库级别备份）'
            : 'Backup and restore your lab data (database-level backup)'}
        </p>
      </header>

      <div className={styles.content}>
        {/* 数据库信息 */}
        {isElectron && (
          <div className={styles.statsSection}>
            <h3>{language === 'zh' ? '💾 存储信息' : '💾 Storage Info'}</h3>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>
                  {language === 'zh' ? '数据库路径' : 'Database Path'}
                </span>
                <span className={styles.infoValue}>{dbPath || '...'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>
                  {language === 'zh' ? '备份目录' : 'Backup Directory'}
                </span>
                <span className={styles.infoValue}>{backupDir || '...'}</span>
              </div>
            </div>
            <button
              className={styles.linkBtn}
              onClick={openBackupFolder}
            >
              {language === 'zh' ? '📂 打开备份目录' : '📂 Open Backup Folder'}
            </button>
          </div>
        )}

        {/* 操作区域 */}
        <div className={styles.actionSection}>
          <div className={styles.actionCard}>
            <div className={styles.actionIcon}>📦</div>
            <h3>{language === 'zh' ? '导出备份' : 'Export Backup'}</h3>
            <p className={styles.actionDesc}>
              {language === 'zh'
                ? '将数据库和配置打包为 .labflow 文件，可选择保存位置'
                : 'Package database and config into a .labflow file, choose save location'}
            </p>
            <button
              className={styles.primaryBtn}
              onClick={handleExport}
              disabled={loading || !isElectron}
            >
              {loading
                ? (language === 'zh' ? '导出中...' : 'Exporting...')
                : (language === 'zh' ? '📦 导出备份' : '📦 Export Backup')}
            </button>
            {!isElectron && (
              <p className={styles.disabledNote}>
                {language === 'zh' ? '需要 Electron 环境' : 'Requires Electron environment'}
              </p>
            )}
          </div>

          <div className={styles.actionCard}>
            <div className={styles.actionIcon}>📥</div>
            <h3>{language === 'zh' ? '导入数据' : 'Import Data'}</h3>
            <p className={styles.actionDesc}>
              {language === 'zh'
                ? '从之前导出的 .labflow 文件恢复所有数据'
                : 'Restore all data from a previously exported .labflow file'}
            </p>
            <button
              className={styles.secondaryBtn}
              onClick={handleImport}
              disabled={loading || !isElectron}
            >
              {loading
                ? (language === 'zh' ? '导入中...' : 'Importing...')
                : (language === 'zh' ? '📥 选择文件导入' : '📥 Select File to Import')}
            </button>
            {!isElectron && (
              <p className={styles.disabledNote}>
                {language === 'zh' ? '需要 Electron 环境' : 'Requires Electron environment'}
              </p>
            )}
          </div>
        </div>

        {/* 定时备份设置 */}
        {isElectron && (
          <div className={styles.scheduleSection}>
            <h3>{language === 'zh' ? '⏰ 定时备份' : '⏰ Scheduled Backup'}</h3>

            <div className={styles.scheduleContent}>
              {/* 立即备份按钮 */}
              <div className={styles.scheduleRow}>
                <button
                  className={styles.scheduleBtn}
                  onClick={handleCreateSnapshot}
                  disabled={loading}
                >
                  {loading
                    ? (language === 'zh' ? '保存中...' : 'Saving...')
                    : (language === 'zh' ? '💾 立即备份' : '💾 Backup Now')}
                </button>
                <span className={styles.scheduleDesc}>
                  {language === 'zh'
                    ? '立即创建数据库快照保存到备份目录'
                    : 'Create a database snapshot now in backup directory'}
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
            </div>
          </div>
        )}

        {/* 快照记录 */}
        {isElectron && (
          <div className={styles.snapshotSection}>
            <h3>
              {language === 'zh' ? '📋 快照记录' : '📋 Snapshot History'}
              <span className={styles.snapshotCount}>({snapshots.length})</span>
            </h3>

            {snapshots.length === 0 ? (
              <div className={styles.emptySnapshots}>
                {language === 'zh' ? '暂无快照记录' : 'No snapshots yet'}
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
                        <span>{language === 'zh' ? '历史' : 'Histories'}: {snapshot.stats.tubeHistories || snapshot.stats.histories}</span>
                        <span>{language === 'zh' ? '分组' : 'Groups'}: {snapshot.stats.groups}</span>
                        <span>{language === 'zh' ? '颜色' : 'Colors'}: {snapshot.stats.substanceColors || 0}</span>
                      </div>
                    </div>
                    <div className={styles.snapshotActions}>
                      <button
                        className={styles.restoreBtn}
                        onClick={() => handleRestoreSnapshot(snapshot)}
                      >
                        {language === 'zh' ? '恢复' : 'Restore'}
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
        )}

        {/* 说明 */}
        <div className={styles.noticeSection}>
          <h4>{language === 'zh' ? '💡 使用说明' : '💡 Instructions'}</h4>
          <ul>
            <li>
              {language === 'zh'
                ? '导出的 .labflow 文件包含完整的数据库和前端配置（分组、颜色等）'
                : 'Exported .labflow files contain the complete database and frontend config (groups, colors, etc.)'}
            </li>
            <li>
              {language === 'zh'
                ? '快照是数据库的即时副本，存储在备份目录中，最多保留 50 个'
                : 'Snapshots are instant database copies stored in the backup directory, max 50 retained'}
            </li>
            <li>
              {language === 'zh'
                ? '定时备份由主进程管理，即使页面未打开也会自动执行'
                : 'Scheduled backups are managed by the main process, runs automatically even when the page is not open'}
            </li>
            <li>
              {language === 'zh'
                ? '建议定期导出 .labflow 文件到安全位置（如云盘、U盘）'
                : 'Regularly export .labflow files to a safe location (cloud storage, USB drive)'}
            </li>
            {isElectron && (
              <li>
                {language === 'zh'
                  ? '支持导入旧版 v1.x 格式的备份文件（仅恢复前端数据）'
                  : 'Supports importing legacy v1.x backup files (frontend data only)'}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
