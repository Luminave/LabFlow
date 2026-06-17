import { memo, useEffect, useState, useCallback } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Tube, Substance } from '@shared/types'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import styles from './TubeNode.module.css'

interface TubeNodeData {
  tube: Tube
  isSource: boolean
  isBuffer?: boolean
  endStateVolume?: number
  initialVolume?: number  // 用于原料试管的初始体积
  isInWarehouse?: boolean  // 中间产物是否来自仓库
  fillPercentage?: number
  isReadOnly?: boolean
  onUpdateTube?: (tubeId: string, updates: Partial<Tube>, shouldCalculate?: boolean) => void
  onOpenDetail?: (tube: Tube) => void
}

// 成分显示组件（带颜色高亮）
function SubstanceTag({ substance }: { substance: Substance }) {
  const { colors } = useSubstanceColorStore()
  const colorConfig = colors.get(substance.name)

  const style = colorConfig ? {
    color: colorConfig.color,
    backgroundColor: colorConfig.bgColor,
    padding: '1px 4px',
    borderRadius: '3px'
  } : {}

  return (
    <div className={styles.substance}>
      <span style={style}>{substance.name}</span>: {substance.concentration} {substance.concentrationUnit}
    </div>
  )
}

function TubeNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as TubeNodeData
  const { tube, isSource, isBuffer, endStateVolume, initialVolume, isInWarehouse, fillPercentage, isReadOnly, onUpdateTube, onOpenDetail } = nodeData
  const { loadColors } = useSubstanceColorStore()

  // 内联编辑状态
  const [editingField, setEditingField] = useState<string | null>(null)
  const [inlineValue, setInlineValue] = useState<string>('')

  useEffect(() => {
    loadColors()
  }, [loadColors])

  // 判断是否可以内联编辑(仅中间产物,非只读,非 asSource)
  const canInlineEdit = !isReadOnly && tube.type === 'intermediate' && !isSource && !!onUpdateTube

  // 开始编辑
  const startEdit = useCallback((field: string, currentValue: string | number) => {
    if (!canInlineEdit) return
    setEditingField(field)
    setInlineValue(String(currentValue))
  }, [canInlineEdit])

  // 保存编辑
  const saveEdit = useCallback(() => {
    if (!editingField || !onUpdateTube) return

    const updates: Partial<Tube> = {}
    let shouldCalculate = false

    if (editingField === 'tubeNumber') {
      let val = inlineValue.trim()
      if (val.length > 5) {
        alert('管号最多5个字符')
        setEditingField(null)
        return
      }
      if (val && !val.startsWith('#')) val = '#' + val
      if (val && val.length > 5) {
        alert('管号最多5个字符(含#)')
        setEditingField(null)
        return
      }
      updates.tubeNumber = val || undefined
    } else if (editingField === 'configOrder') {
      const num = parseInt(inlineValue, 10)
      if (inlineValue && (isNaN(num) || num <= 0)) {
        alert('配置序号必须是正整数')
        setEditingField(null)
        return
      }
      updates.configOrder = inlineValue ? num : undefined
    } else if (editingField === 'name') {
      const trimmed = inlineValue.trim()
      if (!trimmed) {
        setEditingField(null)
        return
      }
      updates.name = trimmed
    } else if (editingField === 'totalVolume') {
      const num = parseFloat(inlineValue)
      if (isNaN(num) || num < 0) {
        setEditingField(null)
        return
      }
      updates.totalVolume = num
      shouldCalculate = true
    } else if (editingField.startsWith('conc-')) {
      const idx = parseInt(editingField.split('-')[1], 10)
      const num = parseFloat(inlineValue)
      if (isNaN(num) || num < 0) {
        setEditingField(null)
        return
      }
      const newSubs = tube.substances.map((s, i) =>
        i === idx ? { ...s, concentration: num } : s
      )
      updates.substances = newSubs
      shouldCalculate = true
    }

    if (Object.keys(updates).length > 0) {
      onUpdateTube(tube.id, updates, shouldCalculate)
    }
    setEditingField(null)
  }, [editingField, inlineValue, tube, onUpdateTube])

  // 取消编辑
  const cancelEdit = useCallback(() => {
    setEditingField(null)
    setInlineValue('')
  }, [])

  // 输入框键盘事件 - 只对 Enter/Escape 阻止冒泡，其他键不阻止（让输入正常工作）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.stopPropagation()
      saveEdit()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      cancelEdit()
    }
    // 其他按键（普通输入字符）不调用 stopPropagation，让 ReactFlow 等正常处理
  }, [saveEdit, cancelEdit])

  // 渲染可编辑字段:编辑态显示输入框,否则显示可点击文本
  const renderEditableField = (
    field: string,
    displayValue: React.ReactNode,
    editValue: string | number,
    inputType: 'text' | 'number' = 'text',
    extraProps?: React.InputHTMLAttributes<HTMLInputElement>
  ) => {
    if (editingField === field) {
      return (
        <input
          type={inputType}
          className={styles.inlineEditInput}
          value={inlineValue}
          onChange={(e) => setInlineValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          autoFocus
          onFocus={(e) => e.target.select()}
          {...extraProps}
        />
      )
    }
    return (
      <span
        className={styles.editableField}
        onClick={(e) => { e.stopPropagation(); startEdit(field, editValue) }}
        title="点击编辑"
      >
        {displayValue}
      </span>
    )
  }

  const fillHeight = fillPercentage !== undefined ? `${fillPercentage * 100}%` : '100%'

  // 计算显示体积
  const displayVolume = () => {
    if (isBuffer) {
      return '∞'
    }

    if (tube.type === 'sample') {
      return `${endStateVolume || 0}`
    }

    if (tube.type === 'waste') {
      return `${endStateVolume || 0}`
    }

    if (isSource) {
      const beforeVolume = initialVolume !== undefined ? initialVolume : tube.remainingVolume
      const afterVolume = endStateVolume !== undefined ? endStateVolume : tube.remainingVolume
      return `${beforeVolume}/${afterVolume}`
    } else {
      if (isInWarehouse && initialVolume !== undefined) {
        const afterVolume = endStateVolume !== undefined ? endStateVolume : initialVolume
        return `${initialVolume}/${afterVolume}`
      } else {
        const targetVolume = tube.totalVolume
        const afterVolume = endStateVolume !== undefined ? endStateVolume : 0
        return `${targetVolume}/${afterVolume}`
      }
    }
  }

  // 体积行:非 asSource 的中间产物可编辑目标体积
  const renderVolumeContent = () => {
    if (canInlineEdit && !isInWarehouse) {
      // 新创建的中间产物:可编辑目标体积
      const parts = displayVolume().split('/')
      if (parts.length === 2) {
        return (
          <>
            {renderEditableField('totalVolume', parts[0], tube.totalVolume, 'number', { min: '0', step: '0.1' })}
            /{parts[1]} {tube.remainingVolumeUnit}
          </>
        )
      }
    }
    return <>{displayVolume()} {tube.remainingVolumeUnit}</>
  }

  const getNodeClass = () => {
    let cls = styles.tubeNode
    if (selected) cls += ` ${styles.selected}`
    if (isBuffer) cls += ` ${styles.bufferTube}`
    else if (tube.type === 'sample') cls += ` ${styles.sampleTube}`
    else if (tube.type === 'waste') cls += ` ${styles.wasteTube}`
    else if (isSource) cls += ` ${styles.sourceTube}`
    else cls += ` ${styles.intermediateTube}`
    return cls
  }

  // 缓冲液试管显示简化版本
  if (isBuffer) {
    return (
      <div className={`${styles.bufferNode} ${selected ? styles.selected : ''}`}>
        <div className={styles.bufferContent}>
          <span className={styles.bufferIcon}>💧</span>
          <span className={styles.bufferName}>{tube.name}</span>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className={styles.bufferHandle}
        />
      </div>
    )
  }

  return (
    <div className={getNodeClass()}>
      <div className={styles.fillOverlay} style={{ height: fillHeight }} />
      <div className={styles.content}>
        <div className={styles.volume}>
          {renderVolumeContent()}
          {tube.asSource && <span className={styles.asSourceTag}>原料</span>}
          {tube.configOrder && tube.type === 'intermediate' && !tube.asSource && (
            canInlineEdit
              ? renderEditableField('configOrder', `#${tube.configOrder}`, tube.configOrder, 'number', { min: '1', step: '1' })
              : <span className={styles.configOrderTag}>#{tube.configOrder}</span>
          )}
        </div>

        {tube.type !== 'sample' && tube.type !== 'waste' && (
          <div className={styles.substances}>
            {tube.substances.length > 0 ? (
              tube.substances.map((s, i) => {
                // 可编辑的浓度显示
                if (canInlineEdit && editingField === `conc-${i}`) {
                  const { colors } = useSubstanceColorStore.getState()
                  const colorConfig = colors.get(s.name)
                  const nameStyle = colorConfig ? {
                    color: colorConfig.color,
                    backgroundColor: colorConfig.bgColor,
                    padding: '1px 4px',
                    borderRadius: '3px'
                  } : {}
                  return (
                    <div key={i} className={styles.substance}>
                      <span style={nameStyle}>{s.name}</span>:{' '}
                      <input
                        type="number"
                        className={styles.inlineEditInput}
                        value={inlineValue}
                        onChange={(e) => setInlineValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={handleKeyDown}
                        onMouseDown={(e) => e.stopPropagation()}
                        autoFocus
                        onFocus={(e) => e.target.select()}
                        min="0"
                        step="0.1"
                      />{' '}
                      {s.concentrationUnit}
                    </div>
                  )
                }
                if (canInlineEdit) {
                  const { colors } = useSubstanceColorStore.getState()
                  const colorConfig = colors.get(s.name)
                  const nameStyle = colorConfig ? {
                    color: colorConfig.color,
                    backgroundColor: colorConfig.bgColor,
                    padding: '1px 4px',
                    borderRadius: '3px'
                  } : {}
                  return (
                    <div key={i} className={styles.substance}>
                      <span style={nameStyle}>{s.name}</span>:{' '}
                      <span
                        className={styles.editableField}
                        onClick={(e) => { e.stopPropagation(); startEdit(`conc-${i}`, s.concentration) }}
                        title="点击编辑浓度"
                      >
                        {s.concentration}
                      </span>{' '}
                      {s.concentrationUnit}
                    </div>
                  )
                }
                return <SubstanceTag key={i} substance={s} />
              })
            ) : (
              <div className={styles.emptySubstances}>空试管</div>
            )}
          </div>
        )}

        {tube.tubeNumber && tube.type === 'intermediate' && !tube.asSource && (
          <div className={styles.tubeNumber}>
            {canInlineEdit
              ? renderEditableField('tubeNumber', tube.tubeNumber, tube.tubeNumber, 'text', { maxLength: 5 })
              : tube.tubeNumber
            }
          </div>
        )}
        <div className={styles.name}>
          {canInlineEdit
            ? renderEditableField('name', tube.name, tube.name)
            : tube.name
          }
        </div>
      </div>

      {/* 详情按钮 - 卡片右下角 */}
      {onOpenDetail && (
        <button
          className={styles.detailBtn}
          onClick={(e) => { e.stopPropagation(); onOpenDetail(tube) }}
          title="详情"
        >
          ···
        </button>
      )}

      {/* 原料试管只能输出,不能输入 */}
      {/* 耗损试管只能输入,不能输出 */}
      {!isSource && (
        <Handle
          type="target"
          position={Position.Left}
          className={styles.handle}
        />
      )}
      {tube.type !== 'waste' && (
        <Handle
          type="source"
          position={Position.Right}
          className={styles.handle}
        />
      )}
    </div>
  )
}

export default memo(TubeNode)
