/**
 * `labflow://` 深链接（AI 提出，主人 2026-11-22 确认要）。
 *
 * 形如：`labflow://open?project=261118-%E5%AE%9E%E9%99%85%E5%AE%9E%E9%AA%8C`
 * 名字里有多个同名工程时再带 `&id=<工程 id>` 精确指定，只给名字则取最近更新的那一个。
 *
 * 这个文件**不带任何 electron 依赖**：主进程解析参数、渲染进程解析链接、测试都用它，
 * 三处共用一份规则，免得两边各写一份、编码方式对不上。
 */

/** 协议名（注册到系统里的那个） */
export const DEEP_LINK_SCHEME = 'labflow'

/** 目前只支持 open 一个动作 */
export const DEEP_LINK_ACTION = 'open'

export interface ProjectLinkTarget {
  /** 工程名（原样，未编码） */
  project: string
  /** 工程 id，可选；同名工程多的时候用它精确指定 */
  id?: string
}

export type ParsedProjectLink =
  | { ok: true; action: typeof DEEP_LINK_ACTION; project: string; id?: string }
  | { ok: false; error: 'invalid-url' | 'unsupported-scheme' | 'unsupported-action' | 'missing-project'; detail: string }

/**
 * 生成工程链接。
 * 用 `encodeURIComponent` 而不是 `URLSearchParams`：后者把空格写成 `+`，
 * 在 Obsidian 的链接里容易被当成字面加号。
 */
export function buildProjectLink(project: string, id?: string): string {
  const name = (project || '').trim()
  const parts = [`project=${encodeURIComponent(name)}`]
  if (id) parts.push(`id=${encodeURIComponent(id)}`)
  return `${DEEP_LINK_SCHEME}://${DEEP_LINK_ACTION}?${parts.join('&')}`
}

/** 写进 Markdown 的那一行链接文字 */
export function markdownProjectLink(project: string, id?: string): string {
  return `[${project}](${buildProjectLink(project, id)})`
}

/** SOP 头部那行提示（导出的 .md 里原样写这一行） */
export function projectLinkLine(project: string, id?: string): string {
  return `> 在 LabFlow 中打开：${markdownProjectLink(project, id)}`
}

/**
 * 解析链接。故意不抛异常：调用方拿到 `ok: false` 就弹提示，不要静默失败。
 * 同时接受 `labflow://open?x=1`（host=open）与 `labflow:open?x=1`（path=Open）两种写法。
 */
export function parseProjectLink(raw: string): ParsedProjectLink {
  const text = (raw || '').trim()
  if (!text) return { ok: false, error: 'invalid-url', detail: '链接为空' }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, error: 'invalid-url', detail: `无法解析：${text}` }
  }

  if (url.protocol.replace(/:$/, '').toLowerCase() !== DEEP_LINK_SCHEME) {
    return { ok: false, error: 'unsupported-scheme', detail: `不是 ${DEEP_LINK_SCHEME}:// 链接：${text}` }
  }

  // labflow://open?... → hostname = 'open'；labflow:open?... → pathname = 'open'
  // Windows 有时候会把链接规范化成 `labflow://open/?project=…`（多一个尾斜杠），一并容忍
  const action = (url.hostname || url.pathname).replace(/^\/+|\/+$/g, '').toLowerCase()
  if (action !== DEEP_LINK_ACTION) {
    return { ok: false, error: 'unsupported-action', detail: `暂不支持的动作：${action || '(空)'}` }
  }

  const project = (url.searchParams.get('project') || '').trim()
  if (!project) {
    return {
      ok: false,
      error: 'missing-project',
      // 实测：用 `cmd /c start "" "labflow://open?project=AD-5.2"` 发链接时，
      // cmd 会把 `=` 后面的部分吃掉，应用只收到 `labflow://open/?project`。
      // 在 Obsidian 里点、或用 PowerShell 的 Start-Process 是正常的。
      detail:
        '链接里没有 project 参数（常见原因：用 cmd 的 start 发链接会把 = 后面的部分截掉；在 Obsidian 里点、或用 PowerShell 的 Start-Process 发送是正常的）'
    }
  }

  const id = (url.searchParams.get('id') || '').trim()
  return { ok: true, action: DEEP_LINK_ACTION, project, ...(id ? { id } : {}) }
}

/** 判断实验记录里哪一条是链接要打开的那个 */
export interface LinkableExperiment {
  id: string
  name: string
  updatedAt?: string
  createdAt?: string
}

/**
 * 挑出要打开的工程：
 * - 给了 id → 只认这个 id（名字改了、id 没变照样能开；id 找不到就返回 null，不猜同名）
 * - 不按 status 过滤：已结束（completed）的工程也要能用链接打开，只是界面只读
 * - 只给名字 → 先精确匹配，再忽略大小写匹配；多个命中取 updatedAt 最新的（再退 createdAt，最后取 id 小的保证确定性）
 */
