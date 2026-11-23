/**
 * 实验模拟页看板的「截图」入口（主人 2026-11-22：要的就是界面上看到的那个样子）。
 *
 * 做法：实验模拟页挂载时把自己的 `fitView()` 登记到这里；导出图片时先让看板缩放到
 * 「整张图都能看见」，隐藏小地图/缩放控件/操作提示，再让主进程对画布区域做
 * `webContents.capturePage(rect)`。所以出来的图和主人手动截图一模一样，只是顺手替
 * 主人点了「适应视图」、关了几个浮层。
 *
 * 注意：截图只能截当前显示的那个工程。如果导出的是别的工程（比如在讲述者页导出
 * 一个没打开过的工程），这里会返回 null，调用方就不写 PNG，只在提示里说明原因。
 */

export interface BoardCaptureSource {
  experimentId: string
  /** 让整张流程图都进入视野（React Flow 的 fitView）；padding 越大留白越多、图越小 */
  fitView: (padding?: number) => Promise<void>
}

export interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
}

let source: BoardCaptureSource | null = null

/** 实验模拟页挂载时登记；卸载时传 null */
export function setBoardCaptureSource(next: BoardCaptureSource | null): void {
  source = next
}

export function getBoardCaptureExperimentId(): string | null {
  return source?.experimentId ?? null
}

/** 截图的区域：画布容器（不含左侧导航与顶部工具条） */
export function boardRectFromDom(): CaptureRect | null {
  const element = document.querySelector('[data-labflow-board]') as HTMLElement | null
  if (!element) return null
  const box = element.getBoundingClientRect()
  if (box.width < 40 || box.height < 40) return null
  return {
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.round(box.width),
    height: Math.round(box.height)
  }
}

/** 所有节点在视口里的并集（没有节点时返回 null） */
function nodesUnionRect(): CaptureRect | null {
  const nodes = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]
  if (!nodes.length) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const node of nodes) {
    const box = node.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) continue
    left = Math.min(left, box.left)
    top = Math.min(top, box.top)
    right = Math.max(right, box.right)
    bottom = Math.max(bottom, box.bottom)
  }
  if (!Number.isFinite(left) || right <= left) return null
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  }
}

function grow(rect: CaptureRect, by: number): CaptureRect {
  return {
    x: Math.round(rect.x - by),
    y: Math.round(rect.y - by),
    width: Math.round(rect.width + by * 2),
    height: Math.round(rect.height + by * 2)
  }
}

function intersect(a: CaptureRect, b: CaptureRect): CaptureRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right - x < 40 || bottom - y < 40) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** 节点是否真的全在画布可视区内（留一点容差） */
function fullyInside(union: CaptureRect, board: CaptureRect, tolerance = 12): boolean {
  return (
    union.x >= board.x - tolerance &&
    union.y >= board.y - tolerance &&
    union.x + union.width <= board.x + board.width + tolerance &&
    union.y + union.height <= board.y + board.height + tolerance
  )
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve()
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/**
 * 截当前看板，返回 PNG 的 base64（不含 `data:image/png;base64,` 前缀）。
 * 看板没打开、或打开的不是这个工程时返回 null。
 */
export async function captureBoardPng(experimentId: string): Promise<string | null> {
  const current = source
  if (!current || current.experimentId !== experimentId) return null
  const capture = window.electronAPI?.captureBoard
  if (!capture) return null

  document.body.classList.add('labflow-capturing')
  try {
    // 先按常规留白缩到整图；节点测量是异步的，第一遍常常算得偏大，所以量一次再补缩
    await current.fitView(0.12)
    await nextFrame()
    await new Promise(resolve => setTimeout(resolve, 160))

    const board = boardRectFromDom()
    if (!board) return null

    // 还露在画布外面就再放一次（留白 0.3），最多三次，避免死循环
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const union = nodesUnionRect()
      if (!union || fullyInside(union, board)) break
      await current.fitView(0.3)
      await nextFrame()
      await new Promise(resolve => setTimeout(resolve, 160))
    }

    // 只截「节点并集 + 40px 留白」与画布可见区的交集：即使 fitView 还差一点，也不会把节点裁掉
    const union = nodesUnionRect()
    const rect = union ? intersect(grow(union, 40), board) : board
    if (!rect) return null
    return await capture(rect)
  } catch (error) {
    console.error('[Export] 看板截图失败：', error)
    return null
  } finally {
    document.body.classList.remove('labflow-capturing')
  }
}
