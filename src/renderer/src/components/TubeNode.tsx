import { memo, useEffect, useState } from 'react'
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
  const { tube, isSource, isBuffer, endStateVolume, initialVolume, isInWarehouse, fillPercentage } = nodeData
  const { loadColors } = useSubstanceColorStore()
  
  useEffect(() => {
    loadColors()
  }, [loadColors])
  
  const fillHeight = fillPercentage !== undefined ? `${fillPercentage * 100}%` : '100%'
  
  // 计算显示体积
  const displayVolume = () => {
    if (isBuffer) {
      // 缓冲液显示无限
      return '∞'
    }
    
    if (tube.type === 'sample') {
      // 上样试管：只显示上样体积
      return `${endStateVolume || 0}`
    }
    
    if (tube.type === 'waste') {
      // 耗损试管：只显示总体积
      return `${endStateVolume || 0}`
    }
    
    if (isSource) {
      // 原料试管：<实验前体积>/<实验后体积>
      // 使用 initialVolume（来自仓库）作为实验前体积
      const beforeVolume = initialVolume !== undefined ? initialVolume : tube.remainingVolume
      const afterVolume = endStateVolume !== undefined ? endStateVolume : tube.remainingVolume
      return `${beforeVolume}/${afterVolume}`
    } else {
      // 中间产物：判断是否来自仓库
      if (isInWarehouse && initialVolume !== undefined) {
        // 从仓库添加的中间产物：<仓库初始体积>/<实验后体积>
        const afterVolume = endStateVolume !== undefined ? endStateVolume : initialVolume
        return `${initialVolume}/${afterVolume}`
      } else {
        // 新创建的中间产物：<目标体积>/<实验后体积>
        const targetVolume = tube.totalVolume
        const afterVolume = endStateVolume !== undefined ? endStateVolume : 0
        return `${targetVolume}/${afterVolume}`
      }
    }
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
          {displayVolume()} {tube.remainingVolumeUnit}
          {tube.asSource && <span className={styles.asSourceTag}>原料</span>}
          {tube.configOrder && tube.type === 'intermediate' && !tube.asSource && (
            <span className={styles.configOrderTag}>#{tube.configOrder}</span>
          )}
        </div>
        
        {tube.type !== 'sample' && tube.type !== 'waste' && (
          <div className={styles.substances}>
            {tube.substances.length > 0 ? (
              tube.substances.map((s, i) => (
                <SubstanceTag key={i} substance={s} />
              ))
            ) : (
              <div className={styles.emptySubstances}>空试管</div>
            )}
          </div>
        )}
        
        {tube.tubeNumber && tube.type === 'intermediate' && !tube.asSource && (
          <div className={styles.tubeNumber}>{tube.tubeNumber}</div>
        )}
        <div className={styles.name}>{tube.name}</div>
      </div>
      
      {/* 原料试管只能输出，不能输入 */}
      {/* 耗损试管只能输入，不能输出 */}
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
