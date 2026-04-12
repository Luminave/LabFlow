import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWarehouseStore } from '../stores/warehouseStore'
import { useExperimentStore } from '../stores/experimentStore'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { useGroupStore, GROUP_PRESET_COLORS } from '../stores/groupStore'
import { TubeType, TubeStatus, VolumeUnit, ConcentrationUnit, TubeGroup } from '@shared/types'
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

const COLLAPSED_KEY = 'labflow_collapsed_groups'
const FLASH_KEY = 'labflow_flash_target'

export default function WarehousePage() {
  const navigate = useNavigate()
  const { tubes, addTube, deleteTube, updateTubeStatus, updateTube, fetchTubes, loading } = useWarehouseStore()
  const { currentExperiment, addSourceTube, currentTubes } = useExperimentStore()
  const { loadColors } = useSubstanceColorStore()
  const { groups, addGroup, updateGroup, loadGroups, generateGroupName } = useGroupStore()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingTube, setEditingTube] = useState<any>(null)
  const [editingGroup, setEditingGroup] = useState<TubeGroup | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [flashTarget, setFlashTarget] = useState<string | null>(null)
  const tubeListRef = useRef<HTMLDivElement>(null)
  
  // 加载已保存的试管和颜色配置
  useEffect(() => {
    fetchTubes()
    loadColors()
    loadGroups()
    // 加载折叠状态
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY)
      if (saved) setCollapsedGroups(new Set(JSON.parse(saved)))
    } catch {}
  }, [fetchTubes, loadColors, loadGroups])
  
  // 按分组整理试管（显示所有分组，包括空的）
  const groupedTubes = useMemo(() => {
    const grouped: { group: TubeGroup | null; tubes: typeof tubes }[] = []
    
    // 先按分组归类试管
    const groupMap = new Map<string, typeof tubes>()
    const ungrouped: typeof tubes = []
    
    for (const tube of tubes) {
      if (tube.groupId) {
        const existing = groupMap.get(tube.groupId) || []
        existing.push(tube)
        groupMap.set(tube.groupId, existing)
      } else {
        ungrouped.push(tube)
      }
    }
    
    // 添加所有已创建的分组（包括空的）
    for (const group of groups) {
      grouped.push({ group, tubes: groupMap.get(group.id) || [] })
      groupMap.delete(group.id)
    }
    
    // 添加引用了已删除分组的试管
    for (const [groupId, groupTubes] of groupMap) {
      grouped.push({ group: null, tubes: groupTubes })
    }
    
    // 添加未分组的试管
    if (ungrouped.length > 0) {
      grouped.push({ group: null, tubes: ungrouped })
    }
    
    return grouped
  }, [tubes, groups])
  
  // 搜索结果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    const results: { type: 'group' | 'tube'; id: string; name: string; subtitle?: string; groupId?: string }[] = []
    
    // 搜索分组
    for (const group of groups) {
      if (group.name.toLowerCase().includes(q) || group.notes?.toLowerCase().includes(q)) {
        results.push({ type: 'group', id: group.id, name: group.name, subtitle: group.notes || undefined })
      }
    }
    
    // 搜索试管
    for (const tube of tubes) {
      if (tube.name.toLowerCase().includes(q)) {
        results.push({ type: 'tube', id: tube.id, name: tube.name, subtitle: tube.type === 'buffer' ? '缓冲液' : tube.type === 'source' ? '原料' : '中间产物', groupId: tube.groupId })
      }
    }
    
    return results
  }, [searchQuery, groups, tubes])
  
  // 切换分组折叠状态
  const toggleCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])
  
  // 滚动并闪烁目标
  const scrollToAndFlash = useCallback((targetId: string, groupId?: string) => {
    // 先展开目标所在分组
    if (groupId && collapsedGroups.has(groupId)) {
      toggleCollapse(groupId)
    }
    setSearchQuery('')
    // 等 DOM 更新后滚动
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.getElementById(`target-${targetId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setFlashTarget(targetId)
        }
      }, 100)
    })
  }, [collapsedGroups, toggleCollapse])
  
  // 新增分组
  const handleAddGroup = () => {
    const name = generateGroupName()
    addGroup(name)
  }
  
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
        <div className={styles.headerButtons}>
          <div className={styles.searchWrapper}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="搜索分组或试剂..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchResults && searchResults.length > 0 && (
              <div className={styles.searchDropdown}>
                {searchResults.map(r => (
                  <div
                    key={r.id}
                    className={styles.searchResultItem}
                    onClick={() => scrollToAndFlash(r.id, r.groupId)}
                  >
                    <span className={styles.searchResultIcon}>{r.type === 'group' ? '📁' : '🧪'}</span>
                    <span className={styles.searchResultName}>{r.name}</span>
                    {r.subtitle && <span className={styles.searchResultSub}>{r.subtitle}</span>}
                  </div>
                ))}
              </div>
            )}
            {searchResults && searchResults.length === 0 && searchQuery.trim() && (
              <div className={styles.searchDropdown}>
                <div className={styles.searchEmpty}>无匹配结果</div>
              </div>
            )}
          </div>
          <button className={styles.addGroupButton} onClick={handleAddGroup}>
            📁 新增分组
          </button>
          <button className={styles.addButton} onClick={() => setShowAddForm(true)}>
            + 添加试剂
          </button>
        </div>
      </header>
      
      {showAddForm && (
        <AddTubeForm 
          onClose={() => setShowAddForm(false)}
          onSubmit={handleAddTube}
          groups={groups}
        />
      )}
      
      <div className={styles.tubeList} ref={tubeListRef}>
        {loading ? (
          <div className={styles.empty}>加载中...</div>
        ) : tubes.length === 0 && groups.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📦</div>
            <p>仓库为空</p>
            <p className={styles.emptyHint}>点击上方按钮添加第一个试剂</p>
          </div>
        ) : (
          groupedTubes.map(({ group, tubes: groupTubes }) => (
            group ? (
              <GroupBox
                key={group.id}
                group={group}
                tubes={groupTubes}
                collapsed={collapsedGroups.has(group.id)}
                onToggleCollapse={() => toggleCollapse(group.id)}
                onEditGroup={() => setEditingGroup(group)}
                onDeleteTube={handleDeleteTube}
                onStatusChange={handleStatusChange}
                onEditTube={setEditingTube}
                onAddToExperiment={handleAddToExperiment}
                hasExperiment={!!currentExperiment}
                groups={groups}
                onUpdateTube={updateTube}
                flashTarget={flashTarget}
                onFlashDone={() => setFlashTarget(null)}
              />
            ) : (
              groupTubes.map(tube => (
                <TubeCard 
                  key={tube.id}
                  tube={tube}
                  onDelete={() => handleDeleteTube(tube.id)}
                  onStatusChange={(status: string) => handleStatusChange(tube.id, status)}
                  onEdit={() => setEditingTube(tube)}
                  onAddToExperiment={() => handleAddToExperiment(tube)}
                  hasExperiment={!!currentExperiment}
                  groups={groups}
                  onUpdateTube={updateTube}
                  flashTarget={flashTarget}
                  onFlashDone={() => setFlashTarget(null)}
                />
              ))
            )
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
          groups={groups}
        />
      )}
      
      {/* 分组编辑弹窗 */}
      {editingGroup && (
        <GroupEditModal
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSave={(updates) => {
            updateGroup(editingGroup.id, updates)
            setEditingGroup(null)
          }}
          onDelete={() => {
            // 删除分组时，将该组的试管变为未分组
            tubes.filter(t => t.groupId === editingGroup.id).forEach(t => {
              updateTube(t.id, { groupId: undefined })
            })
            useGroupStore.getState().deleteGroup(editingGroup.id)
            setEditingGroup(null)
          }}
        />
      )}
    </div>
  )
}

function TubeCard({ tube, onDelete, onStatusChange, onEdit, onAddToExperiment, hasExperiment, groups, onUpdateTube, flashTarget, onFlashDone }: any) {
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
  
  const isFlashing = flashTarget === tube.id
  
  return (
    <div id={`target-${tube.id}`} className={`${styles.tubeCard} ${isFlashing ? styles.flashAnimation : ''}`} onAnimationEnd={isFlashing ? onFlashDone : undefined}>
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
        
        {/* 分组选择器 */}
        <div className={styles.tubeInfo}>
          <span className={styles.label}>分组:</span>
          <select
            className={styles.statusSelect}
            value={tube.groupId || ''}
            onChange={(e) => onUpdateTube(tube.id, { groupId: e.target.value || undefined })}
          >
            <option value="">未分组</option>
            {groups.map((g: TubeGroup) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
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

// 分组方框组件
function GroupBox({ group, tubes, collapsed, onToggleCollapse, onEditGroup, onDeleteTube, onStatusChange, onEditTube, onAddToExperiment, hasExperiment, groups, onUpdateTube, flashTarget, onFlashDone }: any) {
  const isGroupFlashing = flashTarget === group.id
  return (
    <div id={`target-${group.id}`} className={`${styles.groupBox} ${isGroupFlashing ? styles.flashAnimation : ''}`} style={{ borderColor: group.color }} onAnimationEnd={isGroupFlashing ? onFlashDone : undefined}>
      <div className={styles.groupBoxHeader} style={{ backgroundColor: group.color + '30' }}>
        <div className={styles.groupBoxTitleRow}>
          <button className={styles.groupEditBtn} onClick={onEditGroup}>修改</button>
          <span className={styles.groupName}>{group.name}</span>
          {group.notes && <span className={styles.groupNotes}>{group.notes}</span>}
          <button className={styles.groupCollapseBtn} onClick={onToggleCollapse}>
            {collapsed ? '展开' : '收起'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className={styles.groupBoxContent}>
          {tubes.length === 0 ? (
            <div className={styles.groupEmpty}>暂无试剂</div>
          ) : (
            tubes.map((tube: any) => (
              <TubeCard 
                key={tube.id}
                tube={tube}
                onDelete={() => onDeleteTube(tube.id)}
                onStatusChange={(status: string) => onStatusChange(tube.id, status)}
                onEdit={() => onEditTube(tube)}
                onAddToExperiment={() => onAddToExperiment(tube)}
                hasExperiment={hasExperiment}
                groups={groups}
                onUpdateTube={onUpdateTube}
                flashTarget={flashTarget}
                onFlashDone={onFlashDone}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// 分组编辑弹窗
function GroupEditModal({ group, onClose, onSave, onDelete }: any) {
  const [name, setName] = useState(group.name)
  const [color, setColor] = useState(group.color)
  const [notes, setNotes] = useState(group.notes || '')
  
  const presetColors = GROUP_PRESET_COLORS
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      alert('请输入分组名称')
      return
    }
    onSave({ name: name.trim(), color, notes: notes.trim() })
  }
  
  return (
    <div className={styles.modal} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>编辑分组</h2>
        
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label>分组名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          
          <div className={styles.formGroup}>
            <label>分组颜色</label>
            <div className={styles.colorPicker}>
              {presetColors.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorOption} ${color === c ? styles.colorOptionActive : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className={styles.colorInput}
              />
            </div>
          </div>
          
          <div className={styles.formGroup}>
            <label>备注</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="分组备注..."
              rows={2}
            />
          </div>
          
          <div className={styles.formActions}>
            <button type="button" className={styles.deleteGroupBtn} onClick={onDelete}>
              删除分组
            </button>
            <div className={styles.formActionsRight}>
              <button type="button" className={styles.cancelBtn} onClick={onClose}>取消</button>
              <button type="submit" className={styles.submitBtn}>保存</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddTubeForm({ onClose, onSubmit, groups }: any) {
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
    groupId: string
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
    status: 'active',
    groupId: ''
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
      remainingVolume: formData.isInfinite ? Infinity : formData.totalVolume,
      groupId: formData.groupId || undefined
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
            
            <div className={styles.formGroup}>
              <label>分组</label>
              <select
                value={formData.groupId}
                onChange={(e) => setFormData({ ...formData, groupId: e.target.value })}
              >
                <option value="">未分组</option>
                {groups.map((g: TubeGroup) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
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
function TubeDetailModal({ tube, onClose, onSave, groups }: any) {
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
    groupId: string
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
    status: tube.status || 'active',
    groupId: tube.groupId || ''
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
      remainingVolume: formData.isInfinite ? Infinity : formData.remainingVolume,
      groupId: formData.groupId || undefined
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
            
            <div className={styles.formGroup}>
              <label>分组</label>
              <select
                value={formData.groupId}
                onChange={(e) => setFormData({ ...formData, groupId: e.target.value })}
              >
                <option value="">未分组</option>
                {groups.map((g: TubeGroup) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
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
