import { useState, useRef } from 'react'
import { useI18nStore } from '../stores/i18nStore'
import styles from './BackupPage.module.css'

// 备份数据结构
interface BackupData {
  version: string
  timestamp: string
  data: {
    labflow_tubes: string | null
    labflow_current_experiment: string | null
    labflow_experiments: string | null
    labflow_tube_histories: string | null
    substance_colors: string | null
  }
}

const BACKUP_VERSION = '1.0.0'
const BACKUP_EXTENSION = '.labflow'

export default function BackupPage() {
  const { language } = useI18nStore()
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 备份数据
  const handleExport = () => {
    setExporting(true)
    try {
      // 收集所有 localStorage 数据
      const backupData: BackupData = {
        version: BACKUP_VERSION,
        timestamp: new Date().toISOString(),
        data: {
          labflow_tubes: localStorage.getItem('labflow_tubes'),
          labflow_current_experiment: localStorage.getItem('labflow_current_experiment'),
          labflow_experiments: localStorage.getItem('labflow_experiments'),
          labflow_tube_histories: localStorage.getItem('labflow_tube_histories'),
          substance_colors: localStorage.getItem('substance_colors')
        }
      }

      // 转换为 JSON 字符串
      const jsonString = JSON.stringify(backupData, null, 2)
      
      // 创建 Blob 并下载
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      
      // 生成文件名：LabFlow-备份-日期时间.labflow
      const now = new Date()
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
      const filename = `LabFlow-备份-${dateStr}-${timeStr}${BACKUP_EXTENSION}`
      
      // 触发下载
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

    // 检查文件扩展名
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
      
      // 验证备份数据格式
      if (!backupData.version || !backupData.data) {
        throw new Error(language === 'zh' ? '无效的备份文件格式' : 'Invalid backup file format')
      }

      // 检查版本兼容性
      if (backupData.version !== BACKUP_VERSION) {
        console.warn(`Backup version ${backupData.version} differs from current ${BACKUP_VERSION}`)
      }

      // 导入数据到 localStorage
      const keys = [
        'labflow_tubes',
        'labflow_current_experiment', 
        'labflow_experiments',
        'labflow_tube_histories',
        'substance_colors'
      ] as const

      for (const key of keys) {
        const value = backupData.data[key]
        if (value !== null) {
          localStorage.setItem(key, value)
        } else {
          localStorage.removeItem(key)
        }
      }

      alert(language === 'zh' 
        ? '✅ 数据导入成功！\n页面将重新加载以应用新数据。'
        : '✅ Import successful!\nThe page will reload to apply new data.')
      
      // 重新加载页面以应用导入的数据
      window.location.reload()
    } catch (error) {
      console.error('Import failed:', error)
      alert(language === 'zh' 
        ? '❌ 导入失败：' + (error as Error).message 
        : '❌ Import failed: ' + (error as Error).message)
    } finally {
      setImporting(false)
      // 清空文件输入，允许重新选择同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // 获取当前数据统计
  const getDataStats = () => {
    const tubes = localStorage.getItem('labflow_tubes')
    const experiments = localStorage.getItem('labflow_experiments')
    const histories = localStorage.getItem('labflow_tube_histories')
    const colors = localStorage.getItem('substance_colors')

    return {
      tubes: tubes ? JSON.parse(tubes).length : 0,
      experiments: experiments ? JSON.parse(experiments).length : 0,
      histories: histories ? JSON.parse(histories).length : 0,
      colors: colors ? JSON.parse(colors).length : 0
    }
  }

  const stats = getDataStats()

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
                {language === 'zh' ? '颜色配置' : 'Color Settings'}
              </span>
            </div>
          </div>
        </div>

        {/* 备份功能 */}
        <div className={styles.actionSection}>
          <div className={styles.actionCard}>
            <div className={styles.actionIcon}>📦</div>
            <h3>{language === 'zh' ? '备份数据' : 'Backup Data'}</h3>
            <p className={styles.actionDesc}>
              {language === 'zh' 
                ? '导出所有数据，请定期备份数据避免数据丢失' 
                : 'Export all data. Please backup regularly to avoid data loss'}
            </p>
            <button 
              className={styles.primaryBtn}
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting 
                ? (language === 'zh' ? '备份中...' : 'Backing up...') 
                : (language === 'zh' ? '开始备份' : 'Start Backup')}
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

        {/* 说明 */}
        <div className={styles.noticeSection}>
          <h4>{language === 'zh' ? '💡 使用说明' : '💡 Instructions'}</h4>
          <ul>
            <li>
              {language === 'zh' 
                ? '备份文件格式为 .labflow，包含所有试剂、实验记录、试管历史和颜色配置'
                : 'Backup files use .labflow format and include all reagents, experiments, tube histories, and color settings'}
            </li>
            <li>
              {language === 'zh' 
                ? '建议定期备份，特别是在进行重要实验前后'
                : 'Regular backups are recommended, especially before and after important experiments'}
            </li>
            <li>
              {language === 'zh' 
                ? '导入数据会覆盖当前所有数据，请谨慎操作'
                : 'Importing will overwrite all current data, please proceed with caution'}
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
