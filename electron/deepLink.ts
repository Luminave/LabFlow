/**
 * 深链接（`labflow://`）的主进程侧接线：
 *   - 注册协议（开发模式要带 electron 可执行文件与脚本路径）
 *   - 单实例锁：第二次点链接是「唤起已有窗口」，不是开第二个实例
 *   - Windows/Linux 走 `second-instance`（URL 在 argv 里），macOS 走 `open-url`
 *   - 三处入口最后都汇到 `deliverDeepLink()`：前置窗口 → 渲染进程收 `deeplink:open`
 */
import { app, BrowserWindow } from 'electron'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  DEEP_LINK_SCHEME,
  createProtocolRegistrar,
  findDeepLinkArg
} from '../src/core/deepLink'
import { createDeepLinkQueue } from './deepLinkQueue'

/**
 * 窗口还没准备好时收到的链接先放这里。
 *
 * 关键语义（2026-11-23 冷启动 bug 的修法）：**放进来就一直留着，直到渲染层主动来取**。
 * 只靠 `did-finish-load` 里 send 一次是不行的——渲染层的订阅在 React effect 里注册，
 * 比 load 事件更晚，那一次 send 会被丢掉，而且没有任何补救机会。
 * 投递策略（什么时候能 push、什么时候只能留着）也收在这个模块里，见 deepLinkQueue.ts。
 */
const pendingLink = createDeepLinkQueue()

/** 页面开始（重新）加载：渲染层要重新订阅，之前「可以收推送」的状态作废 */
export function resetRendererReady(): void {
  pendingLink.resetRenderer()
}

/**
 * 找出「跑哪个应用目录」：注册表命令里那一段。
 *
 * 不能写死 `process.argv[1]`：Windows 有时会在前面插一个开关
 * （实测点链接启动时 argv 是 `[exe, '--allow-file-access-from-files', '<appDir>', '<url>']`），
 * 那样就会把开关当成目录写进注册表，下次点链接直接报废。
 * 所以扫一遍，取第一个真实存在的目录（或 .asar 文件）。
 */
function resolveAppPath(argv: string[]): string {
  for (let index = 1; index < argv.length; index += 1) {
    const raw = (argv[index] || '').replace(/^["']|["']$/g, '')
    if (!raw || raw.startsWith('-')) continue
    if (/^labflow:/i.test(raw)) continue
    try {
      const absolute = path.resolve(raw)
      if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) return absolute
    } catch {
      // 继续看下一个
    }
  }
  return ''
}

/** 把窗口叫到前面（不重载、不改地址） */
function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** 把链接交给渲染进程（窗口一定在前台） */
export function deliverDeepLink(url: string): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window || window.isDestroyed()) {
    pendingLink.push(url)
    return
  }

  // 只前置 + 发 IPC：绝不 loadURL/loadFile。重载会把页面指到已经关掉的 dev 服务器，
  // 表现就是一个白窗口（这是踩过的坑）。
  focusMainWindow()

  // 页面还在加载、或渲染层还没订阅好：这时 send 出去没人听，等于丢（这就是冷启动 bug）。
  // 留在 pending 里，等渲染层挂载后来 take。冷启动因此只走「拉」这一条路，不会重复。
  if (!pendingLink.canPushNow(window.webContents.isLoadingMainFrame())) {
    pendingLink.push(url)
    return
  }

  window.webContents.send('deeplink:open', url)
}

/**
 * 渲染层挂载完订阅后主动来取（`ipcMain.handle('deeplink:take-pending')`）。
 *
 * 顺带把「渲染层已就绪」置为 true：从这一刻起热投递才允许直接 push。
 * 取走即清空，第二次调用返回 null（所以同一条链接不会被处理两遍）。
 */
export function takePendingDeepLink(): string | null {
  return pendingLink.takeForRenderer()
}

/**
 * 注册 `labflow://` 协议（幂等，重复调用不会重复写注册表）。
 * 开发模式下系统必须知道「用哪个 exe 跑哪个目录」，所以要带 execPath + 脚本路径；
 * 打包后系统自己就能找到应用，不用带参数。
 */
