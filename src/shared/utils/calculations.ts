/**
 * 浓度和体积计算工具
 *
 * 单位表与归一化函数已统一搬到计算内核（src/core/units.ts），这里只做转发，
 * 保证全仓库只有一份单位表。新代码请直接用 `@/core/units`。
 */

import { Substance, Tube, CalculationRequest, CalculationResult, VolumeUnit } from '../types'
import { computeMixture } from '../../core/mix'
import { normalizeVolume, denormalizeVolume } from '../../core/units'

// 单位表与归一化工具的唯一实现：src/core/units.ts
export {
  CONCENTRATION_FACTORS,
  VOLUME_FACTORS,
  concentrationFactor,
  volumeFactor,
  normalizeConcentration,
  normalizeVolume,
  denormalizeVolume,
  denormalizeConcentration,
  roundVolume
} from '../../core/units'

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
 * 实现已收到计算内核（src/core/mix.ts）：先归一到 μM·μL 再算，结果一律 μM。
 */
export function calculateMixture(
  sources: {
    tube: Tube
    volume: number
    volumeUnit: VolumeUnit
  }[]
): Substance[] {
  return computeMixture(
    sources.map(source => ({
      substances: source.tube.substances,
      volume: source.volume,
      volumeUnit: source.volumeUnit
    })),
    { unitMode: 'uM', decimals: 3 }
  ) as Substance[]
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