export function pickProject<T extends LinkableExperiment>(experiments: T[], target: ProjectLinkTarget): T | null {
  if (!experiments || experiments.length === 0) return null

  if (target.id) {
    // id 优先，且只认 id：同一个名字可能是另一根工程，猜错比打不开更糟
    return experiments.find(experiment => experiment.id === target.id) || null
  }

  const wanted = (target.project || '').trim()
  if (!wanted) return null

  const exact = experiments.filter(experiment => (experiment.name || '').trim() === wanted)
  const pool =
    exact.length > 0
      ? exact
      : experiments.filter(experiment => (experiment.name || '').trim().toLowerCase() === wanted.toLowerCase())
  if (pool.length === 0) return null
  if (pool.length === 1) return pool[0]

  const stamp = (experiment: T): number => {
    const value = experiment.updatedAt || experiment.createdAt || ''
    const time = Date.parse(value)
    return Number.isFinite(time) ? time : 0
  }

  return [...pool].sort((a, b) => stamp(b) - stamp(a) || a.id.localeCompare(b.id))[0]
}

/**
 * 协议注册只做一次的包装：`app.setAsDefaultProtocolClient` 重复调用没意义，
 * 而且开发模式下要在 ready 前后都安全，所以外面套一层幂等壳。
 * 返回 true 表示这次真的注册了。
 */
export function createProtocolRegistrar(
  register: (scheme: string, ...args: string[]) => boolean
): (scheme: string, args?: string[]) => boolean {
  let registered = false
  return (scheme: string, args: string[] = []): boolean => {
    if (registered) return false
    registered = true
    try {
      return register(scheme, ...args)
    } catch {
      // 注册失败（权限、注册表被锁）不该让应用起不来，只是链接点不开
      registered = false
      return false
    }
  }
}

/**
 * 开发模式与打包后注册用的参数不同：
 * - 打包后：系统自己就能找到应用，直接 `setAsDefaultProtocolClient('labflow')`
 * - 开发时（`electron .`）：系统只知道 electron.exe，必须把「跑哪个脚本」一起写进注册表，
 *   否则点链接只会启动一个空的 electron
 *
 * 返回 `executable` 为 null 表示不带额外参数调用。
 * 注意 `args` 必须是数组：Electron 的第三个参数只认 string[]，传字符串会被静默忽略
 * （这就是「注册表里只剩 exe 和 %1、开发模式点不开」的那个坑）。
 */
export interface ProtocolRegistration {
  executable: string | null
  args: string[]
}

export function protocolRegistrationArgs(
  isPackaged: boolean,
  execPath: string,
  scriptPath: string | undefined
): ProtocolRegistration {
  if (isPackaged) return { executable: null, args: [] }
  // 必须是绝对路径：系统启动链接时不保证工作目录是工程目录，
  // 写成 '.' 会让 electron 在别处找应用、直接报错（开发模式最常见的坑）
  const script = (scriptPath || '').trim()
  if (!script) return { executable: null, args: [] }
  return { executable: execPath, args: [script] }
}

const DEEP_LINK_PATTERN = new RegExp(`^${DEEP_LINK_SCHEME}:`, 'i')
const DEEP_LINK_INLINE_PATTERN = new RegExp(`${DEEP_LINK_SCHEME}:\\/\\/?[^"'\\s]*`, 'i')

function stripQuotes(text: string): string {
  return text.trim().replace(/^["']+/, '').replace(/["']+$/, '')
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    try {
      return decodeURI(text)
    } catch {
      return text
    }
  }
}

/**
 * 从启动参数里捞链接。
 *
 * 不做「固定下标」假设：Windows 走协议启动时 argv 通常是 `[exe, appPath, url]`，
 * 但 `start`、`--no-sandbox`、路径含空格、注册表命令多带一个参数都会让它移位；
 * 用 `npm run electron:dev` 时还会多出 concurrent 的参数。
 *
 * 所以逐项检查，并且容忍这些形态：
 * - `labflow://open?...`、`labflow:/open?...`（单斜杠）、末尾多一个 `/`
 * - 被引号包着：`"labflow://..."`（`start "" "labflow://..."` 在部分 shell 下会这样传）
 * - 被百分号编码：`labflow%3A%2F%2Fopen%3Fproject%3D...`
 * - 夹在别的参数里：`--url=labflow://...`
 */
export function findDeepLinkArg(argv: string[]): string | undefined {
  const args = (argv || []).filter(arg => typeof arg === 'string' && arg.length > 0)
  // argv[0] 是 exe 自己；但万一被调用方重排过，也不排除它，多扫一项没有代价
  for (let index = 0; index < args.length; index += 1) {
    const raw = stripQuotes(args[index])
    if (!raw) continue

    if (DEEP_LINK_PATTERN.test(raw)) return raw

    const decoded = decodeSafe(raw)
    if (decoded !== raw) {
      const unquoted = stripQuotes(decoded)
      if (DEEP_LINK_PATTERN.test(unquoted)) return unquoted
    }

    const inline = raw.match(DEEP_LINK_INLINE_PATTERN) || decoded.match(DEEP_LINK_INLINE_PATTERN)
    if (inline) return stripQuotes(inline[0])
  }
  return undefined
}
