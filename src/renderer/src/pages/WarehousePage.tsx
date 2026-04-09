import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWarehouseStore } from '../stores/warehouseStore'
import { useExperimentStore } from '../stores/experimentStore'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { TubeType, TubeStatus, VolumeUnit, ConcentrationUnit } from '@shared/types'
import styles from './WarehousePage.module.css'

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
    <span className={styles.substance}>
      <span style={style}>{name}</span> ({concentration} {concentrationUnit})
    </span>
  )
}

export default function WarehousePage() {
  const navigate = useNavigate()
  const { tubes, addTube, deleteTube, updateTubeStatus, updateTube, fetchTubes, loading } = useWarehouseStore()
  const { currentExperiment, addSourceTube, currentTubes } = useExperimentStore()
  const { loadColors } = useSubstanceColorStore()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingTube, setEditingTube] = useState<any>(null)
  
  // 加载已保存的试管和颜色配置
  useEffect(() => {
    fetchTubes()
    loadColors()
  }, [fetchTubes, loadColors])
  
  const handleAddTube = async (data: any) => {
    // 先添加到 store
    const tube = await addTube(data)
    
    // 再保存到数据库
    if (window.electronAPI) {
      try {
        await window.electronAPI.addTube(tube)
        console.log('Tube saved to database:', tube.id)
      } catch (e) {
        console.error('Failed to save tube:', e)
      }
    }
    
    setShowAddForm(false)
  }
  
  const handleDeleteTube = async (id: string) => {
    deleteTube(id)
    if (window.electronAPI) {
      await window.electronAPI.deleteTube(id)
    }
  }
  
  const handleStatusChange = async (id: string, status: string) => {
    const tube = tubes.find(t => t.id === id)
    if (!tube) return
    
    updateTubeStatus(id, status as any)
    
    if (window.electronAPI) {
      await window.electronAPI.updateTube({ ...tube, status })
    }
  }
  
  // 添加到当前实验
  const handleAddToExperiment = (tube: any) => {
    if (!currentExperiment) {
      alert('请先创建或打开一个实验')
      navigate('/experiment')
      return
    }
    
    // 检查是否已在实验中
    if (currentTubes.find(t => t.id === tube.id)) {
      alert('该试管已在实验中')
      return
    }
    
    // 添加到实验
    addSourceTube(tube)
    alert(`已将 ${tube.name} 添加到当前实验`)
  }
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>试剂仓库</h1>
        <button className={styles.addButton} onClick={() => setShowAddForm(true)}>
          + 添加试剂
        </button>
      </header>
      
      {showAddForm && (
        <AddTubeForm 
          onClose={() => setShowAddForm(false)}
          onSubmit={handleAddTube}
        />
      )}
      
      <div className={styles.tubeList}>
        {loading ? (
          <div className={styles.empty}>加载中...</div>
        ) : tubes.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📦</div>
            <p>仓库为空</p>
            <p className={styles.emptyHint}>点击上方按钮添加第一个试剂</p>
          </div>
        ) : (
          tubes.map(tube => (
            <TubeCard 
              key={tube.id}
              tube={tube}
              onDelete={() => handleDeleteTube(tube.id)}
              onStatusChange={(status: string) => handleStatusChange(tube.id, status)}
              onEdit={() => setEditingTube(tube)}
              onAddToExperiment={() => handleAddToExperiment(tube)}
              hasExperiment={!!currentExperiment}
            />
          ))
        )}
      </div>
      
      {/* 试剂详情/编辑弹窗 */}
      {editingTube && (
        <TubeDetailModal 
          tube={editingTube}
          onClose={() => setEditingTube(null)}
          onSave={async (updatedTube: any) => {
            const { id, ...updates } = updatedTube
            updateTube(id, updates)
            if (window.electronAPI) {
              await window.electronAPI.updateTube(updatedTube)
            }
            setEditingTube(null)
          }}
        />
      )}
    </div>
  )
}