/**
 * 开发模式下（`electron .`）直接把注册表命令写成
 *   "electron.exe" "<工程目录绝对路径>" "%1"
 *
 * 为什么不用 `app.setAsDefaultProtocolClient(scheme, execPath, [script])`：
 * 在打包前的 ESM 主进程里实测会把第三个参数按**单个字符**拆开写进注册表
 * （得到 `"D" ":" "\" "p" …`），点链接必然打不开；打包后的 CJS 主进程没有这个问题。
 */
function registerDevProtocolOnWindows(scriptPath: string): boolean {
  const command = `"${process.execPath}" "${scriptPath}" "%1"`
  const baseKey = `HKCU\\Software\\Classes\\${DEEP_LINK_SCHEME}`
  const write = (key: string, ...values: string[]): boolean =>
    spawnSync('reg', ['add', key, ...values, '/f'], { windowsHide: true }).status === 0

  const ok =
    write(baseKey, '/ve', '/d', 'URL:LabFlow') &&
    write(baseKey, '/v', 'URL Protocol', '/d', '') &&
    write(`${baseKey}\\shell\\open\\command`, '/ve', '/d', command)

  if (ok) {
    console.log('[DeepLink] 开发模式协议已注册：', command)
  } else {
    console.warn('[DeepLink] 开发模式写注册表失败，点链接可能打不开')
  }
  return ok
}

export function registerDeepLinkProtocol(): boolean {
  // 打包后：系统自己就能找到应用，用 Electron 官方接口
  if (app.isPackaged) {
    const register = createProtocolRegistrar((scheme) => app.setAsDefaultProtocolClient(scheme))
    return register(DEEP_LINK_SCHEME)
  }

  // 开发模式：argv 里的应用目录可能是相对的（'.'），也可能被 Windows 前面插了开关，
  // 所以扫一遍取第一个真实存在的目录，再转成绝对路径
  const scriptPath = resolveAppPath(process.argv)
  if (!scriptPath) {
    console.warn('[DeepLink] 拿不到工程目录，跳过协议注册')
    return false
  }

  if (process.platform === 'win32') {
    return registerDevProtocolOnWindows(scriptPath)
  }

  // macOS / Linux 开发模式下协议指向不可靠，等打包安装后再用
  console.log('[DeepLink] 非 Windows 开发模式，跳过协议注册')
  return false
}

/**
 * 抢单实例锁并挂上相关监听。返回 false 表示没抢到（应由调用方退出本实例）。
 * 必须在 `app.whenReady()` 之前调用，否则第二个实例已经跑起来了。
 */
export function setupDeepLinkHandlers(): boolean {
  const gotLock = app.requestSingleInstanceLock()
  // 这两行是自证用的：全新启动时必须是 lock=true、链接=无；
  // 点链接时才有第二个进程带 lock=false 退掉（它绝不会建窗口）
  console.log('[DeepLink] singleInstanceLock =', gotLock)
  console.log('[DeepLink] argv =', JSON.stringify(process.argv))
  console.log('[DeepLink] 启动链接 =', findDeepLinkArg(process.argv) ? '有' : '无')
  if (!gotLock) return false

  // 第二个实例被系统拉起来时（点链接），把 URL 转给已经在跑的窗口
  app.on('second-instance', (_event, argv) => {
    // 先把完整 argv 记下来：链接被 shell 拆坏时，只有这里能看出到底传进来什么
    console.log('[DeepLink] 第二实例 argv：', JSON.stringify(argv))
    const url = findDeepLinkArg(argv)
    console.log('[DeepLink] 第二个实例带来的链接：', url || '(没有)')
    if (url) {
      deliverDeepLink(url)
      return
    }
    // 没认出链接时，把完整 argv 打出来，方便下次定位（引号、空格、参数移位都看得到）
    console.warn('[DeepLink] argv 里没找到 link，完整参数：', JSON.stringify(argv))
    // 只是又双击了一次图标：把窗口叫到前面就行
    focusMainWindow()
  })

  // macOS：点链接走 open-url（可能在 ready 之前就来）
  app.on('open-url', (event, url) => {
    event.preventDefault()
    deliverDeepLink(url)
  })

  return true
}

/** 首次启动时 argv 里就可能带着链接（Windows/Linux 点链接会新起一个实例再转交） */
export function initialDeepLink(): string | undefined {
  return findDeepLinkArg(process.argv)
}
