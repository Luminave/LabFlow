import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getAllTubeHistories } from '../stores/experimentStore'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { useWarehouseStore } from '../stores/warehouseStore'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import styles from './TracePage.module.css'

interface TubeHistory {
  tubeId: string
  tubeName: string
  tubeType: string
  records: {
    id: string
    tubeId: string
    experimentId: string
    experimentName: string
    action: 'created' | 'transfer_in' | 'transfer_out'
    timestamp: string
    volumeBefore: number
    volumeAfter: number
    volumeUnit: string
    substancesBefore: any[]
    substancesAfter: any[]
    transferFrom?: string
    transferTo?: string
    transferVolume?: number
  }[]
  currentVolume: number
  currentVolumeUnit: string
  currentSubstances: any[]
}

// 成分显示组件（带颜色高亮）
function SubstanceDisplay({ name, concentration, concentrationUnit }: { name: string; concentration: number; concentrationUnit: string }) {
  const { colors } = useSubstanceColorStore()
  const colorConfig = colors.get(name)
  
  const style = colorConfig ? {
    color: colorConfig.color,
    backgroundColor: colorConfig.bgColor,
    padding: '1px 6px',
    borderRadius: '4px'
  } : {}
  
  return (
    <span className={styles.substanceMini}>
      <span style={style}>{name}</span> ({concentration} {concentrationUnit})
    </span>
  )
}

