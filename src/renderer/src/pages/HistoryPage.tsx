import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useExperimentStore } from '../stores/experimentStore'
import { useWarehouseStore } from '../stores/warehouseStore'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import styles from './HistoryPage.module.css'

export default function HistoryPage() {
  const navigate = useNavigate()
  const { experiments, revertExperiment, deleteExperiment, loadExperiment } = useExperimentStore()
  const { fetchTubes } = useWarehouseStore()
  const { language } = useI18nStore()
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(null)
  
  const statusLabels: Record<string, string> = {
    draft: t('status.draft', language),
    completed: t('status.completed', language),
    reverted: t('status.reverted', language)
  }
  
  const statusColors: Record<string, string> = {
    draft: '#3b82f6',
    completed: '#10b981',
    reverted: '#94a3b8'
  }
  
  // 找出最新的已完成实验（只能回退这个）
  const latestCompletedExperiment = experiments
    .filter(e => e.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime())[0]
  
  const handleRevert = async (id: string) => {
    // 检查是否是最新的已完成实验
    if (latestCompletedExperiment && latestCompletedExperiment.id !== id) {
      alert(language === 'zh' ? '只能回退最新的已完成实验！\n\n请先回退或删除更晚的实验。' : 'Can only revert the latest completed experiment!\n\nPlease revert or delete later experiments first.')
      return
    }
    
    if (confirm(language === 'zh' ? '确定要回退这个实验吗？\n\n试剂仓库将恢复到实验前的状态，并跳转到实验模拟页面。' : 'Revert this experiment?\n\nWarehouse will be restored and you will be redirected to Experiment page.')) {
      const success = await revertExperiment(id)
      if (success) {
        await fetchTubes() // 刷新仓库显示
        // 加载回退后的实验
        loadExperiment(id)
        // 跳转到实验模拟页面
        navigate('/experiment')
        alert(language === 'zh' ? '实验已回退，试剂仓库已恢复' : 'Experiment reverted, warehouse restored')
      }
    }
  }
  
  const handleDelete = (id: string) => {
    if (confirm(language === 'zh' ? '确定删除这条实验记录？此操作不可恢复。' : 'Delete this experiment record? This cannot be undone.')) {
      deleteExperiment(id)
      if (selectedExperiment === id) {
        setSelectedExperiment(null)
      }
    }
  }
  
  const handleOpen = (id: string) => {
    loadExperiment(id)
    navigate('/') // 跳转到实验模拟页面
  }
  
  const selected = experiments.find(e => e.id === selectedExperiment)
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('history.title', language)}</h1>
      </header>
      
      <div className={styles.content}>
        {/* 实验列表 */}
        <div className={styles.list}>
          {experiments.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📋</div>
              <p>{t('history.emptyHint', language)}</p>
              <p className={styles.emptyHint}>{language === 'zh' ? '完成实验后将自动保存到这里' : 'Completed experiments will be saved here'}</p>
            </div>
          ) : (
            experiments.map(exp => (
              <div
                key={exp.id}
                className={`${styles.item} ${selectedExperiment === exp.id ? styles.itemActive : ''}`}
                onClick={() => setSelectedExperiment(exp.id)}
              >
                <div className={styles.itemHeader}>
                  <h3 className={styles.itemName}>{exp.name}</h3>
                  <span 
                    className={styles.itemStatus}
                    style={{ backgroundColor: statusColors[exp.status] }}
                  >
                    {statusLabels[exp.status]}
                  </span>
                </div>
                
                <div className={styles.itemMeta}>
                  <span>{language === 'zh' ? '创建于' : 'Created'} {new Date(exp.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</span>
                  {exp.completedAt && (
                    <span> · {language === 'zh' ? '完成于' : 'Completed'} {new Date(exp.completedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</span>
                  )}
                </div>
                
                <div className={styles.itemStats}>
                  <span>{exp.tubes?.length || 0} {t('history.tubes', language)}</span>
                  <span>{exp.connections?.length || 0} {language === 'zh' ? '次移液' : 'transfers'}</span>
                </div>
              </div>
            ))
          )}
        </div>
        
        {/* 实验详情 */}
        {selected && (
          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              <h2>{selected.name}</h2>
              <div className={styles.detailActions}>
                <button 
                  className={styles.openBtn}
                  onClick={() => handleOpen(selected.id)}
                >
                  {language === 'zh' ? '打开工程' : 'Open Project'}
                </button>
                {selected.status === 'completed' && (
                  <button 
                    className={styles.revertBtn}
                    onClick={() => handleRevert(selected.id)}
                    disabled={latestCompletedExperiment && latestCompletedExperiment.id !== selected.id}
                    title={
                      latestCompletedExperiment && latestCompletedExperiment.id !== selected.id
                        ? (language === 'zh' ? '只能回退最新的已完成实验' : 'Can only revert latest completed experiment')
                        : (language === 'zh' ? '回退实验，恢复试剂仓库' : 'Revert experiment, restore warehouse')
                    }
                    style={{
                      opacity: latestCompletedExperiment && latestCompletedExperiment.id !== selected.id ? 0.5 : 1,
                      cursor: latestCompletedExperiment && latestCompletedExperiment.id !== selected.id ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {language === 'zh' ? '回退实验' : 'Revert'}
                  </button>
                )}
                <button 
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(selected.id)}
                >
                  {language === 'zh' ? '删除记录' : 'Delete'}
                </button>
              </div>
              
              {selected.status === 'completed' && latestCompletedExperiment && latestCompletedExperiment.id !== selected.id && (
                <div className={styles.warning}>
                  ⚠️ {language === 'zh' ? '只能回退最新的已完成实验' : 'Can only revert latest completed experiment'}（{latestCompletedExperiment.name}）
                </div>
              )}
            </div>
            
            <div className={styles.detailBody}>
              <div className={styles.section}>
                <h4>{language === 'zh' ? '实验信息' : 'Experiment Info'}</h4>
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>{language === 'zh' ? '创建时间' : 'Created'}</span>
                    <span>{new Date(selected.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</span>
                  </div>
                  {selected.completedAt && (
                    <div className={styles.infoItem}>
                      <span className={styles.infoLabel}>{language === 'zh' ? '完成时间' : 'Completed'}</span>
                      <span>{new Date(selected.completedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</span>
                    </div>
                  )}
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>{language === 'zh' ? '状态' : 'Status'}</span>
                    <span style={{ color: statusColors[selected.status] }}>
                      {statusLabels[selected.status]}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className={styles.section}>
                <h4>{language === 'zh' ? '涉及的试管' : 'Tubes Involved'}</h4>
                <div className={styles.tubeList}>
                  {(() => {
                    // 过滤掉缓冲液实例，合并显示仓库缓冲液
                    const bufferUsage = new Map<string, { name: string; totalVolume: number; unit: string }>()
                    
                    const filteredTubes = (selected.tubes || []).filter((tube: any) => {
                      if (tube.type === 'buffer' && tube.id.startsWith('buffer-')) {
                        // 提取仓库缓冲液 ID
                        const parts = tube.id.split('-')
                        if (parts.length >= 3) {
                          const warehouseBufferId = parts.slice(1, -1).join('-')
                          const existing = bufferUsage.get(warehouseBufferId)
                          
                          // 计算该缓冲液的总输出
                          const outConns = (selected.connections || []).filter((c: any) => c.fromTubeId === tube.id)
                          const totalOut = outConns.reduce((sum: number, c: any) => sum + c.volume, 0)
                          
                          if (existing) {
                            existing.totalVolume += totalOut
                          } else {
                            bufferUsage.set(warehouseBufferId, {
                              name: tube.name,
                              totalVolume: totalOut,
                              unit: tube.remainingVolumeUnit
                            })
                          }
                        }
                        return false
                      }
                      return true
                    })
                    
                    // 将缓冲液合并结果显示
                    const bufferItems = Array.from(bufferUsage.entries()).map(([id, data]) => ({
                      id,
                      name: data.name,
                      type: 'buffer',
                      remainingVolume: data.totalVolume,
                      remainingVolumeUnit: data.unit,
                      isBufferUsage: true
                    }))
                    
                    return [...filteredTubes, ...bufferItems].map((tube: any) => (
                      <div key={tube.id} className={styles.tubeItem}>
                        <div className={styles.tubeInfo}>
                          <strong>{tube.name}</strong>
                          <span className={styles.tubeType}>
                            {tube.type === 'source' ? t('tube.source', language) : 
                             tube.type === 'buffer' ? t('tube.buffer', language) : t('tube.intermediate', language)}
                          </span>
                        </div>
                        <div className={styles.tubeVolume}>
                          {tube.isBufferUsage ? (
                            <span>{language === 'zh' ? '消耗' : 'Used'} {tube.remainingVolume} {tube.remainingVolumeUnit}</span>
                          ) : (
                            tube.remainingVolume === Infinity ? '∞' : `${tube.remainingVolume} ${tube.remainingVolumeUnit}`
                          )}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
              
              <div className={styles.section}>
                <h4>{language === 'zh' ? '移液操作' : 'Transfer Operations'}</h4>
                <div className={styles.connectionList}>
                  {(selected.connections || []).map((conn: any) => {
                    const fromTube = selected.tubes?.find((t: any) => t.id === conn.fromTubeId)
                    const toTube = selected.tubes?.find((t: any) => t.id === conn.toTubeId)
                    return (
                      <div key={conn.id} className={styles.connectionItem}>
                        <span className={styles.tubeName}>{fromTube?.name || conn.fromTubeId}</span>
                        <span className={styles.arrow}>→</span>
                        <span className={styles.volume}>{conn.volume} {conn.volumeUnit}</span>
                        <span className={styles.arrow}>→</span>
                        <span className={styles.tubeName}>{toTube?.name || conn.toTubeId}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
