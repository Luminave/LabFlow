import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
  Panel,
  NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useWarehouseStore } from '../stores/warehouseStore'
import { useExperimentStore } from '../stores/experimentStore'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import { Tube, Substance, ConcentrationUnit, VolumeUnit, TransferConnection } from '@shared/types'
import TubeNode from '../components/TubeNode'
import styles from './ExperimentPage.module.css'

const nodeTypes: NodeTypes = { tube: TubeNode }

export default function ExperimentPage() {
  const navigate = useNavigate()
  const { language } = useI18nStore()
  const { tubes: warehouseTubes, fetchTubes } = useWarehouseStore()
  const { 
    currentExperiment, 
    currentTubes, 
    connections,
    tubePositions,
    experiments,
    createNewExperiment,
    addSourceTube,
    addIntermediateTube,
    addBufferTube,
    addSampleTube,
    removeTube,
    updateTubeInExperiment,
    addConnection,
    updateConnection,
    removeConnection,
    updateTubePosition,
    completeExperiment,
    saveCurrentExperiment,
    loadExperiment,
    deleteExperiment,
    fetchExperiments,
    loadSavedExperiment,
    resetExperiment,
    setDefaultBuffer
  } = useExperimentStore()
  
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [experimentName, setExperimentName] = useState('')
  const [showTubeSelector, setShowTubeSelector] = useState(false)
  const [showExperimentManager, setShowExperimentManager] = useState(false)
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [showBuffers, setShowBuffers] = useState(true) // 显示缓冲液
  const [showCheckResult, setShowCheckResult] = useState(false) // 检查结果弹窗
  const [checkErrors, setCheckErrors] = useState<{tubeId: string; tubeName: string; type: string; message: string}[]>([]) // 检查错误列表
  
  // 实验时间功能
  const getTodayDate = () => {
    const now = new Date()
    const yy = String(now.getFullYear()).slice(-2)
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    return `${yy}${mm}${dd}`
  }
  const [experimentDate, setExperimentDate] = useState(getTodayDate())
  const [quickNaming, setQuickNaming] = useState(true) // 快捷试管命名，默认启用
  
  // 动态计算结束状态
  const calculateEndStateDynamic = (tubes: Tube[], conns: TransferConnection[]): Tube[] => {
    // 计算每个试管的移入和移出体积
    const tubeInVolume = new Map<string, number>()
    const tubeOutVolume = new Map<string, number>()
    
    for (const conn of conns) {
      if (conn.volume <= 0) continue
      tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
      tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
    }
    
    return tubes.map(tube => {
      const inVolume = tubeInVolume.get(tube.id) || 0
      const outVolume = tubeOutVolume.get(tube.id) || 0
      
      // 计算结束体积
      let endVolume: number
      if (tube.type === 'source') {
        // 原料试管：使用仓库中的初始体积 - 移出体积
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        const initialVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
        endVolume = Math.max(0, initialVolume - outVolume)
      } else if (tube.type === 'buffer') {
        // 缓冲液：保持不变
        endVolume = tube.remainingVolume
      } else if (tube.type === 'intermediate') {
        // 中间产物：判断是从仓库添加的还是新创建的
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        const isInWarehouse = !!whTube
        
        if (isInWarehouse) {
          // 从仓库添加的中间产物：当作原料处理
          const initialVolume = whTube.remainingVolume
          endVolume = Math.max(0, initialVolume - outVolume)
        } else {
          // 新创建的中间产物：移入体积 - 移出体积
          endVolume = Math.max(0, inVolume - outVolume)
        }
      } else {
        endVolume = tube.remainingVolume
      }
      
      // 浓度保持不变
      return {
        ...tube,
        remainingVolume: endVolume,
        totalVolume: endVolume
      }
    })
  }
  
  // 是否为只读模式（已完成的实验）
  const isReadOnly = currentExperiment?.status === 'completed'
  
  // 检查实验问题
  const handleCheckExperiment = () => {
    const errors: {tubeId: string; tubeName: string; type: string; message: string}[] = []
    
    // 计算每个试管的移入和移出体积
    const tubeInVolume = new Map<string, number>()
    const tubeOutVolume = new Map<string, number>()
    
    for (const conn of connections) {
      if (conn.volume <= 0) continue
      tubeInVolume.set(conn.toTubeId, (tubeInVolume.get(conn.toTubeId) || 0) + conn.volume)
      tubeOutVolume.set(conn.fromTubeId, (tubeOutVolume.get(conn.fromTubeId) || 0) + conn.volume)
    }
    
    // 1. 检查试管输出体积是否大于输入体积，或原料试管输出是否大于剩余体积
    for (const tube of currentTubes) {
      const outVolume = tubeOutVolume.get(tube.id) || 0
      const inVolume = tubeInVolume.get(tube.id) || 0
      
      if (tube.type === 'source') {
        // 原料试管：检查输出是否大于仓库中的剩余体积
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        const availableVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
        if (outVolume > availableVolume) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'volume_exceed',
            message: `原料试管输出体积(${outVolume.toFixed(2)})大于可用体积(${availableVolume.toFixed(2)})`
          })
        }
      } else if (tube.type === 'intermediate') {
        // 如果试管标记为"作为原料"，跳过体积检查（因为它没有输入是正常的）
        if (tube.asSource) continue
        
        // 中间产物：检查是否是从仓库添加的
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        if (whTube) {
          // 从仓库添加的中间产物：当作原料处理
          if (outVolume > whTube.remainingVolume) {
            errors.push({
              tubeId: tube.id,
              tubeName: tube.name,
              type: 'volume_exceed',
              message: `中间产物试管输出体积(${outVolume.toFixed(2)})大于仓库中可用体积(${whTube.remainingVolume.toFixed(2)})`
            })
          }
        } else {
          // 新创建的中间产物：检查输出是否大于输入
          if (outVolume > inVolume) {
            errors.push({
              tubeId: tube.id,
              tubeName: tube.name,
              type: 'volume_exceed',
              message: `中间产物试管输出体积(${outVolume.toFixed(2)})大于输入体积(${inVolume.toFixed(2)})`
            })
          }
        }
      }
    }
    
    // 2. 检查中间产物是否需要缓冲液补足但没有缓冲液
    for (const tube of currentTubes) {
      if (tube.type !== 'intermediate') continue
      
      // 检查是否有缓冲液连线
      const hasBufferConnection = connections.some(c => {
        const fromTube = currentTubes.find(t => t.id === c.fromTubeId)
        return c.toTubeId === tube.id && fromTube?.type === 'buffer' && c.volume > 0
      })
      
      // 检查是否设置了缓冲液
      const hasSelectedBuffer = tube.selectedBuffer || currentExperiment?.defaultBuffer
      
      // 计算总输入体积和目标体积
      const inVolume = tubeInVolume.get(tube.id) || 0
      const targetVolume = tube.totalVolume || 0
      
      // 如果目标体积大于输入体积，需要缓冲液补足
      if (targetVolume > inVolume && !hasBufferConnection && !hasSelectedBuffer) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'buffer_missing',
          message: `中间产物需要缓冲液补足(${(targetVolume - inVolume).toFixed(2)})，但未连接缓冲液`
        })
      }
    }
    
    // 3. 检查子试管是否需要某种成分但没有连线到含有该成分的父试管
    for (const tube of currentTubes) {
      if (tube.type !== 'intermediate' || tube.substances.length === 0) continue
      
      // 如果试管标记为"作为原料"，跳过成分来源检查
      if (tube.asSource) continue
      
      // 获取连接到此试管的所有源试管
      const incomingConns = connections.filter(c => c.toTubeId === tube.id)
      const sourceTubes = incomingConns
        .map(c => currentTubes.find(t => t.id === c.fromTubeId))
        .filter(t => t && t.type !== 'buffer') as Tube[]
      
      // 检查每种目标物质是否有来源
      for (const targetSub of tube.substances) {
        if (!targetSub.name || targetSub.concentration <= 0) continue
        
        const hasSource = sourceTubes.some(sourceTube => 
          sourceTube.substances.some(s => s.name === targetSub.name)
        )
        
        if (!hasSource) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'substance_source_missing',
            message: `需要成分"${targetSub.name}"，但没有连线到含有该成分的源试管`
          })
        }
      }
    }
    
    // 4. 检查所有试管计算是否正确
    for (const tube of currentTubes) {
      if (tube.type === 'sample' || tube.type === 'waste') continue
      
      // 如果试管标记为"作为原料"，跳过计算检查（因为它没有输入是正常的）
      if (tube.asSource) continue
      
      const inVolume = tubeInVolume.get(tube.id) || 0
      const outVolume = tubeOutVolume.get(tube.id) || 0
      const incomingConns = connections.filter(c => c.toTubeId === tube.id)
      
      // 计算所有输入连线的体积总和
      const totalInputFromConnections = incomingConns.reduce((sum, c) => sum + (c.volume || 0), 0)
      
      // 对于中间产物，检查连线体积是否与目标体积匹配
      if (tube.type === 'intermediate' && tube.totalVolume > 0) {
        // 检查是否有缓冲液连线
        const bufferVolume = incomingConns
          .filter(c => currentTubes.find(t => t.id === c.fromTubeId)?.type === 'buffer')
          .reduce((sum, c) => sum + (c.volume || 0), 0)
        
        const nonBufferInput = totalInputFromConnections - bufferVolume
        const expectedBufferVolume = tube.totalVolume - nonBufferInput
        
        // 如果目标体积与实际输入不匹配（且差异超过0.1）
        if (Math.abs(totalInputFromConnections - tube.totalVolume) > 0.1) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'calculation_error',
            message: `目标体积(${tube.totalVolume})与实际输入体积(${totalInputFromConnections.toFixed(2)})不匹配`
          })
        }
      }
    }
    
    // 5. 检查是否有试管定义了成分但浓度为0
    for (const tube of currentTubes) {
      for (const sub of tube.substances) {
        if (sub.name && sub.name.trim() !== '' && sub.concentration === 0) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'zero_concentration',
            message: `定义了成分"${sub.name}"但浓度为0`
          })
        }
      }
    }
    
    setCheckErrors(errors)
    setShowCheckResult(true)
  }
  
  // 加载数据
  useEffect(() => {
    fetchExperiments()
    fetchTubes()
    loadSavedExperiment()
  }, [fetchExperiments, fetchTubes, loadSavedExperiment])
  
  // 键盘事件处理 - Delete键删除选中的节点或边
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isReadOnly) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 如果正在编辑输入框，不处理
        if (document.activeElement?.tagName === 'INPUT' || 
            document.activeElement?.tagName === 'TEXTAREA' ||
            document.activeElement?.tagName === 'SELECT') {
          return
        }
        
        // 获取当前选中的节点和边
        const selectedNodeIds = nodes.filter(n => n.selected).map(n => n.id)
        const selectedEdgeIds = edges.filter(e => e.selected).map(e => e.id)
        
        // 删除选中的边
        if (selectedEdgeIds.length > 0) {
          selectedEdgeIds.forEach(edgeId => {
            removeConnection(edgeId)
          })
          setEdges(eds => eds.filter(e => !selectedEdgeIds.includes(e.id)))
        }
        
        // 删除选中的节点
        if (selectedNodeIds.length > 0) {
          selectedNodeIds.forEach(nodeId => {
            // 删除相关连接
            const relatedConns = connections.filter(c => c.fromTubeId === nodeId || c.toTubeId === nodeId)
            relatedConns.forEach(c => removeConnection(c.id))
            // 从实验中移除试管
            removeTube(nodeId)
          })
          setNodes(nds => nds.filter(n => !selectedNodeIds.includes(n.id)))
          setEdges(eds => eds.filter(e => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)))
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isReadOnly, nodes, edges, connections, removeConnection, removeTube])
  
  // 自定义节点变化处理，保存位置到 store
  const handleNodesChange = useCallback((changes: any[]) => {
    if (isReadOnly) return // 只读模式不允许拖拽
    
    onNodesChange(changes)
    
    // 当节点位置改变时，保存到 store
    changes.forEach(change => {
      if (change.type === 'position' && change.position && change.dragging === false) {
        updateTubePosition(change.id, change.position.x, change.position.y)
      }
    })
  }, [onNodesChange, updateTubePosition, isReadOnly])
  
  // 边选中变化
  const handleEdgesChange = useCallback((changes: any[]) => {
    onEdgesChange(changes)
  }, [onEdgesChange])
  
  // 编辑试管
  const [editingTube, setEditingTube] = useState<Tube | null>(null)
  const [editFormData, setEditFormData] = useState<{
    name: string
    targetVolume: number
    targetVolumeUnit: VolumeUnit
    substances: Substance[]
    selectedBuffer: string
    asSource: boolean
  }>({
    name: '',
    targetVolume: 0,
    targetVolumeUnit: 'μL',
    substances: [],
    selectedBuffer: '',
    asSource: false
  })
  
  // 同步 currentTubes 到 nodes
  useEffect(() => {
    if (currentTubes.length > 0) {
      // 计算结束状态
      const endStateTubes = calculateEndStateDynamic(currentTubes, connections)
      
      // 创建 tubeId -> endStateVolume 的映射
      const endVolumeMap = new Map<string, number>()
      endStateTubes.forEach(tube => {
        endVolumeMap.set(tube.id, tube.remainingVolume)
      })
      
      // 创建 tubeId -> initialVolume 和 isInWarehouse 的映射
      const initialVolumeMap = new Map<string, number>()
      const isInWarehouseMap = new Map<string, boolean>()
      
      currentTubes.forEach(tube => {
        if (tube.type === 'source' || tube.type === 'intermediate') {
          const whTube = warehouseTubes.find(t => t.id === tube.id)
          if (whTube) {
            initialVolumeMap.set(tube.id, whTube.remainingVolume)
            isInWarehouseMap.set(tube.id, true)
          }
        }
      })
      
      let newNodes = currentTubes.map(tube => {
        // 过滤缓冲液
        if (tube.type === 'buffer' && !showBuffers) {
          return null
        }
        
        // 优先使用保存的位置，其次使用现有节点位置，最后使用随机位置
        const savedPosition = tubePositions.find(p => p.tubeId === tube.id)
        const existingPosition = nodes.find(n => n.id === tube.id)?.position
        
        return {
          id: tube.id,
          type: 'tube',
          position: savedPosition || existingPosition || { 
            x: 100 + Math.random() * 400, 
            y: 100 + Math.random() * 300 
          },
          data: {
            tube: tube,
            isSource: tube.type === 'source',
            isBuffer: tube.type === 'buffer',
            endStateVolume: endVolumeMap.get(tube.id),
            initialVolume: initialVolumeMap.get(tube.id),
            isInWarehouse: isInWarehouseMap.get(tube.id)
          }
        }
      }).filter(Boolean) as Node[]
      
      setNodes(newNodes)
    }
  }, [currentTubes, tubePositions, connections, showBuffers, warehouseTubes])
  
  // 同步 connections 到 edges
  useEffect(() => {
    if (connections.length > 0) {
      let newEdges = connections.map(conn => {
        // 过滤缓冲液相关的连接线
        const fromTube = currentTubes.find(t => t.id === conn.fromTubeId)
        if (fromTube?.type === 'buffer' && !showBuffers) {
          return null
        }
        
        return {
          id: conn.id,
          source: conn.fromTubeId,
          target: conn.toTubeId,
          type: 'bezier', // 使用贝塞尔曲线（弧线）
          animated: true,
          label: `${conn.volume} ${conn.volumeUnit}`,
          labelStyle: { fill: '#1e293b', fontWeight: 600, fontSize: 12 },
          labelShowBg: true,
          labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
          labelBgPadding: [8, 4] as [number, number],
          labelBgBorderRadius: 4,
          style: { stroke: '#4f46e5', strokeWidth: 3 }, // 更粗更深色的线条
          data: { volume: conn.volume, volumeUnit: conn.volumeUnit }
        }
      }).filter(Boolean) as Edge[]
      
      setEdges(newEdges)
    }
  }, [connections, showBuffers, currentTubes])
  
  // 连接
  const onConnect = useCallback((connection: Connection) => {
    if (isReadOnly) return
    
    const newEdge = {
      ...connection,
      id: crypto.randomUUID(),
      type: 'bezier' as const, // 使用贝塞尔曲线（弧线）
      animated: true,
      label: '0 μL',
      labelStyle: { fill: '#1e293b', fontWeight: 600, fontSize: 12 },
      labelShowBg: true,
      labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
      labelBgPadding: [8, 4] as [number, number],
      labelBgBorderRadius: 4,
      style: { stroke: '#4f46e5', strokeWidth: 3 },
      data: { volume: 0, volumeUnit: 'μL' }
    }
    
    setEdges(eds => addEdge(newEdge, eds) as Edge[])
    
    addConnection({
      fromTubeId: connection.source!,
      toTubeId: connection.target!,
      volume: 0,
      volumeUnit: 'μL'
    })
  }, [addConnection, isReadOnly])
  
  // 点击边修改体积
  const onEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (isReadOnly) return
    
    event.stopPropagation()
    
    const currentVolume = edge.data?.volume || 0
    const volume = prompt('请输入移液体积 (μL):', String(currentVolume))
    
    if (volume !== null) {
      const vol = parseFloat(volume) || 0
      
      setEdges(eds => eds.map(e => 
        e.id === edge.id 
          ? { ...e, label: `${vol} μL`, data: { ...e.data, volume: vol } }
          : e
      ))
      
      updateConnection(edge.id, { volume: vol })
      
      setTimeout(() => recalculateTargetTube(edge.target as string), 100)
    }
  }, [updateConnection, isReadOnly])
  
  // 计算目标试管的物质组成
  const recalculateTargetTube = (targetId: string) => {
    const incomingConns = connections.filter(c => c.toTubeId === targetId)
    
    let totalVolume = 0
    const substanceMap = new Map<string, { moles: number; unit: string }>()
    
    for (const conn of incomingConns) {
      const vol = conn.volume
      if (vol === 0) continue
      
      const sourceTube = currentTubes.find(t => t.id === conn.fromTubeId)
      if (!sourceTube || sourceTube.type === 'buffer') continue
      
      totalVolume += vol
      
      for (const sub of sourceTube.substances) {
        const moles = sub.concentration * vol
        const existing = substanceMap.get(sub.name)
        if (existing) {
          existing.moles += moles
        } else {
          substanceMap.set(sub.name, { moles, unit: sub.concentrationUnit })
        }
      }
    }
    
    const newSubstances: Substance[] = []
    substanceMap.forEach((data, name) => {
      newSubstances.push({
        name,
        concentration: Math.round((data.moles / totalVolume) * 1000) / 1000,
        concentrationUnit: data.unit as ConcentrationUnit
      })
    })
    
    updateTubeInExperiment(targetId, {
      substances: newSubstances,
      totalVolume,
      remainingVolume: totalVolume
    })
  }
  
  // 点击试管
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    event.stopPropagation()
    const tubeData = node.data as { tube: Tube }
    const tube = tubeData.tube
    
    // 优先使用试管数据中保存的 selectedBuffer
    let selectedBuffer = tube.selectedBuffer || ''
    
    // 如果试管数据中没有，尝试从现有连接中提取
    if (!selectedBuffer) {
      const bufferConn = connections.find(c => c.toTubeId === tube.id && 
        currentTubes.find(t => t.id === c.fromTubeId)?.type === 'buffer')
      
      // 从节点 ID 中提取仓库缓冲液 ID
      if (bufferConn && bufferConn.fromTubeId.startsWith('buffer-')) {
        const parts = bufferConn.fromTubeId.split('-')
        if (parts.length >= 3) {
          selectedBuffer = parts.slice(1, -1).join('-')
        }
      }
    }
    
    setEditingTube(tube)
    setEditFormData({
      name: tube.name,
      targetVolume: tube.totalVolume,
      targetVolumeUnit: tube.totalVolumeUnit,
      substances: [...tube.substances],
      selectedBuffer,
      asSource: tube.asSource || false
    })
  }, [connections, currentTubes])
  
  // 保存试管编辑（同时自动计算）
  const handleSaveTubeEdit = () => {
    if (!editingTube || isReadOnly) return
    
    // 检查名称唯一性
    const trimmedName = editFormData.name.trim()
    if (!trimmedName) {
      alert('试管名称不能为空')
      return
    }
    
    const duplicateName = currentTubes.find(t => 
      t.id !== editingTube.id && t.name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicateName) {
      alert(`试管名称 "${trimmedName}" 已存在，请使用其他名称`)
      return
    }
    
    // 保存试管修改
    // 注意：
    // 1. 原料试管的 remainingVolume 不应该被修改，它来自仓库
    // 2. 中间产物试管的 remainingVolume 由连接决定，不是目标体积
    // 3. 上样试管和耗损试管的 volume 就是目标体积
    
    if (editingTube.type === 'sample' || editingTube.type === 'waste') {
      // 上样试管或耗损试管：更新体积，并更新连接线的体积
      const updates: Partial<Tube> = {
        totalVolume: editFormData.targetVolume,
        totalVolumeUnit: editFormData.targetVolumeUnit,
        remainingVolume: editFormData.targetVolume,
        remainingVolumeUnit: editFormData.targetVolumeUnit
      }
      
      updateTubeInExperiment(editingTube.id, updates)
      
      // 更新所有连接到此试管的连接线体积
      const incomingConns = connections.filter(c => c.toTubeId === editingTube.id)
      for (const conn of incomingConns) {
        updateConnection(conn.id, { volume: editFormData.targetVolume })
      }
      
      setEditingTube(null)
      return
    }
    
    const updates: Partial<Tube> = {
      name: trimmedName,
      totalVolume: editFormData.targetVolume,
      totalVolumeUnit: editFormData.targetVolumeUnit,
      substances: editFormData.substances,
      selectedBuffer: editFormData.selectedBuffer,
      asSource: editFormData.asSource
    }
    
    updateTubeInExperiment(editingTube.id, updates)
    
    // 如果是中间产物试管且有物质设置，自动计算移液体积
    if (editingTube.type === 'intermediate' && editFormData.substances.length > 0) {
      const incomingConns = connections.filter(c => c.toTubeId === editingTube.id)
      if (incomingConns.length > 0) {
        // 执行自动计算（静默模式，不弹窗）
        performAutoCalculate(true)
      }
    }
    
    setEditingTube(null)
  }
  
  // 执行自动计算
  const performAutoCalculate = (silent: boolean = false) => {
    if (!editingTube) return false
    
    const incomingConns = connections.filter(c => c.toTubeId === editingTube.id)
    if (incomingConns.length === 0) {
      if (!silent) alert('请先从源试管连线到此试管')
      return false
    }
    
    const targetVolume = editFormData.targetVolume
    
    // 按源试管分组，计算每个源试管需要的移液体积
    const sourceTubeVolumes = new Map<string, number>()
    let hasMissingSource = false
    const missingSubstances: string[] = []
    
    for (const targetSub of editFormData.substances) {
      if (!targetSub.name || targetSub.concentration <= 0) continue
      
      let foundSource = false
      for (const conn of incomingConns) {
        const sourceTube = currentTubes.find(t => t.id === conn.fromTubeId)
        if (!sourceTube || sourceTube.type === 'buffer') continue
        
        const sourceSub = sourceTube.substances.find(s => s.name === targetSub.name)
        if (!sourceSub) continue
        
        const requiredVolume = (targetSub.concentration * targetVolume) / sourceSub.concentration
        const existingVolume = sourceTubeVolumes.get(conn.fromTubeId) || 0
        sourceTubeVolumes.set(conn.fromTubeId, Math.max(existingVolume, requiredVolume))
        
        foundSource = true
        break
      }
      
      if (!foundSource) {
        hasMissingSource = true
        missingSubstances.push(targetSub.name)
      }
    }
    
    if (hasMissingSource) {
      if (!silent) alert(`以下物质找不到源试管：${missingSubstances.join(', ')}\n请确保已从包含这些物质的试管连线到此试管。`)
      return false
    }
    
    if (sourceTubeVolumes.size === 0) {
      if (!silent) alert('没有可计算的物质，请先添加目标物质浓度')
      return false
    }
    
    let totalSubstanceVolume = 0
    sourceTubeVolumes.forEach(vol => totalSubstanceVolume += vol)
    
    if (totalSubstanceVolume > targetVolume) {
      if (!silent) alert(`源试管总体积 (${totalSubstanceVolume.toFixed(1)} μL) 超过目标体积 (${targetVolume} μL)！\n请降低目标物质浓度或增加目标体积。`)
      return false
    }
    
    // 更新每个源试管的移液体积
    for (const conn of incomingConns) {
      const requiredVolume = sourceTubeVolumes.get(conn.fromTubeId)
      if (requiredVolume !== undefined && requiredVolume > 0) {
        updateConnection(conn.id, { volume: requiredVolume })
        setEdges(eds => eds.map(e => {
          if (e.id === conn.id) {
            return { ...e, label: `${requiredVolume.toFixed(1)} μL`, data: { ...e.data, volume: requiredVolume } }
          }
          return e
        }))
      }
    }
    
    // 处理缓冲液连接
    // 先查找所有现有的缓冲液连接
    const existingBufferConns = connections.filter(c => 
      c.toTubeId === editingTube.id && 
      currentTubes.find(t => t.id === c.fromTubeId)?.type === 'buffer'
    )
    
    // 计算需要的缓冲液体积
    const bufferVolume = targetVolume > totalSubstanceVolume ? targetVolume - totalSubstanceVolume : 0
    
    if (bufferVolume > 0 && editFormData.selectedBuffer) {
      // 需要缓冲液
      const bufferTemplate = warehouseTubes.find(t => t.id === editFormData.selectedBuffer)
      if (bufferTemplate) {
        // 查找是否已有同类型的缓冲液连接
        const existingSameBufferConn = existingBufferConns.find(c => 
          c.fromTubeId.startsWith(`buffer-${bufferTemplate.id}-`)
        )
        
        if (existingSameBufferConn) {
          // 更新现有连接体积
          updateConnection(existingSameBufferConn.id, { volume: bufferVolume })
          setEdges(eds => eds.map(e => {
            if (e.id === existingSameBufferConn.id) {
              return { ...e, label: `${bufferVolume.toFixed(1)} μL`, data: { ...e.data, volume: bufferVolume } }
            }
            return e
          }))
        } else {
          // 创建新的缓冲液连接
          const bufferNodeId = `buffer-${bufferTemplate.id}-${editingTube.id}`
          
          const bufferTube: Tube = {
            ...bufferTemplate,
            id: bufferNodeId,
            name: bufferTemplate.name,
            type: 'buffer'
          }
          
          addBufferTube(bufferTube)
          
          addConnection({
            fromTubeId: bufferNodeId,
            toTubeId: editingTube.id,
            volume: bufferVolume,
            volumeUnit: 'μL'
          })
          
          const targetPosition = tubePositions.find(p => p.tubeId === editingTube.id) || 
            nodes.find(n => n.id === editingTube.id)?.position || { x: 200, y: 200 }
          const bufferPosition = { x: targetPosition.x - 80, y: targetPosition.y - 60 }
          
          updateTubePosition(bufferNodeId, bufferPosition.x, bufferPosition.y)
          
          setNodes(nds => [...nds, {
            id: bufferNodeId,
            type: 'tube',
            position: bufferPosition,
            data: { tube: bufferTube, isSource: false, isBuffer: true }
          }])
        }
        
        // 删除其他类型的缓冲液连接（切换了缓冲液类型）
        const otherBufferConns = existingBufferConns.filter(c => 
          !c.fromTubeId.startsWith(`buffer-${bufferTemplate.id}-`)
        )
        if (otherBufferConns.length > 0) {
          otherBufferConns.forEach(conn => {
            removeConnection(conn.id)
            removeTube(conn.fromTubeId)
          })
          setNodes(nds => nds.filter(n => !otherBufferConns.map(c => c.fromTubeId).includes(n.id)))
          setEdges(eds => eds.filter(e => !otherBufferConns.map(c => c.id).includes(e.id)))
        }
      }
    } else {
      // 不需要缓冲液，删除所有现有的缓冲液连接
      if (existingBufferConns.length > 0) {
        const bufferConnIds = existingBufferConns.map(c => c.id)
        const bufferTubeIds = existingBufferConns.map(c => c.fromTubeId)
        
        // 删除连接和试管
        bufferConnIds.forEach(id => removeConnection(id))
        bufferTubeIds.forEach(id => removeTube(id))
        
        // 更新画布
        setNodes(nds => nds.filter(n => !bufferTubeIds.includes(n.id)))
        setEdges(eds => eds.filter(e => !bufferConnIds.includes(e.id)))
      }
    }
    
    if (!silent) {
      alert(`计算完成！\n源试管总体积: ${totalSubstanceVolume.toFixed(1)} μL\n缓冲液体积: ${targetVolume > totalSubstanceVolume ? (targetVolume - totalSubstanceVolume).toFixed(1) : 0} μL`)
    }
    
    return true
  }
  
  // 自动计算按钮 - 先保存再计算
  const handleAutoCalculate = () => {
    if (!editingTube || isReadOnly) return
    
    // 保存试管修改
    const updates: Partial<Tube> = {
      name: editFormData.name,
      totalVolume: editFormData.targetVolume,
      totalVolumeUnit: editFormData.targetVolumeUnit,
      substances: editFormData.substances
    }
    
    // 只有原料试管才设置 remainingVolume
    if (editingTube.type === 'source') {
      updates.remainingVolume = editFormData.targetVolume
      updates.remainingVolumeUnit = editFormData.targetVolumeUnit
    }
    
    updateTubeInExperiment(editingTube.id, updates)
    
    // 然后执行计算（带提示）
    performAutoCalculate(false)
    // 不关闭详情窗口
  }
  
  // 从仓库添加试管
  const handleAddFromWarehouse = (tube: Tube) => {
    if (isReadOnly) return
    
    // 如果是中间产物从仓库添加，设置 asSource = true
    const tubeWithAsSource = tube.type === 'intermediate' 
      ? { ...tube, asSource: true }
      : tube
    
    addSourceTube(tubeWithAsSource)
    
    const newNode: Node = {
      id: tubeWithAsSource.id,
      type: 'tube',
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: { tube: tubeWithAsSource, isSource: tubeWithAsSource.type === 'source', isBuffer: tubeWithAsSource.type === 'buffer' }
    }
    
    setNodes(nds => [...nds, newNode])
    setShowTubeSelector(false)
  }
  
  // 创建新试管
  const handleCreateIntermediate = () => {
    if (isReadOnly) return
    
    const tubeCount = currentTubes.filter(t => t.type === 'intermediate').length + 1
    const baseName = `Tube ${tubeCount}`
    const name = quickNaming ? `${experimentDate}-${baseName}` : baseName
    
    const newTube: Tube = {
      id: crypto.randomUUID(),
      name,
      type: 'intermediate',
      totalVolume: 100,
      totalVolumeUnit: 'μL',
      remainingVolume: 0, // 中间产物初始体积为 0
      remainingVolumeUnit: 'μL',
      substances: [],
      selectedBuffer: currentExperiment?.defaultBuffer, // 预设默认缓冲液
      asSource: false, // 新建试管不允许作为原料
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active'
    }
    
    addIntermediateTube(newTube)
    // 不自动打开详情窗口
  }
  
  // 创建上样试管
  const handleCreateSample = () => {
    if (isReadOnly) return
    
    const sampleCount = currentTubes.filter(t => t.type === 'sample').length + 1
    const baseName = `上样 ${sampleCount}`
    const name = quickNaming ? `${experimentDate}-${baseName}` : baseName
    
    const newTube: Tube = {
      id: crypto.randomUUID(),
      name,
      type: 'sample',
      totalVolume: 0,
      totalVolumeUnit: 'μL',
      remainingVolume: 0,
      remainingVolumeUnit: 'μL',
      substances: [], // 上样试管不需要物质信息
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active'
    }
    
    addSampleTube(newTube)
  }
  
  // 创建耗损试管
  const handleCreateWaste = () => {
    if (isReadOnly) return
    
    const wasteCount = currentTubes.filter(t => t.type === 'waste').length + 1
    const baseName = `耗损 ${wasteCount}`
    const name = quickNaming ? `${experimentDate}-${baseName}` : baseName
    
    const newTube: Tube = {
      id: crypto.randomUUID(),
      name,
      type: 'waste',
      totalVolume: 0,
      totalVolumeUnit: 'μL',
      remainingVolume: 0,
      remainingVolumeUnit: 'μL',
      substances: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active'
    }
    
    // 使用 addWasteTube
    const { addWasteTube } = useExperimentStore.getState()
    addWasteTube(newTube)
  }
  
  // 开始新实验
  const handleStartExperiment = () => {
    if (!experimentName.trim()) {
      alert('请输入实验名称')
      return
    }
    createNewExperiment(experimentName)
    setExperimentName('')
    // 清空画布
    setNodes([])
    setEdges([])
  }
  
  // 保存实验
  const handleSaveExperiment = () => {
    saveCurrentExperiment()
    alert('实验已保存！')
  }
  
  // 另存为
  const handleSaveAs = () => {
    if (!saveAsName.trim()) {
      alert('请输入新名称')
      return
    }
    saveCurrentExperiment(saveAsName)
    setShowSaveAs(false)
    setSaveAsName('')
    alert('实验已另存为：' + saveAsName)
  }
  
  // 创建耗损实验
  const handleCreateWasteExperiment = async () => {
    if (!experimentName.trim()) {
      alert('请输入实验名称')
      return
    }
    
    await createNewExperiment(experimentName, '耗损实验')
    
    // 创建默认的耗损试管
    const wasteTube: Tube = {
      id: crypto.randomUUID(),
      name: '耗损',
      type: 'waste',
      totalVolume: 0,
      totalVolumeUnit: 'μL',
      remainingVolume: 0,
      remainingVolumeUnit: 'μL',
      substances: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active'
    }
    
    // 添加耗损试管到实验
    const { addWasteTube, setExperimentAsWaste } = useExperimentStore.getState()
    addWasteTube(wasteTube)
    setExperimentAsWaste(true)
    
    setExperimentName('')
  }
  
  // 删除试管
  const handleDeleteTube = (tubeId: string) => {
    if (isReadOnly) return
    if (!confirm('确定删除这个试管？相关的移液连接也会被删除。')) return
    
    // 删除相关连接
    const relatedConns = connections.filter(c => c.fromTubeId === tubeId || c.toTubeId === tubeId)
    relatedConns.forEach(c => removeConnection(c.id))
    
    // 从 store 中移除试管
    const { removeTube } = useExperimentStore.getState()
    removeTube(tubeId)
    
    // 更新画布
    setNodes(nds => nds.filter(n => n.id !== tubeId))
    setEdges(eds => eds.filter(e => e.source !== tubeId && e.target !== tubeId))
    
    setEditingTube(null)
  }
  
  // 结束实验
  const handleCompleteExperiment = async () => {
    if (!currentExperiment) return
    
    if (confirm('确定结束实验？\n\n所有修改将同步到试剂仓库：\n- 原料试管的剩余体积将更新\n- 中间产物将添加到仓库\n\n此操作不可撤销。')) {
      await completeExperiment()
      alert('实验已完成！改动已同步到试剂仓库。')
    }
  }
  
  // 跳转到溯源页面
  const handleGoToTrace = () => {
    if (editingTube) {
      navigate(`/trace?tubeId=${editingTube.id}`)
    }
  }
  
  // 打开已有实验
  const handleOpenExperiment = (id: string) => {
    loadExperiment(id)
    setShowExperimentManager(false)
  }
  
  // 删除实验
  const handleDeleteExperiment = (id: string) => {
    if (confirm('确定删除这个实验？此操作不可恢复。')) {
      deleteExperiment(id)
    }
  }
  
  // 缓冲液试管列表
  const bufferTubes = warehouseTubes.filter(t => t.type === 'buffer' && t.status === 'active')
  // 允许添加原料和中间产物到实验
  const sourceTubes = warehouseTubes.filter(t => 
    (t.type === 'source' || t.type === 'intermediate') && t.status === 'active'
  )
  
  return (
    <div className={styles.container}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {!currentExperiment ? (
            <div className={styles.newExperiment}>
              <input
                type="text"
                placeholder={t('toolbar.experimentName', language)}
                value={experimentName}
                onChange={(e) => setExperimentName(e.target.value)}
                className={styles.experimentNameInput}
              />
              <button className={styles.startBtn} onClick={handleStartExperiment}>
                {t('toolbar.startExperiment', language)}
              </button>
              <button className={styles.wasteBtn} onClick={handleCreateWasteExperiment}>
                {t('toolbar.newWaste', language)}
              </button>
              <button className={styles.openBtn} onClick={() => setShowExperimentManager(true)}>
                📁 {t('toolbar.open', language)}
              </button>
            </div>
          ) : (
            <div className={styles.experimentInfo}>
              <h2 className={styles.experimentName}>
                {currentExperiment.name}
                {isReadOnly && <span className={styles.readOnlyBadge}>{t('readOnly.badge', language)}</span>}
              </h2>
              <span className={styles.experimentStatus}>
                {currentExperiment.status === 'draft' ? t('status.draft', language) : 
                 currentExperiment.status === 'completed' ? t('status.completed', language) : t('status.reverted', language)}
              </span>
            </div>
          )}
        </div>
        
        {currentExperiment && (
          <div className={styles.toolbarRight}>
            <label className={styles.toggleLabel}>
              <input 
                type="checkbox" 
                checked={showBuffers} 
                onChange={(e) => setShowBuffers(e.target.checked)} 
              />
              {t('toolbar.showBuffers', language)}
            </label>
            
            {!isReadOnly && (
              <>
                <label className={styles.bufferLabel}>
                  {t('toolbar.defaultBuffer', language)}
                  <select 
                    value={currentExperiment?.defaultBuffer || ''} 
                    onChange={(e) => setDefaultBuffer(e.target.value || undefined)}
                    className={styles.bufferSelect}
                  >
                    <option value="">{t('toolbar.noBuffer', language)}</option>
                    {bufferTubes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                
                <button className={styles.addTubeBtn} onClick={() => setShowTubeSelector(true)}>
                  {t('toolbar.addFromWarehouse', language)}
                </button>
                
                <button className={styles.addTubeBtn} onClick={handleCreateIntermediate}>
                  {t('toolbar.newTube', language)}
                </button>
                
                <button className={styles.addTubeBtn} onClick={handleCreateSample}>
                  {t('toolbar.newSample', language)}
                </button>
                
                <button className={styles.wasteAddBtn} onClick={handleCreateWaste}>
                  {t('toolbar.newWasteTube', language)}
                </button>
                
                <button className={styles.saveBtn} onClick={handleSaveExperiment}>
                  💾 {t('toolbar.save', language)}
                </button>
                
                <button className={styles.saveBtn} onClick={() => setShowSaveAs(true)}>
                  📄 {t('toolbar.saveAs', language)}
                </button>
                
                <div className={styles.dateSection}>
                  <input
                    type="text"
                    value={experimentDate}
                    onChange={(e) => setExperimentDate(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    className={styles.dateInput}
                    placeholder="YYMMDD"
                    maxLength={6}
                  />
                  <label className={styles.quickNamingLabel}>
                    <input
                      type="checkbox"
                      checked={quickNaming}
                      onChange={(e) => setQuickNaming(e.target.checked)}
                    />
                    {t('toolbar.quickNaming', language)}
                  </label>
                </div>
                
                <button className={styles.completeBtn} onClick={handleCompleteExperiment}>
                  {t('toolbar.endExperiment', language)}
                </button>
                
                <button className={styles.checkBtn} onClick={handleCheckExperiment}>
                  🔍 {t('toolbar.check', language)}
                </button>
              </>
            )}
            
            <button className={styles.newBtn} onClick={() => {
              resetExperiment()
              setNodes([])
              setEdges([])
            }}>
              {t('toolbar.newExperiment', language)}
            </button>
            
            <button className={styles.wasteBtn} onClick={handleCreateWasteExperiment}>
              {t('toolbar.newWaste', language)}
            </button>
            
            <button className={styles.openBtn} onClick={() => setShowExperimentManager(true)}>
              📁 {t('toolbar.open', language)}
            </button>
          </div>
        )}
      </header>
      
      <div className={styles.canvas}>
        {currentExperiment ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
          >
            <Background />
            <Controls />
            <MiniMap />
            <Panel position="top-right">
              <div className={styles.helpPanel}>
                <p>💡 操作提示:</p>
                <ul>
                  <li>拖拽试管移动位置</li>
                  <li>从右侧圆点拖出连线</li>
                  <li><strong>双击连线数字修改体积</strong></li>
                  <li>点击试管查看/编辑参数</li>
                  <li><strong>选中后按 Delete 删除</strong></li>
                </ul>
                {isReadOnly && (
                  <p className={styles.readOnlyHint}>🔒 此实验已结束，无法修改</p>
                )}
              </div>
            </Panel>
          </ReactFlow>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🔬</div>
            <p>创建一个新实验开始模拟</p>
            <p className={styles.emptyHint}>或点击"打开工程"继续之前的实验</p>
          </div>
        )}
      </div>
      
      {/* 工程管理弹窗 */}
      {showExperimentManager && (
        <div className={styles.modal} onClick={() => setShowExperimentManager(false)}>
          <div className={styles.modalContentWide} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>工程管理</h2>
            
            <div className={styles.experimentList}>
              {experiments.length === 0 ? (
                <div className={styles.emptyHint}>暂无保存的工程</div>
              ) : (
                experiments.map(exp => (
                  <div key={exp.id} className={styles.experimentItem}>
                    <div className={styles.experimentItemInfo}>
                      <h3>
                        {exp.name}
                        {exp.isWaste && <span className={styles.wasteTag}>耗损</span>}
                      </h3>
                      <div className={styles.experimentItemMeta}>
                        <span className={`${styles.statusTag} ${styles[exp.status]}`}>
                          {exp.status === 'draft' ? '草稿' : 
                           exp.status === 'completed' ? '已完成' : '已回退'}
                        </span>
                        <span>{new Date(exp.updatedAt).toLocaleString('zh-CN')}</span>
                        <span>{exp.tubes?.length || 0} 个试管</span>
                      </div>
                    </div>
                    <div className={styles.experimentItemActions}>
                      <button onClick={() => handleOpenExperiment(exp.id)}>
                        打开
                      </button>
                      <button 
                        className={styles.deleteBtn}
                        onClick={() => handleDeleteExperiment(exp.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={() => setShowExperimentManager(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 另存为弹窗 */}
      {showSaveAs && (
        <div className={styles.modal} onClick={() => setShowSaveAs(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h3>另存为</h3>
            <input
              type="text"
              placeholder="输入新工程名称..."
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              autoFocus
            />
            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={() => setShowSaveAs(false)}>
                取消
              </button>
              <button className={styles.submitBtn} onClick={handleSaveAs}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 试管选择器 */}
      {showTubeSelector && (
        <div className={styles.modal} onClick={() => setShowTubeSelector(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h3>选择试剂</h3>
            <div className={styles.tubeList}>
              {sourceTubes.map(tube => (
                <div 
                  key={tube.id}
                  className={styles.tubeOption}
                  onClick={() => handleAddFromWarehouse(tube)}
                >
                  <div>
                    <strong>
                      {tube.type === 'source' ? '📦' : '🧪'} {tube.name}
                    </strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {tube.substances.map(s => s.name).join(', ')}
                    </div>
                  </div>
                  <span>{tube.remainingVolume === Infinity ? '∞' : `${tube.remainingVolume} ${tube.remainingVolumeUnit}`}</span>
                </div>
              ))}
              {sourceTubes.length === 0 && (
                <p className={styles.emptyHint}>仓库中没有可用试剂</p>
              )}
            </div>
            <button className={styles.closeBtn} onClick={() => setShowTubeSelector(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
      
      {/* 试管详情/编辑 */}
      {editingTube && (
        <div className={styles.modal} onClick={() => setEditingTube(null)}>
          <div className={styles.editModalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>{editingTube.name}</h3>
              <button className={styles.traceBtn} onClick={handleGoToTrace}>
                🔍 溯源
              </button>
            </div>
            
            <div className={styles.typeTag}>
              {editingTube.type === 'source' ? t('tube.source', language) : 
               editingTube.type === 'buffer' ? t('tube.buffer', language) : 
               editingTube.type === 'sample' ? t('tube.sample', language) : 
               editingTube.type === 'waste' ? t('tube.waste', language) : t('tube.intermediate', language)}
            </div>
            
            {isReadOnly && (
              <div className={styles.readOnlyNotice}>
                {t('readOnly.notice', language)}
              </div>
            )}
            
            {/* 上样试管或耗损试管只显示体积 */}
            {editingTube.type === 'sample' || editingTube.type === 'waste' ? (
              <div className={styles.formGroup}>
                <label>{editingTube.type === 'sample' ? t('tubeDetail.sampleVolume', language) : t('tubeDetail.wasteVolume', language)}</label>
                <div className={styles.formRow}>
                  <input
                    type="number"
                    value={editFormData.targetVolume}
                    onChange={(e) => setEditFormData({ ...editFormData, targetVolume: Number(e.target.value) })}
                    min="0"
                    step="0.1"
                    disabled={isReadOnly}
                  />
                  <select
                    value={editFormData.targetVolumeUnit}
                    onChange={(e) => setEditFormData({ ...editFormData, targetVolumeUnit: e.target.value as VolumeUnit })}
                    disabled={isReadOnly}
                  >
                    <option value="nL">nL</option>
                    <option value="μL">μL</option>
                    <option value="mL">mL</option>
                  </select>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.formGroup}>
                  <label>{t('tubeDetail.name', language)}</label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    disabled={editingTube.type === 'source' || isReadOnly}
                  />
                </div>
                
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>目标体积</label>
                    <input
                      type="number"
                      value={editFormData.targetVolume}
                      onChange={(e) => setEditFormData({ ...editFormData, targetVolume: Number(e.target.value) })}
                      min="0"
                      step="0.1"
                      disabled={editingTube.type === 'source' || isReadOnly}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>单位</label>
                    <select
                      value={editFormData.targetVolumeUnit}
                      onChange={(e) => setEditFormData({ ...editFormData, targetVolumeUnit: e.target.value as VolumeUnit })}
                      disabled={editingTube.type === 'source' || isReadOnly}
                    >
                      <option value="nL">nL</option>
                      <option value="μL">μL</option>
                      <option value="mL">mL</option>
                    </select>
                  </div>
                </div>
                
                {editingTube.type === 'intermediate' && !isReadOnly && (
                  <>
                    <div className={styles.formGroup}>
                      <label>目标物质浓度（设置后点击"自动计算"更新连线）</label>
                      <div className={styles.substanceList}>
                        {editFormData.substances.map((sub, i) => (
                          <div key={i} className={styles.substanceItem}>
                            <input
                              type="text"
                              value={sub.name}
                              onChange={(e) => {
                                const newSubs = [...editFormData.substances]
                                newSubs[i].name = e.target.value
                                setEditFormData({ ...editFormData, substances: newSubs })
                              }}
                              placeholder="物质名称"
                            />
                            <input
                              type="number"
                              value={sub.concentration || ''}
                              onChange={(e) => {
                                const newSubs = [...editFormData.substances]
                                newSubs[i].concentration = Number(e.target.value)
                                setEditFormData({ ...editFormData, substances: newSubs })
                              }}
                              placeholder="浓度"
                            />
                            <select
                              value={sub.concentrationUnit}
                              onChange={(e) => {
                                const newSubs = [...editFormData.substances]
                                newSubs[i].concentrationUnit = e.target.value as any
                                setEditFormData({ ...editFormData, substances: newSubs })
                              }}
                            >
                              <option value="nM">nM</option>
                              <option value="μM">μM</option>
                              <option value="mM">mM</option>
                            </select>
                            <button
                              className={styles.removeSubstanceBtn}
                              onClick={() => {
                                const newSubs = editFormData.substances.filter((_, idx) => idx !== i)
                                setEditFormData({ ...editFormData, substances: newSubs })
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        className={styles.addSubstanceBtn}
                        onClick={() => setEditFormData({
                          ...editFormData,
                          substances: [...editFormData.substances, { name: '', concentration: 0, concentrationUnit: 'μM' }]
                        })}
                      >
                        + 添加物质
                      </button>
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label>缓冲液补足</label>
                      <select
                        value={editFormData.selectedBuffer}
                        onChange={(e) => setEditFormData({ ...editFormData, selectedBuffer: e.target.value })}
                      >
                        <option value="">不使用缓冲液</option>
                        {bufferTubes.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      {bufferTubes.length === 0 && (
                        <p className={styles.hint}>请先在仓库中创建缓冲液</p>
                      )}
                    </div>
                    
                    {/* 作为原料选项 - 仅对从仓库添加的中间产物显示 */}
                    {warehouseTubes.find(t => t.id === editingTube.id) && (
                      <div className={styles.formGroup}>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={editFormData.asSource}
                            onChange={(e) => setEditFormData({ ...editFormData, asSource: e.target.checked })}
                            disabled={isReadOnly}
                          />
                          作为原料（上次实验剩下的试剂）
                        </label>
                        <p className={styles.hint}>选中后，检查时将赦免此试管的成分输入问题</p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            
            <div className={styles.formActions}>
              {!isReadOnly && editingTube.type !== 'source' && (
                <button 
                  className={styles.deleteTubeBtn} 
                  onClick={() => handleDeleteTube(editingTube.id)}
                >
                  🗑️ 删除试管
                </button>
              )}
              <button className={styles.cancelBtn} onClick={() => setEditingTube(null)}>
                {isReadOnly ? '关闭' : '取消'}
              </button>
              {editingTube.type === 'intermediate' && !isReadOnly && (
                <button className={styles.calcBtn} onClick={handleAutoCalculate}>
                  自动计算
                </button>
              )}
              {!isReadOnly && (
                <button className={styles.submitBtn} onClick={handleSaveTubeEdit}>
                  保存
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* 检查结果侧边面板 - 非模态，可同时操作工程 */}
      {showCheckResult && (
        <div className={styles.checkResultPanel}>
          <div className={styles.panelHeader}>
            <h3>🔍 检查结果 {checkErrors.length > 0 && `(${checkErrors.length}个问题)`}</h3>
            <div className={styles.panelActions}>
              <button className={styles.recheckBtn} onClick={handleCheckExperiment}>
                重新检查
              </button>
              <button className={styles.closeResultBtn} onClick={() => setShowCheckResult(false)}>
                ✕
              </button>
            </div>
          </div>
          
          <div className={styles.panelContent}>
            {checkErrors.length === 0 ? (
              <div className={styles.checkSuccess}>
                ✅ 工程检查通过，没有发现问题！
              </div>
            ) : (
              <div className={styles.checkErrors}>
                <ul className={styles.errorList}>
                  {checkErrors.map((error, index) => (
                    <li key={index} className={styles.errorItem}>
                      <span className={styles.errorTube}>{error.tubeName}</span>
                      <span className={styles.errorType}>
                        {error.type === 'volume_exceed' && '⚠️ 体积超出'}
                        {error.type === 'buffer_missing' && '💧 缺少缓冲液'}
                        {error.type === 'substance_source_missing' && '🔗 缺少成分来源'}
                        {error.type === 'calculation_error' && '🔢 计算错误'}
                        {error.type === 'zero_concentration' && '📊 浓度为0'}
                      </span>
                      <span className={styles.errorMessage}>{error.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
