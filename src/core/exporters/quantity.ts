/**
 * 导出器专用的「数值 → 好读文字」小工具。
 *
 * 存在的理由：工程数据里的量**不一定**以 µM / µL 记——仓库拿来一瓶 1 M 的母液，
 * 存的就是 `concentration: 1000, concentrationUnit: 'mM'`。导出时如果直接
 * `formatQuantity(1000, 'concentration')`，会把它当成 1000 µM 写成 `1 mM`，**差 1000 倍**。
 * 所以凡是要把量写成字的地方，都先过这里的 `toBaseConcentration` / `toBaseVolume`
 * 归一化回 µM · µL，再交给 units.formatQuantity。
 *
 * （yml.ts 载入时也按同一口径归一化，两边对称。）
 */

import type { Substance, TransferConnection, Tube, VolumeUnit } from '../schema'
import {
  formatQuantity,
  formatQuantityExact,
  normalizeConcentration,
  normalizeVolume
} from '../units'

/** 物质浓度 → 基准单位 µM */
export function toBaseConcentration(sub: Substance): number {
  const value = Number(sub?.concentration)
  if (!Number.isFinite(value)) return 0
  return normalizeConcentration(value, sub?.concentrationUnit || 'μM')
}

/** 体积 → 基准单位 µL */
export function toBaseVolume(value: number | null | undefined, unit?: VolumeUnit): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return normalizeVolume(number, unit || 'μL')
}

/** 物质 + 浓度，如 `Mg 5 mM` */
export function substanceText(sub: Substance, exact = false): string {
  const write = exact ? formatQuantityExact : formatQuantity
  return `${sub.name} ${write(toBaseConcentration(sub), 'concentration')}`
}

/** 试管总量，如 `3 mL` */
export function tubeTotalText(tube: Tube, exact = false): string {
  const write = exact ? formatQuantityExact : formatQuantity
  return write(toBaseVolume(tube.totalVolume, tube.totalVolumeUnit), 'volume')
}

/** 连线用量，如 `12.5 μL` */
export function connectionVolumeText(conn: TransferConnection, exact = false): string {
  const write = exact ? formatQuantityExact : formatQuantity
  return write(toBaseVolume(conn.volume, conn.volumeUnit), 'volume')
}
