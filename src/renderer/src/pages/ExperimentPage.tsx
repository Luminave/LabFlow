import { useState, useCallback, useEffect, useRef } from 'react'
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
  useReactFlow,
  NodeTypes,
  EdgeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useWarehouseStore } from '../stores/warehouseStore'
import { getProjectFileInfo, useExperimentStore } from '../stores/experimentStore'
import {
  ProjectFileConflictError,
  isProjectFileAvailable,
  reloadProjectSource,
  statProjectSource
} from '../utils/projectSource'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import { Tube, Substance, ConcentrationUnit, VolumeUnit, TransferConnection } from '@shared/types'
import { roundVolume } from '@shared/utils/calculations'
import { computeEndState } from '@/core/endState'
import { concentrationText, singleText } from '../utils/tubeNodeText'
import { formatLockBanner, type ParsedAgentLock } from '@/core/lock'
import { computeMixture, sourcesIntoTube, solveRequiredVolumes } from '@/core/mix'
import { validateExperiment } from '@/core/validate'
import { formatCheckIssues } from './experimentCheckMessages'
import { projectInputFromExperiment } from '@/core/exporters'
import { describeExportOutcome, runProjectExport } from '../utils/projectExport'
import { setBoardCaptureSource } from '../utils/boardCapture'
import TubeNode from '../components/TubeNode'
import TransferEdge from '../components/TransferEdge'
import styles from './ExperimentPage.module.css'

/** 把看板的 fitView 登记给导出流程用（导出图片时要先让整张图进视野再截图） */
function BoardCaptureBridge({ experimentId }: { experimentId: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    setBoardCaptureSource({
      experimentId,
      fitView: async () => {
        await fitView({ padding: 0.12, duration: 0 })
      }
    })
    return () => setBoardCaptureSource(null)
  }, [experimentId, fitView])
  return null
}

const nodeTypes: NodeTypes = { tube: TubeNode }
const edgeTypes: EdgeTypes = { transfer: TransferEdge }

