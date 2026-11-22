/**
 * 单位归一化 —— 全仓库唯一的一份单位表。
 *
 * 归一化口径：浓度一律归一到 μM，体积一律归一到 μL。
 * 原来的两份单位表（src/shared/utils/calculations.ts 与 pages/ExperimentPage.tsx 的 concToUM）
 * 已合并到这里。
 *
 * 注意：查表时保留 `|| 1` 兜底，与改动前的行为一致（未知/缺失单位按基准单位处理）。
 */

/** 浓度单位 -> μM 的换算因子 */
export const CONCENTRATION_FACTORS: Record<string, number> = {
  'nM': 0.001,
  'μM': 1,
  'mM': 1000,
  'M': 1000000
}

/** 体积单位 -> μL 的换算因子 */
export const VOLUME_FACTORS: Record<string, number> = {
  'nL': 0.001,
  'μL': 1,
  'mL': 1000,
  'L': 1000000
}

/** 浓度换算因子 */
export function concentrationFactor(unit: string | undefined): number {
  return CONCENTRATION_FACTORS[unit as string] || 1
}

/** 体积换算因子 */
export function volumeFactor(unit: string | undefined): number {
  return VOLUME_FACTORS[unit as string] || 1
}

/** 将浓度转换为标准单位 (μM) */
export function normalizeConcentration(value: number, unit: string): number {
  return value * concentrationFactor(unit)
}

/** 将体积转换为标准单位 (μL) */
export function normalizeVolume(value: number, unit: string): number {
  return value * volumeFactor(unit)
}

/** 从标准单位 (μL) 转换回指定单位 */
export function denormalizeVolume(value: number, unit: string): number {
  return value / volumeFactor(unit)
}

/** 从标准单位 (μM) 转换回指定单位 */
export function denormalizeConcentration(value: number, unit: string): number {
  return value / concentrationFactor(unit)
}

/**
 * 将体积四舍五入到指定小数位，避免浮点精度问题
 * @param volume 体积值
 * @param decimals 小数位数，默认 3
 */
export function roundVolume(volume: number, decimals: number = 3): number {
  if (!isFinite(volume)) return volume
  const factor = Math.pow(10, decimals)
  return Math.round(volume * factor) / factor
}

// ==================== 显示用数值格式化 ====================

/**
 * 数值被格式化时属于哪一类量。
 * 浓度按 nM / µM / mM 选档，体积按 nL / µL / mL 选档。
 */
export type QuantityKind = 'concentration' | 'volume'

/** 某一档的单位与「换成基准单位（µM / µL）的倍数」 */
interface QuantityStep {
  unit: string
  factor: number
}

/**
 * 显示用的单位阶梯（升序）。
 * 注意：这里只管「怎么写给人看」，不参与计算；计算一律走上面的 μM / μL 归一化。
 * 顶档到 M / L：1 M 的母液必须写成 "1 M"，不能掉到 "1000000 μM"。
 */
const QUANTITY_LADDERS: Record<QuantityKind, QuantityStep[]> = {
  concentration: [
    { unit: 'nM', factor: 0.001 },
    { unit: 'μM', factor: 1 },
    { unit: 'mM', factor: 1000 },
    { unit: 'M', factor: 1000000 }
  ],
  volume: [
    { unit: 'nL', factor: 0.001 },
    { unit: 'μL', factor: 1 },
    { unit: 'mL', factor: 1000 },
    { unit: 'L', factor: 1000000 }
  ]
}

/** 基准档在阶梯里的下标（浓度 µM、体积 µL） */
const BASE_STEP_INDEX = 1

/** 数字转文本：去掉指数写法与尾随零，保证人读得懂 */
function numberText(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const text = String(value)
  if (!/e/i.test(text)) return text
  if (Math.abs(value) >= 1e21) return text
  return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '')
}

/** 保留至多 digits 位有效数字，尾随零由 numberText 去掉 */
function roundSignificant(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value
  return Number(value.toPrecision(digits))
}

/** 格式化结果：数值、单位、可直接拼进文字的整串 */
export interface FormattedQuantity {
  /** 换算到该档之后的数值（已按有效数字取整） */
  value: number
  unit: string
  /** 例如 "5 mM"、"12.5 μL"；无法表示时为 "—" */
  text: string
}

/**
 * 把基准单位（µM / µL）下的数值写成最好读的「数值 + 单位」。
 *
 * 规则：
 * - 选到让数值落在 1–999 的**最大**那一档（1 M = 1000 mM = 1000000 μM；0.5 M 落 500 mM）；
 *   超出阶梯两端时封顶（如 0.0001 µM → 0.1 nM）。
 * - 默认保留至多 3 位有效数字，并去掉尾随零：5 mM、12.5 µL，不写 5.000 mM。
 * - 0 写 "0 µM" / "0 µL"；NaN / Infinity 写 "—"；负数保留符号（-5 mM），不报错。
 */
