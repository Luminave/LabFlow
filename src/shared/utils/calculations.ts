/**
 * 浓度和体积计算工具
 */

import { Substance, Tube, CalculationRequest, CalculationResult, VolumeUnit } from '../types'

/**
 * 浓度单位转换因子 (统一转换为 μM)
 */
const CONCENTRATION_FACTORS: Record<string, number> = {
  'nM': 0.001,
  'μM': 1,
  'mM': 1000,
  'M': 1000000
}

/**
 * 体积单位转换因子 (统一转换为 μL)
 */
const VOLUME_FACTORS: Record<string, number> = {
  'nL': 0.001,
  'μL': 1,
  'mL': 1000,
  'L': 1000000
}

/**
 * 将浓度转换为标准单位 (μM)
 */
export function normalizeConcentration(value: number, unit: string): number {
  return value * (CONCENTRATION_FACTORS[unit] || 1)
}

/**
 * 将体积转换为标准单位 (μL)
 */
export function normalizeVolume(value: number, unit: string): number {
  return value * (VOLUME_FACTORS[unit] || 1)
}

/**
 * 从标准单位转换回指定单位
 */
export function denormalizeVolume(value: number, unit: string): number {
  return value / (VOLUME_FACTORS[unit] || 1)
}

/**
 * 计算从源试管取出指定体积后，目标试管中的物质浓度
 * 
 * 公式: C_target = (C_source × V_source) / V_target
 */
export function calculateResultingConcentration(
  sourceConcentration: number,
  sourceVolume: number,
  targetTotalVolume: number
): number {
  if (targetTotalVolume === 0) return 0
  return (sourceConcentration * sourceVolume) / targetTotalVolume
}

/**
 * 计算要达到目标浓度需要从源试管取出的体积
 * 
 * 公式: V_source = (C_target × V_target) / C_source
 */
export function calculateRequiredVolume(
  sourceConcentration: number,
  targetConcentration: number,
  targetTotalVolume: number
): number {
  if (sourceConcentration === 0) return 0
  return (targetConcentration * targetTotalVolume) / sourceConcentration
}

/**
 * 验证试管是否有足够的剩余体积
 */
export function checkVolumeAvailability(
  tube: Tube,
  requiredVolume: number,
  volumeUnit: VolumeUnit
): { available: boolean; shortage: number } {
  const normalizedRemaining = normalizeVolume(tube.remainingVolume, tube.remainingVolumeUnit)
  const normalizedRequired = normalizeVolume(requiredVolume, volumeUnit)
  
  const shortage = normalizedRequired - normalizedRemaining
  
  return {
    available: shortage <= 0,
    shortage: Math.max(0, denormalizeVolume(shortage, tube.remainingVolumeUnit))
  }
}

/**
 * 执行混合计算
 * 给定多个源试管和要取出的体积，计算混合后的物质浓度
 */
export function calculateMixture(
  sources: {
    tube: Tube
    volume: number
    volumeUnit: VolumeUnit
  }[]
): Substance[] {
  const substanceMap = new Map<string, { totalMoles: number; unit: string }>()
  let totalVolume = 0
  
  for (const source of sources) {
    const normalizedVolume = normalizeVolume(source.volume, source.volumeUnit)
    totalVolume += normalizedVolume
    
    for (const substance of source.tube.substances) {
      const normalizedConc = normalizeConcentration(substance.concentration, substance.concentrationUnit)
      const moles = normalizedConc * normalizedVolume // μM × μL = pmol
      
      const existing = substanceMap.get(substance.name)
      if (existing) {
        existing.totalMoles += moles
      } else {
        substanceMap.set(substance.name, {
          totalMoles: moles,
          unit: substance.concentrationUnit
        })
      }
    }
  }
  
  if (totalVolume === 0) return []
  
  // 计算最终浓度
  const result: Substance[] = []
  substanceMap.forEach((data, name) => {
    const concentration = data.totalMoles / totalVolume // pmol / μL = μM
    result.push({
      name,
      concentration: Math.round(concentration * 1000) / 1000, // 保留3位小数
      concentrationUnit: 'μM' as const
    })
  })
  
  return result
}

/**
 * 完整的计算函数
 */
export function performCalculation(
  request: CalculationRequest,
  sourceTubes: Tube[]
): CalculationResult {
  const errors: string[] = []
  const warnings: string[] = []
  
  // 验证源试管
  if (!request.sourceTubes || request.sourceTubes.length === 0) {
    return { success: false, errors: ['没有指定源试管'] }
  }
  
  // 根据模式执行不同的计算
  if (request.mode === 'concentration-to-volume') {
    // 用户指定目标浓度，计算需要取出的体积
    // 这个模式暂时不实现，因为界面设计是先指定体积
    return { success: false, errors: ['暂不支持该计算模式'] }
  }
  
  // volume-to-concentration 模式
  // 用户指定从每个源试管取出的体积，计算目标试管中的浓度
  
  const transfers: CalculationResult['transfers'] = []
  const mixtureSources: Parameters<typeof calculateMixture>[0] = []
  
  for (const source of request.sourceTubes) {
    const tube = sourceTubes.find(t => t.id === source.tubeId)
    if (!tube) {
      errors.push(`找不到试管 ${source.tubeId}`)
      continue
    }
    
    if (!source.volume || source.volume <= 0) {
      continue
    }
    
    // 检查体积是否足够
    const volumeCheck = checkVolumeAvailability(tube, source.volume, 'μL')
    if (!volumeCheck.available) {
      errors.push(`试管 "${tube.name}" 体积不足，缺少 ${volumeCheck.shortage.toFixed(2)} μL`)
      continue
    }
    
    transfers!.push({
      tubeId: tube.id,
      volume: source.volume,
      concentration: tube.substances[0]?.concentration || 0
    })
    
    mixtureSources.push({
      tube,
      volume: source.volume,
      volumeUnit: 'μL'
    })
  }
  
  if (errors.length > 0) {
    return { success: false, errors }
  }
  
  // 计算混合后的物质
  const targetSubstances = calculateMixture(mixtureSources)
  
  // 计算需要的缓冲液体积
  let bufferVolume: number | undefined
  if (request.targetVolume && request.allowBufferFill) {
    const totalSourceVolume = request.sourceTubes.reduce((sum, s) => sum + (s.volume || 0), 0)
    const targetVol = normalizeVolume(request.targetVolume, 'μL')
    const sourceVol = normalizeVolume(totalSourceVolume, 'μL')
    
    if (targetVol > sourceVol) {
      bufferVolume = denormalizeVolume(targetVol - sourceVol, 'μL')
    } else if (targetVol < sourceVol) {
      warnings.push(`源试管总体积 (${totalSourceVolume} μL) 超过目标体积 (${request.targetVolume} μL)`)
    }
  }
  
  return {
    success: true,
    transfers,
    targetSubstances,
    bufferVolume,
    warnings: warnings.length > 0 ? warnings : undefined
  }
}