// 聚焦时自动选中全部文本，方便快速替换
const selectOnFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.select()

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
    reloadExperimentFromFile,
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
  // 动态计算结束状态（内核：统一「查仓库」口径）
  const calculateEndStateDynamic = (tubes: Tube[], conns: TransferConnection[]): Tube[] => {
    return computeEndState({ tubes, connections: conns, warehouseTubes })
  }

  // 是否为只读模式(已完成的实验)
  const isReadOnly = currentExperiment?.status === 'completed' || currentExperiment?.status === 'reverted'

  // 保存 / 导出的轻提示（不弹窗，2.6 秒自己消失）
  const [saveToast, setSaveToast] = useState<{ text: string; key: number } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const showSaveToast = useCallback((text: string) => {
    setSaveToast({ text, key: Date.now() })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setSaveToast(null), 2600)
  }, [])

  // —— 工程正本（工程/<工程名>.yml）被外部修改的检测与提示 ——
  const [fileChanged, setFileChanged] = useState(false)

  // 主进程发现「当前工程文件被外部改了」且界面有未保存改动 → 只挂提示条，不覆盖
  useEffect(() => {
    const onExternalChange = () => setFileChanged(true)
    window.addEventListener('labflow:projectFileChanged', onExternalChange)
    return () => window.removeEventListener('labflow:projectFileChanged', onExternalChange)
  }, [])

  /** 用文件里的内容覆盖当前工程 */
  const reloadFromFile = useCallback(async () => {
    const current = useExperimentStore.getState().currentExperiment
    if (!current) return
    const ok = await reloadExperimentFromFile(current.id)
    setFileChanged(false)
    showSaveToast(
      ok
        ? language === 'zh' ? '已重新载入工程文件' : 'Reloaded from project file'
        : language === 'zh' ? '读不到工程文件' : 'Project file not readable'
    )
  }, [reloadExperimentFromFile, showSaveToast, language])

  /** 窗口获得焦点时看一眼：文件 mtime/size 变了就在顶栏挂提示条（不弹窗） */
  useEffect(() => {
    if (!isProjectFileAvailable()) return
    const check = async () => {
      const current = useExperimentStore.getState().currentExperiment
      if (!current) return
      const info = getProjectFileInfo(current.id)
      if (!info?.stat) return
      const stat = await statProjectSource(info.fileName)
      if (!stat) return
      const changed =
        Math.abs(stat.mtimeMs - info.stat.mtimeMs) > 1 || stat.size !== info.stat.size
      if (changed) setFileChanged(true)
    }
    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // —— Agent 锁（第 2 步）——
  const [agentLock, setAgentLock] = useState<ParsedAgentLock>(null)
  const [lockNow, setLockNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const apply = (payload: ParsedAgentLock) => {
      if (alive) setAgentLock(payload ?? null)
    }
    window.electronAPI?.getAgentLock?.().then(apply).catch(() => {})
    const unsubscribe = window.electronAPI?.onAgentLockChanged?.(apply)
    // 「已 X 分钟」要自己往前走，30 秒刷新一次
    const timer = window.setInterval(() => setLockNow(Date.now()), 30000)
    return () => {
      alive = false
      unsubscribe?.()
      window.clearInterval(timer)
    }
  }, [])

  const rawLockBanner = formatLockBanner(
    agentLock,
    { name: currentExperiment?.name, id: currentExperiment?.id },
    lockNow
  )
  // 没打开工程时不必提示「别的工程被锁」，只有本工程被锁才一定提示
  const lockBanner = rawLockBanner && rawLockBanner.level === 'other' && !currentExperiment ? null : rawLockBanner
  const frozenByAgent = Boolean(lockBanner?.freeze) && !isReadOnly

  const forceReleaseLock = useCallback(async () => {
    const ok = window.confirm('Agent 可能仍在写文件，强制解锁可能导致冲突，确定吗？')
    if (!ok) return
    const result = await window.electronAPI?.forceReleaseAgentLock?.()
    if (result?.ok) {
      setAgentLock(null)
      showSaveToast(language === 'zh' ? '已强制解锁' : 'Lock released')
    } else {
      showSaveToast(language === 'zh' ? '解锁失败：' + (result?.error || '未知错误') : 'Failed to release lock')
    }
  }, [showSaveToast, language])

  // 检查实验问题
  // 检查实验问题（内核校验 + UI 文案）
  const handleCheckExperiment = () => {
    const issues = validateExperiment({
      tubes: currentTubes,
      connections,
      warehouseTubes,
      defaultBuffer: currentExperiment?.defaultBuffer
    })
    setCheckErrors(formatCheckIssues(issues, currentTubes, language))
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

    // 逐个更新试管（会同时更新 store 和 localStorage）
    for (const tube of newTubes) {
      updateTubeInExperiment(tube.id, {
        remainingVolume: tube.remainingVolume,
        remainingVolumeUnit: tube.remainingVolumeUnit,
        substances: tube.substances,
        updatedAt: tube.updatedAt
      })
    }
    
    // 立即保存到数据库（不等防抖）
    saveCurrentExperiment()
    
    alert(language === 'zh' ? '工程已刷新！' : 'Project refreshed!')
  }
  useEffect(() => {
    fetchExperiments()
    fetchTubes()
    loadSavedExperiment()
  }, [fetchExperiments, fetchTubes, loadSavedExperiment])

  // 组件卸载时自动保存，防止未保存的数据丢失
  useEffect(() => {
    return () => {
      const { currentExperiment, currentTubes, connections, tubePositions } = useExperimentStore.getState()
      if (currentExperiment) {
        try {
          // 1. 保存到 localStorage（同步，立即生效）
          localStorage.setItem('labflow_current_experiment', JSON.stringify({
            currentExperiment,
            currentTubes,
            connections,
            tubePositions
          }))
          
          // 2. 保存到数据库（同步发起，不等待完成）
          if (window.electronAPI) {
            const experimentForDb = {
              ...currentExperiment,
              tubes: currentTubes,
              tubePositions,
              connections,
              updatedAt: new Date().toISOString()
            }
            window.electronAPI.saveExperiment({
              id: experimentForDb.id,
              name: experimentForDb.name,
              description: experimentForDb.description || null,
              created_at: experimentForDb.createdAt,
              updated_at: experimentForDb.updatedAt,
              completed_at: experimentForDb.completedAt || null,
              status: experimentForDb.status,
              tubes: JSON.stringify(experimentForDb.tubes),
              tube_positions: JSON.stringify(experimentForDb.tubePositions || []),
              connections: JSON.stringify(experimentForDb.connections),
              warehouse_snapshot: experimentForDb.warehouseSnapshot ? JSON.stringify(experimentForDb.warehouseSnapshot) : null,
              initial_state_tubes: experimentForDb.initialStateTubes ? JSON.stringify(experimentForDb.initialStateTubes) : null,
              end_state_tubes: experimentForDb.endStateTubes ? JSON.stringify(experimentForDb.endStateTubes) : null,
              is_waste: experimentForDb.isWaste ? 1 : 0
            }).catch((e: any) => console.error('Failed to save on unmount:', e))
          }
        } catch (e) {
          console.error('Failed to save on unmount:', e)
        }
      }
    }
  }, [])

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

  // 表单错误提示（替代 alert，避免阻塞 JS 线程导致输入框卡死）
  const [formError, setFormError] = useState<string | null>(null)

  // 用户修改表单时自动清除错误提示
  useEffect(() => {
    if (formError) setFormError(null)
  }, [editFormData.name, editFormData.targetVolume, editFormData.configOrder, editFormData.tubeNumber])

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
            isInWarehouse: isInWarehouseMap.get(tube.id),
            // 源试管的两格体积都取仓库正本（仓库.yml → warehouseStore）
            warehouseTotalVolume: warehouseTubes.find(t => t.id === tube.id)?.totalVolume,
            warehouseRemainingVolume: warehouseTubes.find(t => t.id === tube.id)?.remainingVolume,
            isReadOnly,
            onUpdateTube: handleInlineUpdate,
            onOpenDetail: handleOpenDetail
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


  // 计算目标试管的物质组成
  // 计算目标试管的物质组成（内核：先归一到 μM·μL 再算）
  const recalculateTargetTube = (targetId: string) => {
    const sources = sourcesIntoTube(connections, currentTubes, targetId)
    const newSubstances = computeMixture(sources, { unitMode: 'first', decimals: 3 }) as Substance[]
    const totalVolume = sources.reduce((sum, s) => sum + s.volume, 0)

    updateTubeInExperiment(targetId, {
      substances: newSubstances,
      totalVolume,
      remainingVolume: totalVolume
    })
  }

  // 点击试管
  // 打开试管详情弹窗(由卡片上的 ... 按钮触发)
  const handleOpenDetail = useCallback((tube: Tube) => {
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
    setFormError(null)
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
      setFormError(language === 'zh' ? '试管名称不能为空' : 'Tube name cannot be empty')
      return
    }

    const duplicateName = currentTubes.find(t =>
      t.id !== editingTube.id && t.name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicateName) {
      setFormError(`${language === 'zh' ? '试管名称' : 'Tube name'} "${trimmedName}" ${language === 'zh' ? '已存在，请使用其他名称' : 'already exists, please use another name'}`)
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
      setFormError(language === 'zh' ? '配置序号必须是正整数' : 'Config order must be a positive integer')
      return
    }

    // 处理管号:去掉首尾空格,如果非空且不以#开头则自动加#
    let tubeNumber = editFormData.tubeNumber.trim()
    if (tubeNumber.length > 5) {
      setFormError(language === 'zh' ? '管号最多5个字符' : 'Tube number max 5 characters')
      return
    }
    if (tubeNumber && !tubeNumber.startsWith('#')) {
      tubeNumber = '#' + tubeNumber
    }
    if (tubeNumber && tubeNumber.length > 5) {
      setFormError(language === 'zh' ? '管号最多5个字符(含#)' : 'Tube number max 5 characters (including #)')
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
  // 核心计算函数 - 参数化版本(模态框编辑和内联编辑共用)
  const calculateForTube = (tube: Tube, formData: { targetVolume: number; substances: Substance[]; selectedBuffer: string }, silent: boolean = false) => {
    // 从 store 获取最新数据，避免闭包中的旧数据
    const freshState = useExperimentStore.getState()
    const freshConnections = freshState.connections
    const freshCurrentTubes = freshState.currentTubes

    const incomingConns = freshConnections.filter(c => c.toTubeId === tube.id)
    if (incomingConns.length === 0) {
      if (!silent) alert('请先从源试管连线到此试管')
      return false
    }

    const targetVolume = formData.targetVolume

    // 按源试管分组,计算每个源试管需要的移液体积（内核：先归一到 μM 再反算）
    const { volumes: sourceTubeVolumes, missingSubstances } = solveRequiredVolumes({
      targetSubstances: formData.substances,
      targetVolume,
      sources: incomingConns.map(conn => {
        const sourceTube = freshCurrentTubes.find(t => t.id === conn.fromTubeId)
        return {
          tubeId: conn.fromTubeId,
          type: sourceTube ? sourceTube.type : ('source' as Tube['type']),
          substances: sourceTube ? sourceTube.substances : []
        }
      })
    })
    const hasMissingSource = missingSubstances.length > 0

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
    const existingBufferConns = freshConnections.filter(c =>
      c.toTubeId === tube.id &&
      freshCurrentTubes.find(t => t.id === c.fromTubeId)?.type === 'buffer'
    )

    // 计算需要的缓冲液体积
    const bufferVolume = targetVolume > totalSubstanceVolume ? targetVolume - totalSubstanceVolume : 0

    if (bufferVolume > 0 && formData.selectedBuffer) {
      // 需要缓冲液
      const bufferTemplate = warehouseTubes.find(t => t.id === formData.selectedBuffer)
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
          const bufferNodeId = `buffer-${bufferTemplate.id}-${tube.id}`

          const bufferTube: Tube = {
            ...bufferTemplate,
            id: bufferNodeId,
            name: bufferTemplate.name,
            type: 'buffer'
          }

          addBufferTube(bufferTube)

          addConnection({
            fromTubeId: bufferNodeId,
            toTubeId: tube.id,
            volume: bufferVolume,
            volumeUnit: 'μL'
          })

          const targetPosition = tubePositions.find(p => p.tubeId === tube.id) ||
            nodes.find(n => n.id === tube.id)?.position || { x: 200, y: 200 }
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

  // 模态框编辑的自动计算(兼容旧调用)
  const performAutoCalculate = (silent: boolean = false) => {
    if (!editingTube) return false
    return calculateForTube(editingTube, editFormData, silent)
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

  // 内联编辑更新 - 试管卡片上直接编辑后调用
  // 不用 useCallback,因为节点数据在 useEffect 中重建时会捕获最新函数
  const handleInlineUpdate = (tubeId: string, updates: Partial<Tube>, shouldCalculate?: boolean) => {
    if (isReadOnly) return

    // 从 store 获取最新数据，避免闭包中的旧数据
    const freshState = useExperimentStore.getState()
    const freshCurrentTubes = freshState.currentTubes
    const freshConnections = freshState.connections

    // 管号同步名称:如果启用 syncTubeName 且更新了管号,自动同步名称
    if (syncTubeName && updates.tubeNumber !== undefined) {
      const tube = freshCurrentTubes.find(t => t.id === tubeId)
      if (tube && tube.type === 'intermediate') {
        updates.name = `${experimentDate}-${updates.tubeNumber}`
      }
    }

    // 保存到 store
    updateTubeInExperiment(tubeId, updates)

    // 如果需要计算,构造 formData 并调用计算
    if (shouldCalculate) {
      const tube = freshCurrentTubes.find(t => t.id === tubeId)
      if (tube) {
        const mergedTube = { ...tube, ...updates }
        const formData = {
          targetVolume: mergedTube.totalVolume,
          substances: mergedTube.substances,
          selectedBuffer: mergedTube.selectedBuffer || ''
        }
        // 有物质且有连线时才计算
        if (formData.substances.length > 0) {
          const incomingConns = freshConnections.filter(c => c.toTubeId === tubeId)
          if (incomingConns.length > 0) {
            calculateForTube(mergedTube, formData, true)
          }
        }
      }
    }
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

  // 保存实验：存库成功后，按导出设置决定要不要顺手重新导出（主人 2026-11-22 要的）
  const handleSaveExperiment = async (options: { forceFile?: boolean } = {}) => {
    const zh = language === 'zh'
    let success: boolean | void

    try {
      success = await saveCurrentExperiment(undefined, options)
    } catch (error) {
      if (error instanceof ProjectFileConflictError) {
        // 文件被别人改过：绝不默默覆盖，先问主人（默认按钮是「重新载入」）
        const choice = await window.electronAPI?.dataRoot?.askConflict?.({
          projectName: error.fileName.replace(/.yml$/, ''),
          fileName: error.fileName
        })
        if (choice === 'reload') {
          await reloadFromFile()
          return
        }
        if (choice === 'overwrite') {
          await handleSaveExperiment({ forceFile: true })
          return
        }
        showSaveToast(zh ? '已取消保存（文件未改动）' : 'Save cancelled (file untouched)')
        return
      }
      throw error
    }


    if (success === false) {
      showSaveToast(
        zh ? '⚠️ 数据库保存失败，已保存到本地存储。请检查控制台日志。' : '⚠️ Database save failed, saved to local storage.'
      )
      return
    }

    // 保存成功后拿最新的 currentExperiment 去导出（store 里已经换成这份了）
    const saved = useExperimentStore.getState().currentExperiment
    if (!saved) {
      showSaveToast(zh ? '实验已保存' : 'Experiment saved')
      return
    }

    let settings = null
    try {
      settings = await window.electronAPI?.config?.getExportSettings?.()
    } catch {
      settings = null
    }

    if (!settings || !settings.autoExportOnSave) {
      showSaveToast(zh ? '实验已保存' : 'Experiment saved')
      return
    }

    // 派生件（SOP + 截图）写到数据正本的 导出/ 目录；白板与数据文件默认不导
    let exportDir = settings.directory
    try {
      const info = await window.electronAPI?.dataRoot?.getInfo?.()
      if (info?.ok && info.exportDir) exportDir = info.exportDir
    } catch {
      /* 拿不到目录信息就退回设置里的目录 */
    }

    const outcome = await runProjectExport({
      input: projectInputFromExperiment(saved),
      settings: {
        ...settings,
        directory: exportDir,
        autoSubfolder: false,
        exportCanvasFile: settings.exportCanvasFile === true,
        exportDataFile: false
      },
      auto: true
    })

    if (outcome.ok) {
      const base = zh ? `已保存并导出 ${outcome.count} 个文件` : `Saved and exported ${outcome.count} file(s)`
      showSaveToast(
        outcome.imageSkipped ? `${base}${zh ? '（流程图要在这根工程的白板上才能截图，这次没出图）' : ' (board screenshot skipped)'}` : base
      )
    } else if (outcome.skipped === 'no-directory') {
      showSaveToast(zh ? '实验已保存；未设置导出目录，未自动导出' : 'Saved; no export folder set — skipped exporting')
    } else if (outcome.skipped === 'busy') {
      showSaveToast(zh ? '实验已保存；上一次导出还没写完，已跳过' : 'Saved; previous export still running — skipped')
    } else {
      showSaveToast(`${zh ? '实验已保存，但导出失败：' : 'Saved, but export failed: '}${describeExportOutcome(outcome, zh ? 'zh' : 'en')}`)
    }
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
    const success = loadExperiment(id)
    setShowExperimentManager(false)
    if (!success) {
      alert(language === 'zh' ? '打开工程失败，数据可能已损坏。请尝试从备份恢复。' : 'Failed to open project, data may be corrupted. Please try restoring from backup.')
    }
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

      <header className={`${styles.toolbar} ${frozenByAgent ? styles.toolbarFrozen : ''}`}>
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
                <button className={styles.toolbarBtn} onClick={() => void handleSaveExperiment()}>
                  💾 {t('toolbar.save', language)}
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {fileChanged && (
        <div className={styles.fileChangedBanner} role="status">
          <span>
            ⚠️ {language === 'zh'
              ? `工程文件已被外部修改：${getProjectFileInfo(currentExperiment?.id || '')?.fileName || ''}`
              : `Project file changed outside LabFlow: ${getProjectFileInfo(currentExperiment?.id || '')?.fileName || ''}`}
          </span>
          <button className={styles.fileChangedBtn} onClick={() => void reloadFromFile()}>
            {language === 'zh' ? '重新载入' : 'Reload'}
          </button>
          <button className={styles.fileChangedBtnGhost} onClick={() => setFileChanged(false)}>
            {language === 'zh' ? '先不管' : 'Dismiss'}
          </button>
        </div>
      )}

      {isReadOnly && currentExperiment && (
        <div className={styles.readOnlyBanner}>
          <span>
            {language === 'zh'
              ? `🔒 这个工程已结束（${currentExperiment.completedAt ? currentExperiment.completedAt.slice(0, 10) : '已结束'}），只读查看`
              : '🔒 This experiment has ended — view only'}
          </span>
        </div>
      )}

      {lockBanner && (
        <div
          className={`${styles.agentLockBanner} ${lockBanner.level === 'stale' ? styles.agentLockStale : ''} ${
            lockBanner.level === 'other' || lockBanner.level === 'broken' ? styles.agentLockSoft : ''
          }`}
        >
          <span className={styles.agentLockText}>{lockBanner.text}</span>
          {lockBanner.level !== 'other' && (
            <button className={styles.agentLockBtn} onClick={() => void forceReleaseLock()}>
              {language === 'zh' ? '强制解锁' : 'Force release'}
            </button>
          )}
        </div>
      )}

      <div className={styles.canvas} data-labflow-board>
        {currentExperiment ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onEdgeDoubleClick={onEdgeDoubleClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            deleteKeyCode={null}
            selectionKeyCode={null}
            nodesDraggable={!frozenByAgent}
            nodesConnectable={!frozenByAgent}
            elementsSelectable={!frozenByAgent}
            onNodeContextMenu={event => { if (frozenByAgent) { event.preventDefault(); event.stopPropagation() } }}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
          >
            {currentExperiment && <BoardCaptureBridge experimentId={currentExperiment.id} />}
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
        <div className={styles.modal}>
          <div className={styles.modalContentWide}>
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
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h3>{t('modal.saveAs', language)}</h3>
            <input
              type="text"
              placeholder={language === 'zh' ? '输入新工程名称...' : 'Enter new project name...'}
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onFocus={selectOnFocus}
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
        <div className={styles.modal}>
          <div className={styles.modalContent}>
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
                  <span>{singleText(tube.remainingVolume, tube.remainingVolumeUnit || 'μL')}</span>
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
        <div className={styles.modal}>
          <div className={styles.editModalContent}>
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
                    onFocus={selectOnFocus}
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
                    onFocus={selectOnFocus}
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
                      onFocus={selectOnFocus}
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
                                const newSubs = editFormData.substances.map((s, idx) =>
                                  idx === i ? { ...s, name: e.target.value } : s
                                )
                                setEditFormData({ ...editFormData, substances: newSubs })
                              }}
                              onFocus={selectOnFocus}
                              placeholder={t('tubeDetail.substanceName', language)}
                            />
                            <input
                              type="number"
                              value={sub.concentration || ''}
                              onChange={(e) => {
                                const newSubs = editFormData.substances.map((s, idx) =>
                                  idx === i ? { ...s, concentration: Number(e.target.value) } : s
                                )
                                setEditFormData({ ...editFormData, substances: newSubs })
                              }}
                              onFocus={selectOnFocus}
                              placeholder={t('tubeDetail.concentration', language)}
                            />
                            <select
                              value={sub.concentrationUnit}
                              onChange={(e) => {
                                const newSubs = editFormData.substances.map((s, idx) =>
                                  idx === i ? { ...s, concentrationUnit: e.target.value as any } : s
                                )
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
                          onFocus={selectOnFocus}
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
                          onFocus={selectOnFocus}
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

            {formError && (
              <div className={styles.formError} onClick={() => setFormError(null)}>
                ⚠️ {formError}
              </div>
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
        <div className={styles.modal}>
          <div className={styles.editModalContent}>
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

      {saveToast && (
        <div key={saveToast.key} className={styles.toast}>
          {saveToast.text}
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