export function formatQuantityParts(
  value: number,
  kind: QuantityKind,
  options: { maxSignificantDigits?: number } = {}
): FormattedQuantity {
  const ladder = QUANTITY_LADDERS[kind]
  const digits = options.maxSignificantDigits ?? 3

  if (!Number.isFinite(value)) {
    return { value: Number.NaN, unit: ladder[BASE_STEP_INDEX].unit, text: '—' }
  }

  if (value === 0) {
    const unit = ladder[BASE_STEP_INDEX].unit
    return { value: 0, unit, text: `0 ${unit}` }
  }

  const sign = value < 0 ? -1 : 1
  const magnitude = Math.abs(value)

  let index = BASE_STEP_INDEX
  while (index < ladder.length - 1 && magnitude / ladder[index].factor >= 1000) index++
  while (index > 0 && magnitude / ladder[index].factor < 1) index--

  let scaled = magnitude / ladder[index].factor
  let rounded = roundSignificant(scaled, digits)

  // 四舍五入后进位越过 1000（如 999.6 µL → 1000）时升一档，避免出现 "1000 µL"
  while (rounded >= 1000 && index < ladder.length - 1) {
    index++
    scaled = magnitude / ladder[index].factor
    rounded = roundSignificant(scaled, digits)
  }

  const unit = ladder[index].unit
  const finalValue = rounded * sign
  return { value: finalValue, unit, text: `${numberText(finalValue)} ${unit}` }
}

/** 同 formatQuantityParts，只返回 "5 mM" 这样的整串 */
export function formatQuantity(
  value: number,
  kind: QuantityKind,
  options: { maxSignificantDigits?: number } = {}
): string {
  return formatQuantityParts(value, kind, options).text
}

/**
 * 导出到 .yml 这类「数据真相源」时用的写法。
 *
 * 与 formatQuantity 的区别：如果 3 位有效数字会丢掉超过百万分之一的数值（例如 2985 µL → 2.99 mL 会差 5 µL），
 * 就改用至多 8 位有效数字的同一个写法（2.985 mL）。读数依旧不带一串 0，但数据不会悄悄变。
 */
export function formatQuantityExact(value: number, kind: QuantityKind): string {
  const display = formatQuantity(value, kind)
  if (!Number.isFinite(value) || value === 0) return display
  const readBack = parseQuantity(display, kind)
  if (readBack !== null && Math.abs(readBack - value) <= Math.abs(value) * 1e-6) return display
  return formatQuantity(value, kind, { maxSignificantDigits: 8 })
}

/**
 * 在**指定单位**下写数值（不自选档），用于「20/20 μL」这种两格共用一个单位的场合。
 * value 一律按基准单位（µM / µL）传进来。
 */
export function formatQuantityIn(
  value: number,
  kind: QuantityKind,
  unit: string,
  options: { maxSignificantDigits?: number } = {}
): string {
  const ladder = QUANTITY_LADDERS[kind]
  const step = ladder.find(s => s.unit === unit) ?? ladder[BASE_STEP_INDEX]
  if (!Number.isFinite(value)) return `— ${step.unit}`
  const scaled = roundSignificant(value / step.factor, options.maxSignificantDigits ?? 3)
  return `${numberText(scaled)} ${step.unit}`
}

/** 一组数值（基准单位）共用一个单位时，挑最大的那个值来决定单位 */
export function pickDisplayUnit(values: number[], kind: QuantityKind): string {
  const finite = values.filter(v => Number.isFinite(v))
  if (finite.length === 0) return QUANTITY_LADDERS[kind][BASE_STEP_INDEX].unit
  const maxAbs = Math.max(...finite.map(v => Math.abs(v)))
  return formatQuantityParts(maxAbs, kind).unit
}

/** 单位别名：允许 uM / um / 希腊字母 μ 混用，也容忍大小写差异 */
const UNIT_ALIASES: Record<string, string> = {
  nM: 'nM',
  nm: 'nM',
  'μM': 'μM',
  'µM': 'μM',
  'uM': 'μM',
  'µm': 'μM',
  'um': 'μM',
  mM: 'mM',
  mm: 'mM',
  M: 'M',
  nL: 'nL',
  nl: 'nL',
  'μL': 'μL',
  'µL': 'μL',
  'uL': 'μL',
  'µl': 'μL',
  'μl': 'μL',
  ul: 'μL',
  mL: 'mL',
  ml: 'mL',
  L: 'L',
  l: 'L'
}

/**
 * 把 "5 mM" / "12.5 µL" 这类文本读回基准单位（µM / µL）的数值。
 * 解析不了（空串、单位不认识、NaN）时返回 null，不抛异常。
 * 也接受裸数字 —— 裸数字按基准单位理解，方便 Agent 手改 .yml 时不带单位。
 */
export function parseQuantity(text: string | number, kind: QuantityKind): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null
  if (typeof text !== 'string') return null

  const trimmed = text.trim()
  if (trimmed === '') return null

  const bare = Number(trimmed)
  if (Number.isFinite(bare)) return bare

  // 单位允许带 µ(U+00B5 MICRO SIGN) 或 μ(U+03BC GREEK MU)，也允许纯 ASCII 的 u
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([A-Za-zµμ]+)$/i)
  if (!match) return null

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null

  const unit = UNIT_ALIASES[match[2]]
  if (!unit) return null

  const factor = kind === 'concentration' ? CONCENTRATION_FACTORS[unit] : VOLUME_FACTORS[unit]
  if (!factor) return null

  return amount * factor
}
