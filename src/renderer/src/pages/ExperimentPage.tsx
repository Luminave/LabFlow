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
  NodeTypes,
  EdgeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useWarehouseStore } from '../stores/warehouseStore'
import { useExperimentStore } from '../stores/experimentStore'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import { Tube, Substance, ConcentrationUnit, VolumeUnit, TransferConnection } from '@shared/types'
import { roundVolume } from '@shared/utils/calculations'
import TubeNode from '../components/TubeNode'
import TransferEdge from '../components/TransferEdge'
import styles from './ExperimentPage.module.css'

const nodeTypes: NodeTypes = { tube: TubeNode }
const edgeTypes: EdgeTypes = { transfer: TransferEdge }

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
    saveAsExperiment,
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
  const [experimentSearch, setExperimentSearch] = useState('')
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
  const [quickNaming, setQuickNaming] = useState(true) // 快捷试管命名,默认启用
  const [syncTubeName, setSyncTubeName] = useState(false) // 同步修改试管名称

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
        // 原料试管:使用仓库中的初始体积 - 移出体积
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        const initialVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
        endVolume = roundVolume(Math.max(0, initialVolume - outVolume))
      } else if (tube.type === 'buffer') {
        // 缓冲液:保持不变
        endVolume = tube.remainingVolume
      } else if (tube.type === 'intermediate') {
        // 中间产物:判断是从仓库添加的还是新创建的
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        const isInWarehouse = !!whTube

        if (isInWarehouse) {
          // 从仓库添加的中间产物:当作原料处理
          const initialVolume = whTube.remainingVolume
          endVolume = roundVolume(Math.max(0, initialVolume - outVolume))
        } else {
          // 新创建的中间产物:移入体积 - 移出体积
          endVolume = roundVolume(Math.max(0, inVolume - outVolume))
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

  // 是否为只读模式(已完成的实验)
  const isReadOnly = currentExperiment?.status === 'completed' || currentExperiment?.status === 'reverted'

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

    // 1. 检查试管输出体积是否大于输入体积,或原料试管输出是否大于剩余体积
    for (const tube of currentTubes) {
      const outVolume = tubeOutVolume.get(tube.id) || 0
      const inVolume = tubeInVolume.get(tube.id) || 0

      if (tube.type === 'source') {
        // 原料试管:检查输出是否大于仓库中的剩余体积
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        const availableVolume = whTube ? whTube.remainingVolume : tube.remainingVolume
        if (outVolume > availableVolume) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'volume_exceed',
            message: `${language === 'zh' ? '原料试管输出体积' : 'Source output volume'}(${outVolume.toFixed(2)})${language === 'zh' ? '大于可用体积' : 'exceeds available'}(${availableVolume.toFixed(2)})`
          })
        }
      } else if (tube.type === 'intermediate') {
        // 如果试管标记为"作为原料",跳过体积检查(因为它没有输入是正常的)
        if (tube.asSource) continue

        // 中间产物:检查是否是从仓库添加的
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        if (whTube) {
          // 从仓库添加的中间产物:当作原料处理
          if (outVolume > whTube.remainingVolume) {
            errors.push({
              tubeId: tube.id,
              tubeName: tube.name,
              type: 'volume_exceed',
              message: `${language === 'zh' ? '中间产物试管输出体积' : 'Intermediate output volume'}(${outVolume.toFixed(2)})${language === 'zh' ? '大于仓库中可用体积' : 'exceeds warehouse available'}(${whTube.remainingVolume.toFixed(2)})`
            })
          }
        } else {
          // 新创建的中间产物:检查输出是否大于输入
          if (outVolume > inVolume) {
            errors.push({
              tubeId: tube.id,
              tubeName: tube.name,
              type: 'volume_exceed',
              message: `${language === 'zh' ? '中间产物试管输出体积' : 'Intermediate output volume'}(${outVolume.toFixed(2)})${language === 'zh' ? '大于输入体积' : 'exceeds input volume'}(${inVolume.toFixed(2)})`
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

      // 如果目标体积大于输入体积,需要缓冲液补足
      if (targetVolume > inVolume && !hasBufferConnection && !hasSelectedBuffer) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'buffer_missing',
          message: `${language === 'zh' ? '中间产物需要缓冲液补足' : 'Intermediate needs buffer fill'}(${(targetVolume - inVolume).toFixed(2)}),${language === 'zh' ? '但未连接缓冲液' : 'but no buffer connected'}`
        })
      }
    }

    // 3. 检查子试管是否需要某种成分但没有连线到含有该成分的父试管
    for (const tube of currentTubes) {
      if (tube.type !== 'intermediate' || tube.substances.length === 0) continue

      // 如果试管标记为"作为原料",跳过成分来源检查
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
            message: `${language === 'zh' ? '需要成分' : 'Needs substance'}"${targetSub.name}",${language === 'zh' ? '但没有连线到含有该成分的源试管' : 'but no connection to tube containing it'}`
          })
        }
      }
    }

    // 4. 检查所有试管计算是否正确
    for (const tube of currentTubes) {
      if (tube.type === 'sample' || tube.type === 'waste') continue

      // 如果试管标记为"作为原料",跳过计算检查(因为它没有输入是正常的)
      if (tube.asSource) continue

      const inVolume = tubeInVolume.get(tube.id) || 0
      const outVolume = tubeOutVolume.get(tube.id) || 0
      const incomingConns = connections.filter(c => c.toTubeId === tube.id)

      // 计算所有输入连线的体积总和
      const totalInputFromConnections = incomingConns.reduce((sum, c) => sum + (c.volume || 0), 0)

      // 对于中间产物,检查连线体积是否与目标体积匹配
      if (tube.type === 'intermediate' && tube.totalVolume > 0) {
        // 检查是否有缓冲液连线
        const bufferVolume = incomingConns
          .filter(c => currentTubes.find(t => t.id === c.fromTubeId)?.type === 'buffer')
          .reduce((sum, c) => sum + (c.volume || 0), 0)

        const nonBufferInput = totalInputFromConnections - bufferVolume
        const expectedBufferVolume = tube.totalVolume - nonBufferInput

        // 如果目标体积与实际输入不匹配(且差异超过0.1)
        if (Math.abs(totalInputFromConnections - tube.totalVolume) > 0.1) {
          errors.push({
            tubeId: tube.id,
            tubeName: tube.name,
            type: 'calculation_error',
            message: `${language === 'zh' ? '目标体积' : 'Target volume'}(${tube.totalVolume})${language === 'zh' ? '与实际输入体积' : 'vs actual input'}(${totalInputFromConnections.toFixed(2)})${language === 'zh' ? '不匹配' : 'mismatch'}`
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
            message: `${language === 'zh' ? '定义了成分' : 'Substance'}"${sub.name}"${language === 'zh' ? '但浓度为0' : 'has zero concentration'}`
          })
        }
      }
    }

    // 6. 检查配置序号（讲述者功能需要）
    const intermediateTubes = currentTubes.filter(
      t => t.type === 'intermediate' && !t.asSource
    )

    // 检查是否有未设置序号的中间产物
    for (const tube of intermediateTubes) {
      if (!tube.configOrder) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'config_order_missing',
          message: language === 'zh' ? '中间产物试管未设置配置序号（讲述者需要）' : 'Intermediate tube has no config order (required by Narrator)'
        })
      } else if (tube.configOrder <= 0 || !Number.isInteger(tube.configOrder)) {
        errors.push({
          tubeId: tube.id,
          tubeName: tube.name,
          type: 'config_order_invalid',
          message: `${language === 'zh' ? '配置序号必须是正整数，当前值:' : 'Config order must be positive integer, current:'} ${tube.configOrder}`
        })
      }
    }

    // 检查序号是否有重复
    const orderCounts = new Map<number, string[]>()
    for (const tube of intermediateTubes) {
      if (tube.configOrder) {
        const existing = orderCounts.get(tube.configOrder) || []
        existing.push(tube.name)
        orderCounts.set(tube.configOrder, existing)
      }
    }
    for (const [order, tubeNames] of orderCounts) {
      if (tubeNames.length > 1) {
        errors.push({
          tubeId: '',
          tubeName: tubeNames.join(', '),
          type: 'config_order_duplicate',
          message: `${language === 'zh' ? '配置序号' : 'Config order'} ${order} ${language === 'zh' ? '重复使用（' : 'duplicated ('}${tubeNames.join(', ')}${language === 'zh' ? '）' : ')'}`
        })
      }
    }

    // 检查序号是否有跳过
    if (intermediateTubes.length > 0 && orderCounts.size > 0) {
      const orders = Array.from(orderCounts.keys()).sort((a, b) => a - b)
      for (let i = 1; i < orders.length; i++) {
        if (orders[i] - orders[i - 1] > 1) {
          errors.push({
            tubeId: '',
            tubeName: '',
            type: 'config_order_gap',
            message: `${language === 'zh' ? '配置序号有跳过：从' : 'Config order gap: from'} ${orders[i - 1]} ${language === 'zh' ? '跳到' : 'to'} ${orders[i]}`
          })
        }
      }
    }

    setCheckErrors(errors)
    setShowCheckResult(true)
  }

  // 清空所有讲述者序号
  const handleClearConfigOrders = () => {
    if (!currentExperiment || isReadOnly) return
    if (!confirm(language === 'zh' ? '确定清空当前工程中所有试管的讲述者序号？' : 'Clear all narrator orders in this project?')) return

    const newTubes = currentTubes.map(tube => {
      if (tube.configOrder) {
        return { ...tube, configOrder: undefined, updatedAt: new Date().toISOString() }
      }
      return tube
    })

    for (const tube of newTubes) {
      updateTubeInExperiment(tube.id, { configOrder: tube.configOrder })
    }
  }

  // 刷新工程 - 重新计算中间产物，从仓库更新原料试管
  const handleRefreshExperiment = () => {
    if (!currentExperiment || isReadOnly) return

    // 先刷新仓库数据
    fetchTubes()

    const newTubes = currentTubes.map(tube => {
      // 原料试管：从仓库重新读取当前体积
      if (tube.type === 'source') {
        const whTube = warehouseTubes.find(t => t.id === tube.id)
        if (whTube) {
          return {
            ...tube,
            remainingVolume: whTube.remainingVolume,
            remainingVolumeUnit: whTube.remainingVolumeUnit,
            substances: whTube.substances,
            updatedAt: new Date().toISOString()
          }
        }
      }

      // 中间产物试管：重新计算体积
      if (tube.type === 'intermediate') {
        const inVolume = connections
          .filter(c => c.toTubeId === tube.id)
          .reduce((sum, c) => sum + c.volume, 0)
        const outVolume = connections
          .filter(c => c.fromTubeId === tube.id)
          .reduce((sum, c) => sum + c.volume, 0)
        return {
          ...tube,
          remainingVolume: inVolume - outVolume,
          remainingVolumeUnit: tube.totalVolumeUnit,
          updatedAt: new Date().toISOString()
        }
      }

      return tube
    })

    // 更新实验数据
    set({ currentTubes: newTubes })
    alert(language === 'zh' ? '工程已刷新！' : 'Project refreshed!')
  }
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
        // 如果正在编辑输入框,不处理
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

  // 自定义节点变化处理,保存位置到 store
  const handleNodesChange = useCallback((changes: any[]) => {
    if (isReadOnly) return // 只读模式不允许拖拽

    onNodesChange(changes)

    // 当节点位置改变时,保存到 store
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

  // 更新边标签位置
  const handleUpdateLabelPosition = useCallback((edgeId: string, position: number) => {
    if (isReadOnly) return
    updateConnection(edgeId, { labelPosition: position })
    // 同步更新 edges 中的 data
    setEdges(eds => eds.map(e =>
      e.id === edgeId
        ? { ...e, data: { ...e.data, labelPosition: position } }
        : e
    ))
  }, [updateConnection, isReadOnly])

  // 编辑试管
  const [editingTube, setEditingTube] = useState<Tube | null>(null)
  const [editingEdge, setEditingEdge] = useState<{id: string, volume: number, volumeUnit: string} | null>(null)
  const [editFormData, setEditFormData] = useState<{
    name: string
    targetVolume: number
    targetVolumeUnit: VolumeUnit
    substances: Substance[]
    selectedBuffer: string
    asSource: boolean
    configOrder: string // 用字符串存储,方便输入
    tubeNumber: string // 管号,最多5个字符
  }>({  
    name: '',
    targetVolume: 0,
    targetVolumeUnit: 'μL',
    substances: [],
    selectedBuffer: '',
    asSource: false,
    configOrder: '',
    tubeNumber: ''
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
            // 使用 totalVolume（首次创建体积）作为初始体积，而非 remainingVolume（当前剩余体积）
            initialVolumeMap.set(tube.id, whTube.totalVolume)
            isInWarehouseMap.set(tube.id, true)
          }
        }
      })

      let newNodes = currentTubes.map(tube => {
        // 过滤缓冲液
        if (tube.type === 'buffer' && !showBuffers) {
          return null
        }

        // 优先使用保存的位置,其次使用现有节点位置,最后使用随机位置
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

  // 点击连接线标签
  const handleEdgeClick = useCallback((edgeId: string, volume: number, volumeUnit: string) => {
    setEditingEdge({ id: edgeId, volume, volumeUnit })
  }, [])

  // 删除连接线
  const handleDeleteEdge = useCallback(() => {
    if (!editingEdge) return
    if (!confirm(language === 'zh' ? '确定删除这条连接线?' : 'Delete this connection?')) return
    removeConnection(editingEdge.id)
    setEdges(eds => eds.filter(e => e.id !== editingEdge.id))
    setEditingEdge(null)
  }, [editingEdge, removeConnection, setEdges])

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
          type: 'transfer', // 使用自定义可拖动标签边
          animated: true,
          style: { stroke: '#4f46e5', strokeWidth: 3 },
          data: {
            volume: conn.volume,
            volumeUnit: conn.volumeUnit,
            labelPosition: conn.labelPosition ?? 0.5,
            onUpdateLabelPosition: handleUpdateLabelPosition,
            onEdgeClick: handleEdgeClick
          }
        }
      }).filter(Boolean) as Edge[]

      setEdges(newEdges)
    }
  }, [connections, showBuffers, currentTubes, handleUpdateLabelPosition, handleEdgeClick])

  // 连接
  const onConnect = useCallback((connection: Connection) => {
    if (isReadOnly) return

    const newEdge: Edge = {
      ...connection,
      id: crypto.randomUUID(),
      type: 'transfer',
      animated: true,
      style: { stroke: '#4f46e5', strokeWidth: 3 },
      data: { volume: 0, volumeUnit: 'μL', labelPosition: 0.5, onUpdateLabelPosition: handleUpdateLabelPosition, onEdgeClick: handleEdgeClick }
    }

    setEdges(eds => addEdge(newEdge, eds) as Edge[])

    addConnection({
      fromTubeId: connection.source!,
      toTubeId: connection.target!,
      volume: 0,
      volumeUnit: 'μL'
    })
  }, [addConnection, isReadOnly])

  // 点击边修改体积(已隐藏输入框,保留代码供后续使用)
  // const onEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
  //   if (isReadOnly) return
  //   event.stopPropagation()
  //   const currentVolume = edge.data?.volume || 0
  //   const volume = prompt('请输入移液体积 (μL):', String(currentVolume))
  //   if (volume !== null) {
  //     const vol = parseFloat(volume) || 0
  //     setEdges(eds => eds.map(e =>
  //       e.id === edge.id
  //         ? { ...e, label: `${vol} μL`, data: { ...e.data, volume: vol } }
  //         : e
  //     ))
  //     updateConnection(edge.id, { volume: vol })
  //     setTimeout(() => recalculateTargetTube(edge.target as string), 100)
  //   }
  // }, [updateConnection, isReadOnly])
  const onEdgeDoubleClick = useCallback(() => {
    // 双击不弹出输入框,保留数字显示和拖动功能
  }, [])

  // 浓度单位转μM的因子
  const concToUM: Record<string, number> = { 'nM': 0.001, 'μM': 1, 'mM': 1000, 'M': 1000000 }

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
        const concInUM = sub.concentration * (concToUM[sub.concentrationUnit] || 1)
        const moles = concInUM * vol
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
      const finalConcUM = data.moles / totalVolume
      const factor = concToUM[data.unit as string] || 1
      newSubstances.push({
        name,
        concentration: Math.round((finalConcUM / factor) * 1000) / 1000,
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

    // 如果试管数据中没有,尝试从现有连接中提取
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
      asSource: tube.asSource || false,
      configOrder: tube.configOrder ? String(tube.configOrder) : '',
      tubeNumber: tube.tubeNumber || ''
    })
  }, [connections, currentTubes])

  // 保存试管编辑(同时自动计算)
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
      alert(`${language === 'zh' ? '试管名称' : 'Tube name'} "${trimmedName}" ${language === 'zh' ? '已存在,请使用其他名称' : 'already exists, please use another name'}`)
      return
    }

    // 保存试管修改
    // 注意:
    // 1. 原料试管的 remainingVolume 不应该被修改,它来自仓库
    // 2. 中间产物试管的 remainingVolume 由连接决定,不是目标体积
    // 3. 上样试管和耗损试管的 volume 就是目标体积

    if (editingTube.type === 'sample' || editingTube.type === 'waste') {
      // 上样试管或耗损试管:更新体积,并更新连接线的体积
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

    const configOrderNum = editFormData.configOrder ? parseInt(editFormData.configOrder, 10) : undefined
    if (editFormData.configOrder && (isNaN(configOrderNum!) || configOrderNum! <= 0)) {
      alert('配置序号必须是正整数')
      return
    }

    // 处理管号:去掉首尾空格,如果非空且不以#开头则自动加#
    let tubeNumber = editFormData.tubeNumber.trim()
    if (tubeNumber.length > 5) {
      alert('管号最多5个字符')
      return
    }
    if (tubeNumber && !tubeNumber.startsWith('#')) {
      tubeNumber = '#' + tubeNumber
    }
    if (tubeNumber && tubeNumber.length > 5) {
      alert('管号最多5个字符(含#)')
      return
    }

    // 同步名称:如果启用且有管号,自动设置名称为 日期-管号
    let finalName = trimmedName
    if (syncTubeName && tubeNumber && editingTube.type === 'intermediate') {
      finalName = `${experimentDate}-${tubeNumber}`
    }

    const updates: Partial<Tube> = {
      name: finalName,
      totalVolume: editFormData.targetVolume,
      totalVolumeUnit: editFormData.targetVolumeUnit,
      substances: editFormData.substances,
      selectedBuffer: editFormData.selectedBuffer,
      asSource: editFormData.asSource,
      configOrder: configOrderNum,
      tubeNumber: tubeNumber || undefined
    }

    updateTubeInExperiment(editingTube.id, updates)

    // 如果是中间产物试管且有物质设置,自动计算移液体积
    if (editingTube.type === 'intermediate' && editFormData.substances.length > 0) {
      const incomingConns = connections.filter(c => c.toTubeId === editingTube.id)
      if (incomingConns.length > 0) {
        // 执行自动计算(静默模式,不弹窗)
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

    // 按源试管分组,计算每个源试管需要的移液体积
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

        // 标准化浓度到μM再计算
        const targetConcUM = targetSub.concentration * (concToUM[targetSub.concentrationUnit] || 1)
        const sourceConcUM = sourceSub.concentration * (concToUM[sourceSub.concentrationUnit] || 1)
        const requiredVolume = (targetConcUM * targetVolume) / sourceConcUM
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
      if (!silent) alert(`${language === 'zh' ? '以下物质找不到源试管:' : 'Cannot find source for:'} ${missingSubstances.join(', ')}\n${language === 'zh' ? '请确保已从包含这些物质的试管连线到此试管。' : 'Make sure to connect from tubes containing these substances.'}`)
      return false
    }

    if (sourceTubeVolumes.size === 0) {
      if (!silent) alert(language === 'zh' ? '没有可计算的物质,请先添加目标物质浓度' : 'No substances to calculate, please add target substance concentrations first')
      return false
    }

    let totalSubstanceVolume = 0
    sourceTubeVolumes.forEach(vol => totalSubstanceVolume += vol)

    if (totalSubstanceVolume > targetVolume) {
      if (!silent) alert(`${language === 'zh' ? '源试管总体积' : 'Source volume'} (${totalSubstanceVolume.toFixed(1)} μL) ${language === 'zh' ? '超过目标体积' : 'exceeds target'} (${targetVolume} μL)!\n${language === 'zh' ? '请降低目标物质浓度或增加目标体积。' : 'Please reduce target concentration or increase target volume.'}`)
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

        // 删除其他类型的缓冲液连接(切换了缓冲液类型)
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
      // 不需要缓冲液,删除所有现有的缓冲液连接
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
      alert(`${language === 'zh' ? '计算完成!' : 'Calculation complete!'}\n${language === 'zh' ? '源试管总体积:' : 'Source volume:'} ${totalSubstanceVolume.toFixed(1)} μL\n${language === 'zh' ? '缓冲液体积:' : 'Buffer volume:'} ${targetVolume > totalSubstanceVolume ? (targetVolume - totalSubstanceVolume).toFixed(1) : 0} μL`)
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

    // 然后执行计算(带提示)
    performAutoCalculate(false)
    // 不关闭详情窗口
  }

  // 从仓库添加试管
  const handleAddFromWarehouse = (tube: Tube) => {
    if (isReadOnly) return

    // 如果是中间产物从仓库添加,设置 asSource = true
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
    const baseName = `${language === 'zh' ? '上样' : 'Sample'} ${sampleCount}`
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
    const baseName = `${language === 'zh' ? '耗损' : 'Waste'} ${wasteCount}`
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
    alert('实验已保存!')
  }

  // 另存为
  const handleSaveAs = async () => {
    if (!saveAsName.trim()) {
      alert(t('alert.enterNewName', language))
      return
    }
    await saveAsExperiment(saveAsName)
    setShowSaveAs(false)
    setSaveAsName('')
    alert(t('alert.savedAs', language) + saveAsName)
  }

  // 创建耗损实验
  const handleCreateWasteExperiment = async () => {
    if (!experimentName.trim()) {
      alert(t('alert.enterName', language))
      return
    }

    await createNewExperiment(experimentName, language === 'zh' ? '耗损实验' : 'Waste Experiment')

    // 创建默认的耗损试管
    const wasteTube: Tube = {
      id: crypto.randomUUID(),
      name: language === 'zh' ? '耗损' : 'Waste',
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
    const tube = currentTubes.find(t => t.id === tubeId)
    const isSource = tube?.type === 'source'
    const msg = isSource
      ? language === 'zh' ? '确定从当前工程中移除这个原料试管?\n\n注意:仅从当前工程移除,不会删除仓库中的试剂。' : 'Remove this source tube from current project?\n\nNote: Only removed from project, not from warehouse.'
      : t('alert.confirmDelete', language)
    if (!confirm(msg)) return

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

    if (confirm(t('alert.confirmEnd', language))) {
      await completeExperiment()
      alert(t('alert.experimentSaved', language))
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
    if (confirm(language === 'zh' ? '确定删除这个实验?此操作不可恢复。' : 'Delete this experiment? This cannot be undone.')) {
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
      {/* 页面标题 */}
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('nav.experiment', language)}</h1>
      </div>

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
                {/* === 添加区 === */}
                <div className={styles.toolbarSection}>
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

                  <button className={styles.toolbarBtn} onClick={() => setShowTubeSelector(true)}>
                    {t('toolbar.addFromWarehouse', language)}
                  </button>

                  <button className={styles.toolbarBtn} onClick={handleCreateIntermediate}>
                    {t('toolbar.newTube', language)}
                  </button>

                  <button className={styles.toolbarBtn} onClick={handleCreateSample}>
                    {t('toolbar.newSample', language)}
                  </button>

                  <button className={styles.toolbarBtn} onClick={handleCreateWaste}>
                    {t('toolbar.newWasteTube', language)}
                  </button>
                </div>

                <div className={styles.toolbarDivider} />

                {/* === 操作区 === */}
                <div className={styles.toolbarSection}>
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
                    <label className={styles.quickNamingLabel}>
                      <input
                        type="checkbox"
                        checked={syncTubeName}
                        onChange={(e) => setSyncTubeName(e.target.checked)}
                      />
                      {language === 'zh' ? '同步名称' : 'Sync Name'}
                    </label>
                  </div>

                  <button className={styles.toolbarBtn} onClick={handleCheckExperiment}>
                    🔍 {t('toolbar.check', language)}
                  </button>

                  <button className={styles.toolbarBtn} onClick={handleClearConfigOrders}>
                    🧹 {language === 'zh' ? '清空序号' : 'Clear Orders'}
                  </button>

                  <button className={styles.toolbarBtnAccent} onClick={handleCompleteExperiment}>
                    {t('toolbar.endExperiment', language)}
                  </button>

                  <button className={styles.toolbarBtn} onClick={handleRefreshExperiment}>
                    🔄 {t('toolbar.refresh', language)}
                  </button>
                </div>

                <div className={styles.toolbarDivider} />
              </>
            )}

            {/* === 工程区 === */}
            <div className={styles.toolbarSection}>
              <button className={styles.toolbarBtn} onClick={() => setShowExperimentManager(true)}>
                📁 {t('toolbar.open', language)}
              </button>

              <button className={styles.toolbarBtn} onClick={() => {
                resetExperiment()
                setNodes([])
                setEdges([])
              }}>
                {t('toolbar.newExperiment', language)}
              </button>

              <button className={styles.toolbarBtnWarn} onClick={handleCreateWasteExperiment}>
                {t('toolbar.newWaste', language)}
              </button>

              {currentExperiment && (
                <button className={styles.toolbarBtn} onClick={() => setShowSaveAs(true)}>
                  📄 {t('toolbar.saveAs', language)}
                </button>
              )}

              {!isReadOnly && (
                <button className={styles.toolbarBtn} onClick={handleSaveExperiment}>
                  💾 {t('toolbar.save', language)}
                </button>
              )}
            </div>
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
            edgeTypes={edgeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
          >
            <Background />
            <Controls />
            <MiniMap />
            <Panel position="top-right">
              <div className={styles.helpPanel}>
                <p>💡 {language === 'zh' ? '操作提示:' : 'Tips:'}</p>
                <ul>
                  <li>{language === 'zh' ? '拖拽试管移动位置' : 'Drag tubes to move'}</li>
                  <li>{language === 'zh' ? '从右侧圆点拖出连线' : 'Drag from right handle to connect'}</li>
                  <li><strong>{language === 'zh' ? '双击连线数字修改体积' : 'Double-click edge to edit volume'}</strong></li>
                  <li>{language === 'zh' ? '点击试管查看/编辑参数' : 'Click tube to view/edit'}</li>
                  <li><strong>{language === 'zh' ? '选中后按 Delete 删除' : 'Select + Delete to remove'}</strong></li>
                </ul>
                {isReadOnly && (
                  <p className={styles.readOnlyHint}>🔒 {currentExperiment?.status === 'reverted' ? (language === 'zh' ? '此实验已回退,无法修改' : 'Experiment reverted, read only') : (language === 'zh' ? '此实验已结束,无法修改' : 'Experiment ended, read only')}</p>
                )}
              </div>
            </Panel>
          </ReactFlow>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🔬</div>
            <p>{language === 'zh' ? '创建一个新实验开始模拟' : 'Create a new experiment to start'}</p>
            <p className={styles.emptyHint}>{language === 'zh' ? '或点击"打开工程"继续之前的实验' : 'Or click "Open" to continue previous experiments'}</p>
          </div>
        )}
      </div>

      {/* 工程管理弹窗 */}
      {showExperimentManager && (
        <div className={styles.modal} onClick={() => { setShowExperimentManager(false); setExperimentSearch('') }}>
          <div className={styles.modalContentWide} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{t('modal.projectManagement', language)}</h2>

            <input
              type="text"
              className={styles.searchInput}
              placeholder={language === 'zh' ? '🔍 搜索工程名称...' : '🔍 Search project name...'}
              value={experimentSearch}
              onChange={e => setExperimentSearch(e.target.value)}
              autoFocus
            />

            <div className={styles.experimentList}>
              {(() => {
                const filtered = experimentSearch.trim()
                  ? experiments.filter(exp => exp.name.toLowerCase().includes(experimentSearch.trim().toLowerCase()))
                  : experiments
                if (filtered.length === 0) {
                  return <div className={styles.emptyHint}>{experimentSearch.trim() ? (language === 'zh' ? '没有匹配的工程' : 'No matching projects') : (language === 'zh' ? '暂无保存的工程' : 'No saved projects')}</div>
                }
                return filtered.map(exp => (
                  <div key={exp.id} className={styles.experimentItem}>
                    <div className={styles.experimentItemInfo}>
                      <h3>
                        {exp.name}
                        {exp.isWaste && <span className={styles.wasteTag}>{t('waste.tag', language)}</span>}
                      </h3>
                      <div className={styles.experimentItemMeta}>
                        <span className={`${styles.statusTag} ${styles[exp.status]}`}>
                          {exp.status === 'draft' ? t('status.draft', language) :
                           exp.status === 'completed' ? t('status.completed', language) : t('status.reverted', language)}
                        </span>
                        <span>{new Date(exp.updatedAt).toLocaleString('zh-CN')}</span>
                        <span>{exp.tubes?.length || 0} {language === 'zh' ? '个试管' : 'tubes'}</span>
                      </div>
                    </div>
                    <div className={styles.experimentItemActions}>
                      <button onClick={() => handleOpenExperiment(exp.id)}>
                        {language === 'zh' ? '打开' : 'Open'}
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDeleteExperiment(exp.id)}
                      >
                        {language === 'zh' ? '删除' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))
              })()}
            </div>

            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={() => { setShowExperimentManager(false); setExperimentSearch('') }}>
                {language === 'zh' ? '关闭' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 另存为弹窗 */}
      {showSaveAs && (
        <div className={styles.modal} onClick={() => setShowSaveAs(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h3>{t('modal.saveAs', language)}</h3>
            <input
              type="text"
              placeholder={language === 'zh' ? '输入新工程名称...' : 'Enter new project name...'}
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              autoFocus
            />
            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={() => setShowSaveAs(false)}>
                {t('tubeDetail.cancel', language)}
              </button>
              <button className={styles.submitBtn} onClick={handleSaveAs}>
                {t('tubeDetail.save', language)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 试管选择器 */}
      {showTubeSelector && (
        <div className={styles.modal} onClick={() => setShowTubeSelector(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h3>{t('modal.selectTube', language)}</h3>
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
                <p className={styles.emptyHint}>{language === 'zh' ? '仓库中没有可用试剂' : 'No available reagents in warehouse'}</p>
              )}
            </div>
            <button className={styles.closeBtn} onClick={() => setShowTubeSelector(false)}>
              {t('tubeDetail.close', language)}
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
                🔍 {t('tubeDetail.trace', language)}
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
            {isReadOnly && editingTube.type === 'intermediate' && editingTube.tubeNumber && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{language === 'zh' ? '管号' : 'Tube Number'}</label>
                <div className={styles.readOnlyValue}>{editingTube.tubeNumber}</div>
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
                    <label>{t('tubeDetail.targetVolume', language)}</label>
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
                    <label>{t('tubeDetail.unit', language)}</label>
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
                      <label>{t('tubeDetail.substanceConcentration', language)}</label>
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
                              placeholder={t('tubeDetail.substanceName', language)}
                            />
                            <input
                              type="number"
                              value={sub.concentration || ''}
                              onChange={(e) => {
                                const newSubs = [...editFormData.substances]
                                newSubs[i].concentration = Number(e.target.value)
                                setEditFormData({ ...editFormData, substances: newSubs })
                              }}
                              placeholder={t('tubeDetail.concentration', language)}
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
                        {t('tubeDetail.addSubstance', language)}
                      </button>
                    </div>

                    <div className={styles.formGroup}>
                      <label>{t('tubeDetail.bufferFill', language)}</label>
                      <select
                        value={editFormData.selectedBuffer}
                        onChange={(e) => setEditFormData({ ...editFormData, selectedBuffer: e.target.value })}
                      >
                        <option value="">{t('tubeDetail.noBuffer', language)}</option>
                        {bufferTubes.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      {bufferTubes.length === 0 && (
                        <p className={styles.hint}>{t('tubeDetail.createBufferHint', language)}</p>
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
                          {t('tubeDetail.asSource', language)}
                        </label>
                        <p className={styles.hint}>{t('tubeDetail.asSourceHint', language)}</p>
                      </div>
                    )}

                    {/* 配置序号 - 中间产物试管显示 */}
                    {editingTube.type === 'intermediate' && !editFormData.asSource && (
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>{language === 'zh' ? '配置序号' : 'Config Order'}</label>
                        <input
                          type="number"
                          className={styles.formInput}
                          value={editFormData.configOrder}
                          onChange={(e) => setEditFormData({ ...editFormData, configOrder: e.target.value })}
                          placeholder={language === 'zh' ? '正整数,用于讲述者排序' : 'Positive integer for narrator ordering'}
                          min="1"
                          step="1"
                          disabled={isReadOnly}
                        />
                        <p className={styles.hint}>{language === 'zh' ? '按序号从小到大生成实验步骤(讲述者功能)' : 'Generate experiment steps in order (Narrator feature)'}</p>
                      </div>
                    )}

                    {/* 管号 - 中间产物且非作为原料的试管显示 */}
                    {editingTube.type === 'intermediate' && !editFormData.asSource && !isReadOnly && (
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>{language === 'zh' ? '管号' : 'Tube Number'}</label>
                        <input
                          type="text"
                          className={styles.formInput}
                          value={editFormData.tubeNumber}
                          onChange={(e) => setEditFormData({ ...editFormData, tubeNumber: e.target.value })}
                          placeholder="#1 (max 5 chars)"
                          maxLength={5}
                        />
                        <p className={styles.hint}>{language === 'zh' ? '管号仅存储在当前实验工程中,默认以#开头' : 'Tube number is stored in project only, starts with #'}</p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            <div className={styles.formActions}>
              {!isReadOnly && (
                <button
                  className={styles.deleteTubeBtn}
                  onClick={() => handleDeleteTube(editingTube.id)}
                >
                  🗑️ {editingTube.type === 'source' ? (language === 'zh' ? '移除试管' : 'Remove Tube') : t('tubeDetail.deleteTube', language)}
                </button>
              )}
              <button className={styles.cancelBtn} onClick={() => setEditingTube(null)}>
                {isReadOnly ? t('tubeDetail.close', language) : t('tubeDetail.cancel', language)}
              </button>
              {editingTube.type === 'intermediate' && !isReadOnly && (
                <button className={styles.calcBtn} onClick={handleAutoCalculate}>
                  {t('tubeDetail.autoCalculate', language)}
                </button>
              )}
              {!isReadOnly && (
                <button className={styles.submitBtn} onClick={handleSaveTubeEdit}>
                  {t('tubeDetail.save', language)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 连接线编辑弹窗 */}
      {editingEdge && (
        <div className={styles.modal} onClick={() => setEditingEdge(null)}>
          <div className={styles.editModalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>{language === 'zh' ? '移液连接线' : 'Transfer Connection'}</h3>
            </div>

            <div className={styles.formGroup}>
              <label>{language === 'zh' ? '移液体积' : 'Transfer Volume'}</label>
              <div className={styles.formRow}>
                <input
                  type="number"
                  value={editingEdge.volume}
                  disabled
                  style={{ opacity: 0.6, cursor: 'not-allowed' }}
                />
                <select value={editingEdge.volumeUnit} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                  <option value="nL">nL</option>
                  <option value="μL">μL</option>
                  <option value="mL">mL</option>
                </select>
              </div>
              <p className={styles.hint}>{language === 'zh' ? '体积编辑功能暂未开放' : 'Volume editing not yet available'}</p>
            </div>

            <div className={styles.formActions}>
              {!isReadOnly && (
                <button className={styles.deleteTubeBtn} onClick={handleDeleteEdge}>
                  🗑️ {language === 'zh' ? '删除连线' : 'Delete Connection'}
                </button>
              )}
              <button className={styles.cancelBtn} onClick={() => setEditingEdge(null)}>
                {t('tubeDetail.cancel', language)}
              </button>
              <button className={styles.submitBtn} onClick={() => setEditingEdge(null)} disabled>
                {t('tubeDetail.save', language)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 检查结果侧边面板 - 非模态,可同时操作工程 */}
      {showCheckResult && (
        <div className={styles.checkResultPanel}>
          <div className={styles.panelHeader}>
            <h3>🔍 {t('check.title', language)} {checkErrors.length > 0 && `(${checkErrors.length}${t('check.problems', language)})`}</h3>
            <div className={styles.panelActions}>
              <button className={styles.recheckBtn} onClick={handleCheckExperiment}>
                {t('check.recheck', language)}
              </button>
              <button className={styles.closeResultBtn} onClick={() => setShowCheckResult(false)}>
                ✕
              </button>
            </div>
          </div>

          <div className={styles.panelContent}>
            {checkErrors.length === 0 ? (
              <div className={styles.checkSuccess}>
                {t('check.noErrors', language)}
              </div>
            ) : (
              <div className={styles.checkErrors}>
                <ul className={styles.errorList}>
                  {checkErrors.map((error, index) => (
                    <li key={index} className={styles.errorItem}>
                      <span className={styles.errorTube}>{error.tubeName}</span>
                      <span className={styles.errorType}>
                        {error.type === 'volume_exceed' && t('error.volumeExceed', language)}
                        {error.type === 'buffer_missing' && t('error.bufferMissing', language)}
                        {error.type === 'substance_source_missing' && t('error.substanceSourceMissing', language)}
                        {error.type === 'calculation_error' && t('error.calculationError', language)}
                        {error.type === 'zero_concentration' && t('error.zeroConcentration', language)}
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
