/**
 * 画布节点颜色 —— Obsidian 只认 `"1"`–`"6"` 六个预设色。
 *
 * 画布着色**只按试管类型**（主人 2026-11-22 定：原料一色、中间产物一色、缓冲液一色，
 * 成分色优先会让同一张白板五颜六色分不清）。成分背景色不再影响画布，只按原值记进 .yml 备查。
 */

/** Obsidian Canvas 的六个预设色（取自官方配色） */
export const CANVAS_PRESETS: { key: string; hex: string; name: string }[] = [
  { key: '1', hex: '#fb464c', name: '红' },
  { key: '2', hex: '#e9973f', name: '橙' },
  { key: '3', hex: '#e0de71', name: '黄' },
  { key: '4', hex: '#44cf6e', name: '绿' },
  { key: '5', hex: '#53dfdd', name: '青' },
  { key: '6', hex: '#a882ff', name: '紫' }
]

/**
 * 类型 → 预设色（唯一口径）：来源试剂=青 5、中间产物=绿 4、缓冲液=紫 6、废液=橙 2，样本不上色。
 * 顺序有意义：同一个工程里四种主要类型不撞色。
 */
const TYPE_COLORS: Record<string, string | undefined> = {
  source: '5',
  intermediate: '4',
  buffer: '6',
  waste: '2',
  sample: undefined
}

/** #rgb / #rrggbb / rgb(...) → [r,g,b]，读不出来返回 null */
export function parseHexColor(value: string): [number, number, number] | null {
  if (!value) return null
  const text = value.trim()
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text)
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16)
    ]
  }
  const long = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text)
  if (long) {
    return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)]
  }
  return null
}

/** RGB → HSL（h 0–360，s/l 0–1） */
export function rgbToHsl(rgb: [number, number, number]): { h: number; s: number; l: number } {
  const [r, g, b] = rgb.map(value => value / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }

  const delta = max - min
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h: number
  if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / delta + 2) * 60
  else h = ((r - g) / delta + 4) * 60
  return { h, s, l }
}

/**
 * 找最接近的预设色。
 *
 * 用 HSL 判色而不是直接比 RGB：实验里的配色多是浅色（#fca5a5、#fef08a 这种），
 * 纯 RGB 距离会把浅红判成黄。这里以色相为主、饱和度/明度作小幅修正。
 */
export function nearestPreset(value: string): string | undefined {
  const rgb = parseHexColor(value)
  if (!rgb) return undefined

  const source = rgbToHsl(rgb)
  let best: { key: string; distance: number } | null = null
  for (const preset of CANVAS_PRESETS) {
    const target = rgbToHsl(parseHexColor(preset.hex)!)
    let hueGap = Math.abs(source.h - target.h)
    if (hueGap > 180) hueGap = 360 - hueGap
    // 色相差按度数算，饱和度/明度差换算成同一量级再打折
    const distance =
      (source.s < 0.12 && target.s < 0.12 ? 0 : hueGap) +
      Math.abs(source.s - target.s) * 60 +
      Math.abs(source.l - target.l) * 30
    if (!best || distance < best.distance) best = { key: preset.key, distance }
  }
  return best?.key
}

/**
 * 一根试管在画布上用什么颜色的预设。
 * 有成分背景色就用它按最接近的预设；没有就按试管类型给默认色；样本不给色。
 */
export function canvasColorFor(type: string, _substanceColor?: string): string | undefined {
  // 成分色已弃用（主人 2026-11-22）：一律按类型上色，颜色跟「这根管是什么」走，不跟成分走。
  return TYPE_COLORS[type]
}

/** 预设色名字（报告/测试用） */
export function presetName(key: string | undefined): string | undefined {
  return CANVAS_PRESETS.find(preset => preset.key === key)?.name
}

/**
 * 取这根试管的成分背景色：按 substances 顺序，第一条有颜色配置的为准。
 * 现在只写进 .yml 的 `color` 作备查，不再参与画布着色。
 */
export function tubeSubstanceColor(
  tube: { substances?: { name: string }[] },
  colors?: Record<string, string>
): string | undefined {
  if (!colors) return undefined
  for (const sub of tube.substances || []) {
    const hex = colors[sub.name]
    if (hex) return hex
  }
  return undefined
}