function TubeCard({ tube, onDelete, onStatusChange, onEdit, onAddToExperiment, hasExperiment }: any) {
  const statusColors: Record<string, string> = {
    active: '#10b981',
    depleted: '#f59e0b',
    discarded: '#ef4444'
  }
  
  const statusLabels: Record<string, string> = {
    active: '可用',
    depleted: '不足',
    discarded: '已弃'
  }
  
  const typeLabels: Record<string, string> = {
    source: '📦 原料',
    buffer: '💧 缓冲液',
    intermediate: '🧪 中间产物'
  }
  
  return (
    <div className={styles.tubeCard}>
      <div className={styles.tubeHeader}>
        <h3 className={styles.tubeName}>{tube.name}</h3>
        <span className={styles.tubeStatus} style={{ backgroundColor: statusColors[tube.status] }}>
          {statusLabels[tube.status]}
        </span>
      </div>
      
      <div className={styles.tubeBody}>
        <div className={styles.tubeInfo}>
          <span className={styles.label}>类型:</span>
          <span>{typeLabels[tube.type] || tube.type}</span>
        </div>
        
        <div className={styles.tubeInfo}>
          <span className={styles.label}>体积:</span>
          <span>{tube.remainingVolume === Infinity ? '∞' : `${tube.remainingVolume} / ${tube.totalVolume === Infinity ? '∞' : tube.totalVolume}`} {tube.totalVolumeUnit}</span>
        </div>
        
        {tube.type !== 'buffer' && (
          <div className={styles.tubeInfo}>
            <span className={styles.label}>物质:</span>
            <div className={styles.substances}>
              {tube.substances.map((s: any, i: number) => (
                <SubstanceDisplay 
                  key={i}
                  name={s.name}
                  concentration={s.concentration}
                  concentrationUnit={s.concentrationUnit}
                />
              ))}
            </div>
          </div>
        )}
        
        {tube.storageLocation && (
          <div className={styles.tubeInfo}>
            <span className={styles.label}>位置:</span>
            <span>{tube.storageLocation}</span>
          </div>
        )}
        
        {tube.storageCondition && (
          <div className={styles.tubeInfo}>
            <span className={styles.label}>条件:</span>
            <span>{tube.storageCondition}</span>
          </div>
        )}
      </div>
      
      <div className={styles.tubeActions}>
        {tube.status === 'active' && (
          <button 
            className={styles.addBtn} 
            onClick={onAddToExperiment}
            title={hasExperiment ? "添加到当前实验" : "请先创建实验"}
          >
            ➕ 实验
          </button>
        )}
        <button className={styles.actionBtn} onClick={onEdit}>
          ✏️ 编辑
        </button>
        <button className={styles.actionBtn} onClick={onDelete}>
          🗑️ 删除
        </button>
        <select 
          className={styles.statusSelect}
          value={tube.status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="active">可用</option>
          <option value="depleted">不足</option>
          <option value="discarded">已弃</option>
        </select>
      </div>
    </div>
  )
}

function AddTubeForm({ onClose, onSubmit }: any) {
  const [formData, setFormData] = useState<{
    name: string
    type: TubeType
    totalVolume: number
    totalVolumeUnit: VolumeUnit
    remainingVolume: number
    remainingVolumeUnit: VolumeUnit
    isInfinite: boolean
    substances: { name: string; concentration: number; concentrationUnit: ConcentrationUnit }[]
    storageLocation: string
    storageCondition: string
    notes: string
    status: TubeStatus
  }>({
    name: '',
    type: 'source',
    totalVolume: 100,
    totalVolumeUnit: 'μL',
    remainingVolume: 100,
    remainingVolumeUnit: 'μL',
    isInfinite: false,
    substances: [{ name: '', concentration: 0, concentrationUnit: 'μM' }],
    storageLocation: '',
    storageCondition: '',
    notes: '',
    status: 'active'
  })
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('请输入名称')
      return
    }
    
    const substances = formData.type === 'buffer' 
      ? [] 
      : formData.substances.filter(s => s.name.trim())
    
    onSubmit({
      ...formData,
      substances,
      totalVolume: formData.isInfinite ? Infinity : formData.totalVolume,
      remainingVolume: formData.isInfinite ? Infinity : formData.totalVolume
    })
  }
  
  return (
    <div className={styles.modal} onClick={onClose}>
      <div className={styles.modalContentWide} onClick={e => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>添加试剂</h2>
        
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>名称 *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="如: E1, DNA Sample A"
                autoFocus
              />
            </div>
          </div>
          
          <div className={styles.formRow3}>
            <div className={styles.formGroup}>
              <label>总体积 {formData.type !== 'intermediate' && '*'}</label>
              <input
                type="number"
                value={formData.isInfinite ? '' : formData.totalVolume}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  totalVolume: Number(e.target.value),
                  remainingVolume: Number(e.target.value)
                })}
                min="0"
                step="0.1"
                disabled={formData.isInfinite}
                placeholder={formData.isInfinite ? '∞ 无限' : ''}
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>单位</label>
              <select
                value={formData.totalVolumeUnit}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  totalVolumeUnit: e.target.value as any,
                  remainingVolumeUnit: e.target.value as any
                })}
              >
                <option value="μL">μL</option>
                <option value="mL">mL</option>
                <option value="nL">nL</option>
              </select>
            </div>
            
            <div className={styles.formGroup}>
              <label>类型</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  type: e.target.value as any,
                  isInfinite: e.target.value === 'buffer' ? true : formData.isInfinite
                })}
              >
                <option value="source">原料</option>
                <option value="buffer">缓冲液</option>
                <option value="intermediate">中间产物</option>
              </select>
            </div>
          </div>
          
          {formData.type !== 'intermediate' && (
            <div className={styles.formGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.isInfinite}
                  onChange={(e) => setFormData({ ...formData, isInfinite: e.target.checked })}
                />
                无限体积（如缓冲液、常用试剂）
              </label>
            </div>
          )}
          
          {formData.type !== 'buffer' && (
          <div className={styles.formGroup}>
            <label>物质组成</label>
            {formData.substances.map((sub, i) => (
              <div key={i} className={styles.substanceInputRow}>
                <input
                  type="text"
                  value={sub.name}
                  onChange={(e) => {
                    const newSubs = [...formData.substances]
                    newSubs[i].name = e.target.value
                    setFormData({ ...formData, substances: newSubs })
                  }}
                  placeholder="物质名称"
                />
                <input
                  type="number"
                  value={sub.concentration || ''}
                  onChange={(e) => {
                    const newSubs = [...formData.substances]
                    newSubs[i].concentration = Number(e.target.value)
                    setFormData({ ...formData, substances: newSubs })
                  }}
                  placeholder="浓度"
                  min="0"
                  step="0.01"
                />
                <select
                  value={sub.concentrationUnit}
                  onChange={(e) => {
                    const newSubs = [...formData.substances]
                    newSubs[i].concentrationUnit = e.target.value as any
                    setFormData({ ...formData, substances: newSubs })
                  }}
                >
                  <option value="μM">μM</option>
                  <option value="nM">nM</option>
                  <option value="mM">mM</option>
                </select>
                {formData.substances.length > 1 && (
                  <button
                    type="button"
                    className={styles.removeSubstanceBtn}
                    onClick={() => {
                      const newSubs = formData.substances.filter((_, idx) => idx !== i)
                      setFormData({ ...formData, substances: newSubs })
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className={styles.addSubstanceBtn}
              onClick={() => setFormData({
                ...formData,
                substances: [...formData.substances, { name: '', concentration: 0, concentrationUnit: 'μM' }]
              })}
            >
              + 添加物质
            </button>
          </div>
          )}
          
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>存储位置</label>
              <input
                type="text"
                value={formData.storageLocation}
                onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                placeholder="如: 冰箱 A 层 2"
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>存储条件</label>
              <input
                type="text"
                value={formData.storageCondition}
                onChange={(e) => setFormData({ ...formData, storageCondition: e.target.value })}
                placeholder="如: -20°C"
              />
            </div>
          </div>
          
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              取消
            </button>
            <button type="submit" className={styles.submitBtn}>
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// 试剂详情/编辑弹窗
function TubeDetailModal({ tube, onClose, onSave }: any) {
  const [formData, setFormData] = useState<{
    name: string
    type: TubeType
    totalVolume: number
    totalVolumeUnit: VolumeUnit
    remainingVolume: number
    remainingVolumeUnit: VolumeUnit
    isInfinite: boolean
    substances: { name: string; concentration: number; concentrationUnit: ConcentrationUnit }[]
    storageLocation: string
    storageCondition: string
    notes: string
    status: TubeStatus
  }>({
    name: tube.name || '',
    type: tube.type || 'source',
    totalVolume: tube.totalVolume === Infinity ? 100 : tube.totalVolume,
    totalVolumeUnit: tube.totalVolumeUnit || 'μL',
    remainingVolume: tube.remainingVolume === Infinity ? 100 : tube.remainingVolume,
    remainingVolumeUnit: tube.remainingVolumeUnit || 'μL',
    isInfinite: tube.remainingVolume === Infinity,
    substances: tube.substances?.length > 0 ? [...tube.substances] : [{ name: '', concentration: 0, concentrationUnit: 'μM' }],
    storageLocation: tube.storageLocation || '',
    storageCondition: tube.storageCondition || '',
    notes: tube.notes || '',
    status: tube.status || 'active'
  })
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('请输入名称')
      return
    }
    
    const substances = formData.type === 'buffer' 
      ? [] 
      : formData.substances.filter((s: any) => s.name.trim())
    
    onSave({
      ...tube,
      ...formData,
      substances,
      totalVolume: formData.isInfinite ? Infinity : formData.totalVolume,
      remainingVolume: formData.isInfinite ? Infinity : formData.remainingVolume
    })
  }
  
  const typeLabels: Record<string, string> = {
    source: '📦 原料',
    buffer: '💧 缓冲液',
    intermediate: '🧪 中间产物'
  }
  
  return (
    <div className={styles.modal} onClick={onClose}>
      <div className={styles.modalContentWide} onClick={e => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>试剂详情</h2>
        
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>名称 *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="如: E1, DNA Sample A"
                autoFocus
              />
            </div>
          </div>
          
          <div className={styles.formRow3}>
            <div className={styles.formGroup}>
              <label>总体积</label>
              <input
                type="number"
                value={formData.isInfinite ? '' : formData.totalVolume}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  totalVolume: Number(e.target.value)
                })}
                min="0"
                step="0.1"
                disabled={formData.isInfinite}
                placeholder={formData.isInfinite ? '∞ 无限' : ''}
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>剩余体积</label>
              <input
                type="number"
                value={formData.isInfinite ? '' : formData.remainingVolume}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  remainingVolume: Number(e.target.value)
                })}
                min="0"
                step="0.1"
                disabled={formData.isInfinite}
                placeholder={formData.isInfinite ? '∞ 无限' : ''}
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>单位</label>
              <select
                value={formData.totalVolumeUnit}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  totalVolumeUnit: e.target.value as any,
                  remainingVolumeUnit: e.target.value as any
                })}
              >
                <option value="μL">μL</option>
                <option value="mL">mL</option>
                <option value="nL">nL</option>
              </select>
            </div>
          </div>
          
          <div className={styles.formRow3}>
            <div className={styles.formGroup}>
              <label>类型</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  type: e.target.value as any,
                  isInfinite: e.target.value === 'buffer' ? true : formData.isInfinite
                })}
              >
                <option value="source">原料</option>
                <option value="buffer">缓冲液</option>
                <option value="intermediate">中间产物</option>
              </select>
            </div>
            
            <div className={styles.formGroup}>
              <label>状态</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as TubeStatus })}
              >
                <option value="active">可用</option>
                <option value="depleted">不足</option>
                <option value="discarded">已弃</option>
              </select>
            </div>
            
            <div className={styles.formGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.isInfinite}
                  onChange={(e) => setFormData({ ...formData, isInfinite: e.target.checked })}
                />
                无限体积
              </label>
            </div>
          </div>
          
          {formData.type !== 'buffer' && (
          <div className={styles.formGroup}>
            <label>物质组成</label>
            {formData.substances.map((sub: any, i: number) => (
              <div key={i} className={styles.substanceInputRow}>
                <input
                  type="text"
                  value={sub.name}
                  onChange={(e) => {
                    const newSubs = [...formData.substances]
                    newSubs[i].name = e.target.value
                    setFormData({ ...formData, substances: newSubs })
                  }}
                  placeholder="物质名称"
                />
                <input
                  type="number"
                  value={sub.concentration || ''}
                  onChange={(e) => {
                    const newSubs = [...formData.substances]
                    newSubs[i].concentration = Number(e.target.value)
                    setFormData({ ...formData, substances: newSubs })
                  }}
                  placeholder="浓度"
                  min="0"
                  step="0.01"
                />
                <select
                  value={sub.concentrationUnit}
                  onChange={(e) => {
                    const newSubs = [...formData.substances]
                    newSubs[i].concentrationUnit = e.target.value as any
                    setFormData({ ...formData, substances: newSubs })
                  }}
                >
                  <option value="μM">μM</option>
                  <option value="nM">nM</option>
                  <option value="mM">mM</option>
                </select>
                {formData.substances.length > 1 && (
                  <button
                    type="button"
                    className={styles.removeSubstanceBtn}
                    onClick={() => {
                      const newSubs = formData.substances.filter((_: any, idx: number) => idx !== i)
                      setFormData({ ...formData, substances: newSubs })
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className={styles.addSubstanceBtn}
              onClick={() => setFormData({
                ...formData,
                substances: [...formData.substances, { name: '', concentration: 0, concentrationUnit: 'μM' }]
              })}
            >
              + 添加物质
            </button>
          </div>
          )}
          
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>存储位置</label>
              <input
                type="text"
                value={formData.storageLocation}
                onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                placeholder="如: 冰箱 A 层 2"
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>存储条件</label>
              <input
                type="text"
                value={formData.storageCondition}
                onChange={(e) => setFormData({ ...formData, storageCondition: e.target.value })}
                placeholder="如: -20°C"
              />
            </div>
          </div>
          
          <div className={styles.formGroup}>
            <label>备注</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="其他备注信息..."
              rows={3}
            />
          </div>
          
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              取消
            </button>
            <button type="submit" className={styles.submitBtn}>
              保存修改
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