export default function TracePage() {
  const [searchParams] = useSearchParams()
  const [tubes, setTubes] = useState<TubeHistory[]>([])
  const [selectedTube, setSelectedTube] = useState<TubeHistory | null>(null)
  const [searchText, setSearchText] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const { loadColors } = useSubstanceColorStore()
  const { tubes: warehouseTubes, fetchTubes } = useWarehouseStore()
  const { language } = useI18nStore()
  
  useEffect(() => {
    fetchTubes()
    loadColors()
  }, [fetchTubes, loadColors])
  
  useEffect(() => {
    const histories = getAllTubeHistories()
    // 建立仓库试管名称映射（以仓库中的名称为准）
    const nameMap = new Map(warehouseTubes.map(t => [t.id, t.name]))
    // 过滤掉缓冲液类型和上样类型的试管
    const tubeList = Array.from(histories.values()).filter(tube => 
      tube.tubeType !== 'buffer' && tube.tubeType !== 'sample'
    ).map(tube => ({
      ...tube,
      tubeName: nameMap.get(tube.tubeId) || tube.tubeName
    }))
    setTubes(tubeList)
    
    // 如果 URL 指定了 tubeId，自动选中
    const tubeId = searchParams.get('tubeId')
    if (tubeId) {
      const tube = tubeList.find(t => t.tubeId === tubeId)
      if (tube) {
        setSelectedTube(tube)
      }
    }
  }, [searchParams, warehouseTubes])
  
  // 筛选和搜索
  const filteredTubes = tubes.filter(tube => {
    // 类型筛选
    if (filterType !== 'all' && tube.tubeType !== filterType) {
      return false
    }
    // 搜索
    if (searchText) {
      const search = searchText.toLowerCase()
      return tube.tubeName.toLowerCase().includes(search) ||
        tube.currentSubstances.some((s: any) => s.name.toLowerCase().includes(search))
    }
    return true
  })
  
  const actionLabels: Record<string, string> = {
    created: language === 'zh' ? '创建试管' : 'Created',
    transfer_in: language === 'zh' ? '接收物质' : 'Transfer In',
    transfer_out: language === 'zh' ? '移出物质' : 'Transfer Out'
  }
  
  const actionColors: Record<string, string> = {
    created: '#10b981',
    transfer_in: '#3b82f6',
    transfer_out: '#f59e0b'
  }
  
  const typeLabels: Record<string, string> = {
    source: t('tube.source', language),
    intermediate: t('tube.intermediate', language),
    buffer: t('tube.buffer', language)
  }
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('trace.title', language)}</h1>
        <p className={styles.subtitle}>{language === 'zh' ? '查看每个试管的完整操作档案' : 'View complete operation history for each tube'}</p>
      </header>
      
      <div className={styles.content}>
        <div className={styles.list}>
          {/* 筛选和搜索 */}
          <div className={styles.filterBar}>
            <input
              type="text"
              placeholder={t('warehouse.searchPlaceholder', language)}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={styles.searchInput}
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="all">{language === 'zh' ? '全部类型' : 'All Types'}</option>
              <option value="source">{t('tube.source', language)}</option>
              <option value="intermediate">{t('tube.intermediate', language)}</option>
              <option value="buffer">{t('tube.buffer', language)}</option>
            </select>
          </div>
          
          {filteredTubes.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>🔍</div>
              <p>{tubes.length === 0 ? (language === 'zh' ? '暂无试管记录' : 'No tube records') : (language === 'zh' ? '没有匹配的试管' : 'No matching tubes')}</p>
              <p style={{ fontSize: 12, marginTop: 8, color: '#64748b' }}>
                {tubes.length === 0 ? (language === 'zh' ? '完成实验后，试管操作记录将显示在这里' : 'Tube records will appear after completing experiments') : (language === 'zh' ? '请尝试其他搜索条件' : 'Try other search criteria')}
              </p>
            </div>
          ) : (
            filteredTubes.map(tube => (
              <div
                key={tube.tubeId}
                className={`${styles.item} ${selectedTube?.tubeId === tube.tubeId ? styles.itemActive : ''}`}
                onClick={() => setSelectedTube(tube)}
              >
                <div className={styles.itemHeader}>
                  <span className={styles.itemName}>{tube.tubeName}</span>
                  <span className={styles.typeTag}>{typeLabels[tube.tubeType] || tube.tubeType}</span>
                </div>
                <div className={styles.itemMeta}>
                  {language === 'zh' ? '当前体积:' : 'Current Volume:'} {tube.currentVolume === Infinity ? '∞' : `${tube.currentVolume} ${tube.currentVolumeUnit}`}
                </div>
                <div className={styles.itemSubstances}>
                  {tube.currentSubstances.slice(0, 3).map((s: any, i: number) => (
                    <span key={i} className={styles.substanceTag}>{s.name}</span>
                  ))}
                  {tube.currentSubstances.length > 3 && (
                    <span className={styles.substanceTag}>+{tube.currentSubstances.length - 3}</span>
                  )}
                  {tube.currentSubstances.length === 0 && (
                    <span className={styles.substanceTag} style={{ color: '#94a3b8' }}>{language === 'zh' ? '无物质' : 'No Substances'}</span>
                  )}
                </div>
                <div className={styles.recordCount}>
                  {tube.records.length} {language === 'zh' ? '条操作记录' : 'records'}
                </div>
              </div>
            ))
          )}
        </div>
        
        {selectedTube && (
          <div className={styles.detail}>
            <h2>{selectedTube.tubeName}</h2>
            <p className={styles.tubeId}>ID: {selectedTube.tubeId}</p>
            
            <div className={styles.section}>
              <h4>{language === 'zh' ? '当前状态' : 'Current Status'}</h4>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>{language === 'zh' ? '类型' : 'Type'}</span>
                  <span>{typeLabels[selectedTube.tubeType] || selectedTube.tubeType}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>{language === 'zh' ? '当前体积' : 'Current Volume'}</span>
                  <span>
                    {selectedTube.currentVolume === Infinity 
                      ? '∞' 
                      : `${selectedTube.currentVolume} ${selectedTube.currentVolumeUnit}`}
                  </span>
                </div>
              </div>
            </div>
            
            <div className={styles.section}>
              <h4>{language === 'zh' ? '当前物质组成' : 'Current Substances'}</h4>
              <div className={styles.substanceList}>
                {selectedTube.currentSubstances.length > 0 ? (
                  selectedTube.currentSubstances.map((s: any, i: number) => (
                    <SubstanceDisplay 
                      key={i}
                      name={s.name}
                      concentration={s.concentration}
                      concentrationUnit={s.concentrationUnit}
                    />
                  ))
                ) : (
                  <p className={styles.emptyText}>{language === 'zh' ? '无物质（缓冲液或空试管）' : 'No substances (buffer or empty tube)'}</p>
                )}
              </div>
            </div>
            
            <div className={styles.section}>
              <h4>{language === 'zh' ? '操作档案' : 'Operation History'} ({selectedTube.records.length} {language === 'zh' ? '条记录' : 'records'})</h4>
              {selectedTube.records.length > 0 ? (
                <div className={styles.experimentsList}>
                  {/* 按实验分组 */}
                  {(() => {
                    // 按实验ID分组
                    const experimentsMap = new Map<string, typeof selectedTube.records>()
                    selectedTube.records.forEach(record => {
                      const expId = record.experimentId || 'warehouse'
                      if (!experimentsMap.has(expId)) {
                        experimentsMap.set(expId, [])
                      }
                      experimentsMap.get(expId)!.push(record)
                    })
                    
                    // 渲染每个实验组
                    return Array.from(experimentsMap.entries()).map(([expId, records]) => {
                      const expName = records[0]?.experimentName || (language === 'zh' ? '试剂仓库' : 'Warehouse')
                      const startTime = records[0]?.timestamp
                      const endTime = records[records.length - 1]?.timestamp
                      
                      return (
                        <div key={expId} className={styles.experimentGroup}>
                          <div className={styles.experimentHeader}>
                            <h5 className={styles.experimentName}>
                              {expId === 'warehouse' ? '🏠' : '🔬'} {expName}
                            </h5>
                            <span className={styles.experimentTime}>
                              {new Date(startTime).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                          
                          <div className={styles.timeline}>
                            {records.map((record, i) => (
                              <div key={i} className={styles.timelineItem}>
                                <div 
                                  className={styles.timelineDot}
                                  style={{ background: actionColors[record.action] || '#94a3b8' }}
                                />
                                <div className={styles.timelineContent}>
                                  <div className={styles.timelineHeader}>
                                    <span 
                                      className={styles.actionTag}
                                      style={{ background: actionColors[record.action] || '#94a3b8' }}
                                    >
                                      {actionLabels[record.action] || record.action}
                                    </span>
                                    <span className={styles.timelineTime}>
                                      {new Date(record.timestamp).toLocaleTimeString('zh-CN')}
                                    </span>
                                  </div>
                                  
                                  <div className={styles.recordDetails}>
                                    <div className={styles.volumeInfo}>
                                      <span>{language === 'zh' ? '体积' : 'Volume'}: {record.volumeBefore} → {record.volumeAfter} {record.volumeUnit}</span>
                                      {record.transferVolume !== undefined && (
                                        <span className={styles.volumeChange}>
                                          ({record.action === 'transfer_out' ? '-' : '+'}{record.transferVolume} {record.volumeUnit})
                                        </span>
                                      )}
                                    </div>
                                    
                                    {record.action === 'transfer_in' && record.transferFrom && (
                                      <p className={styles.transferInfo}>
                                        ← {language === 'zh' ? '从试管' : 'From tube'} {record.transferFrom.slice(0, 8)}...
                                      </p>
                                    )}
                                    
                                    {record.action === 'transfer_out' && record.transferTo && (
                                      <p className={styles.transferInfo}>
                                        → {language === 'zh' ? '到试管' : 'To tube'} {record.transferTo.slice(0, 8)}...
                                      </p>
                                    )}
                                    
                                    {record.substancesAfter.length > 0 && (
                                      <div className={styles.substancesChange}>
                                        <span>{language === 'zh' ? '物质:' : 'Substances:'}</span>
                                        {record.substancesAfter.map((s: any, j: number) => (
                                          <SubstanceDisplay 
                                            key={j}
                                            name={s.name}
                                            concentration={s.concentration}
                                            concentrationUnit={s.concentrationUnit}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              ) : (
                <p className={styles.emptyText}>{language === 'zh' ? '暂无操作记录' : 'No operation records'}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
