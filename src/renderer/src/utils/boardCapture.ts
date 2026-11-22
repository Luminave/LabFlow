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
  /** 让整张流程图都进入视野（React Flow 的 fitView） */
  fitView: () => Promise<void>
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
    await current.fitView()
    // 等两帧：fitView 的缩放/位移要落到 DOM 上之后截图才不会糊
    await nextFrame()
    const rect = boardRectFromDom()
    if (!rect) return null
    return await capture(rect)
  } catch (error) {
    console.error('[Export] 看板截图失败：', error)
    return null
  } finally {
    document.body.classList.remove('labflow-capturing')
  }
}
