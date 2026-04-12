/**
 * LabFlow 核心类型定义
 */

// 物质
export interface Substance {
  name: string
  concentration: number // 浓度 (单位: μM, mM 等)
  concentrationUnit: ConcentrationUnit
}

// 浓度单位
export type ConcentrationUnit = 'nM' | 'μM' | 'mM' | 'M'

// 体积单位
export type VolumeUnit = 'nL' | 'μL' | 'mL' | 'L'

// 成分颜色配置
export interface SubstanceColor {
  name: string
  color: string // 文字颜色
  bgColor: string // 背景色（荧光效果）
}

// 试管类型
export type TubeType = 'source' | 'intermediate' | 'buffer' | 'sample' | 'waste'

// 试管状态
export type TubeStatus = 'active' | 'depleted' | 'discarded'

// 试管分组
export interface TubeGroup {
  id: string // 唯一编号 (UUID)
  name: string // 分组名称
  color: string // 分组方框颜色
  notes: string // 备注
  createdAt: string // ISO 8601
}

// 试管
export interface Tube {
  id: string // 唯一编号 (UUID)
  name: string // 用户命名
  type: TubeType // 原料 / 中间产物
  
  // 体积信息
  totalVolume: number // 首次配置时的总体积
  totalVolumeUnit: VolumeUnit
  remainingVolume: number // 当前剩余体积
  remainingVolumeUnit: VolumeUnit
  
  // 物质组成
  substances: Substance[]
  
  // 缓冲液选择（用于中间产物试管）
  selectedBuffer?: string // 用户选择的缓冲液试管 ID
  
  // 作为原料使用（上次实验剩下的中间产物）
  asSource?: boolean // 当为 true 时，检查时赦免成分输入问题
  
  // 分组
  groupId?: string // 分组 ID
  
  // 元信息
  createdAt: string // ISO 8601
  updatedAt: string
  status: TubeStatus
  
  // 用户自定义
  storageLocation?: string
  storageCondition?: string // 存储条件 (如 -20°C, 4°C)
  notes?: string
  tags?: string[]
}

// 移液连接
export interface TransferConnection {
  id: string
  fromTubeId: string // 源试管 ID
  toTubeId: string // 目标试管 ID
  volume: number // 移液体积
  volumeUnit: VolumeUnit
}

// 实验状态
export type ExperimentStatus = 'draft' | 'completed' | 'reverted'

// 实验记录
export interface Experiment {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  
  status: ExperimentStatus
  
  // 流程图结构 - 保存完整的试管数据快照
  tubes: Tube[] // 完整的试管数据
  tubePositions: TubePosition[] // 试管位置
  connections: TransferConnection[]
  
  // 快照 (用于回退和显示不同状态)
  warehouseSnapshot?: Tube[] // 实验开始前仓库状态的快照
  initialStateTubes?: Tube[] // 实验开始时画布上试管的状态（用于默认显示）
  endStateTubes?: Tube[] // 实验结束时所有试管的状态快照
  
  // 默认缓冲液
  defaultBuffer?: string // 默认缓冲液试管 ID
  
  // 耗损实验标记
  isWaste?: boolean // 当为 true 时，表示这是一个耗损实验
}

// 试管使用记录
export interface TubeUsageRecord {
  id: string
  tubeId: string
  experimentId: string
  experimentName: string
  action: 'created' | 'transfer_in' | 'transfer_out'
  timestamp: string
  
  // 状态快照
  volumeBefore: number
  volumeAfter: number
  volumeUnit: VolumeUnit
  substancesBefore: Substance[]
  substancesAfter: Substance[]
  
  // 移液详情（仅 transfer_in/transfer_out 有）
  transferFrom?: string // 源试管ID
  transferTo?: string // 目标试管ID
  transferVolume?: number
}

// 试管档案
export interface TubeHistory {
  tubeId: string
  tubeName: string
  tubeType: TubeType
  records: TubeUsageRecord[]
  currentVolume: number
  currentVolumeUnit: VolumeUnit
  currentSubstances: Substance[]
}

// 实验结束状态
export interface ExperimentEndState {
  experimentId: string
  tubeStates: {
    tubeId: string
    volumeBefore: number
    volumeAfter: number
    substancesBefore: Substance[]
    substancesAfter: Substance[]
  }[]
}

// 计算请求类型
export type CalculationMode = 'concentration-to-volume' | 'volume-to-concentration'

// 计算请求
export interface CalculationRequest {
  mode: CalculationMode
  sourceTubes: {
    tubeId: string
    concentration?: number // 如果是 volume-to-concentration 模式，指定要达到的浓度
    volume?: number // 如果是 concentration-to-volume 模式，指定要取出的体积
  }[]
  targetVolume?: number // 目标试管的总体积
  allowBufferFill?: boolean
  bufferFillSource?: string // 指定用哪个试管填充剩余体积
}

// 计算结果
export interface CalculationResult {
  success: boolean
  transfers?: {
    tubeId: string
    volume: number
    concentration: number
  }[]
  targetSubstances?: Substance[]
  bufferVolume?: number
  errors?: string[]
  warnings?: string[]
}

// 试管位置信息
export interface TubePosition {
  tubeId: string
  x: number
  y: number
}

// 流程图节点数据 (用于 React Flow)
export interface TubeNodeData {
  tube: Tube
  isSource: boolean
  endStateVolume?: number // 实验结束后的剩余体积
  fillPercentage?: number // 方框填充比例 (用于可视化)
}

// 流程图边数据
export interface TransferEdgeData {
  volume: number
  volumeUnit: VolumeUnit
}
