/**
 * CLI 参数解析（手写，零依赖）。
 *
 * 规则：
 * - `--key value` 取值；`--key` 后面紧跟另一个 `--xxx` 或到头 → 当成布尔 true
 * - `--key=value` 也支持
 * - 其余是位置参数（命令 + 工程名）
 * - 未知的 `--xxx` 不在这里报错，由各命令自己校验（不同命令认不同开关）
 */

export interface ParsedArgs {
  command: string
  positionals: string[]
  flags: Record<string, string | boolean>
}

export function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (item === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (item.startsWith('--')) {
      const body = item.slice(2)
      const eq = body.indexOf('=')
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1)
        continue
      }
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[body] = true
      } else {
        flags[body] = next
        i++
      }
      continue
    }
    positionals.push(item)
  }

  return { command: positionals[0] || '', positionals: positionals.slice(1), flags }
}

/** 取字符串开关（布尔或缺失都当没给） */
export function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key]
  return typeof value === 'string' ? value : undefined
}

/** 取数值开关 */
export function flagNumber(flags: Record<string, string | boolean>, key: string): number | undefined {
  const value = flagString(flags, key)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 布尔开关（`--json` / `--json true` 都算真） */
export function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  const value = flags[key]
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  return !['false', '0', 'no', ''].includes(value.toLowerCase())
}
