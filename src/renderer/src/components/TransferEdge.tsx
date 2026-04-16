import { FC, useState, useCallback, useRef, useEffect } from 'react'
import { BaseEdge, EdgeProps, getBezierPath, EdgeLabelRenderer, useReactFlow } from '@xyflow/react'

interface TransferEdgeData {
  volume: number
  volumeUnit: string
  labelPosition?: number
  onUpdateLabelPosition?: (edgeId: string, position: number) => void
  onEdgeClick?: (edgeId: string, volume: number, volumeUnit: string) => void
}

/**
 * 从 SVG path 字符串中解析三次贝塞尔曲线的控制点
 * path 格式: "M sx,sy C c1x,c1y c2x,c2y tx,ty"
 */
function parseCubicBezier(pathStr: string) {
  // 匹配 M sx,sy C c1x,c1y c2x,c2y tx,ty
  const match = pathStr.match(
    /M\s*([\d.-]+)[,\s]+([\d.-]+)\s+C\s*([\d.-]+)[,\s]+([\d.-]+)\s+([\d.-]+)[,\s]+([\d.-]+)\s+([\d.-]+)[,\s]+([\d.-]+)/
  )
  if (!match) return null
  return {
    sx: parseFloat(match[1]),
    sy: parseFloat(match[2]),
    c1x: parseFloat(match[3]),
    c1y: parseFloat(match[4]),
    c2x: parseFloat(match[5]),
    c2y: parseFloat(match[6]),
    tx: parseFloat(match[7]),
    ty: parseFloat(match[8]),
  }
}

/**
 * 三次贝塞尔曲线求值
 */
function bezierPoint(
  t: number,
  sx: number, sy: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  tx: number, ty: number
) {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * sx + b * c1x + c * c2x + d * tx,
    y: a * sy + b * c1y + c * c2y + d * ty,
  }
}

/**
 * 自定义移液连接线
 * - 体积数字显示在曲线上
 * - 数字可以通过拖动沿曲线移动
 */
const TransferEdge: FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}) => {
  const reactFlowInstance = useReactFlow()
  const edgeData = data as unknown as TransferEdgeData
  const [isDragging, setIsDragging] = useState(false)
  const mouseStartRef = useRef<{x: number, y: number} | null>(null)

  // 用 getBezierPath 获取与渲染完全一致的曲线路径
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // 从实际的 path 字符串中解析控制点（确保与渲染路径一致）
  const parsed = parseCubicBezier(edgePath)
  // 降级：如果解析失败，用端点本身
  const c1x = parsed?.c1x ?? sourceX
  const c1y = parsed?.c1y ?? sourceY
  const c2x = parsed?.c2x ?? targetX
  const c2y = parsed?.c2y ?? targetY

  // 当前标签位置 (0~1)
  const currentPos = edgeData?.labelPosition ?? 0.5
  const pt = bezierPoint(currentPos, sourceX, sourceY, c1x, c1y, c2x, c2y, targetX, targetY)

  // --- 拖动/点击 ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      mouseStartRef.current = { x: e.clientX, y: e.clientY }
      setIsDragging(true)

      const flowContainer = document.querySelector('.react-flow') as HTMLElement
      if (!flowContainer) return

      // 拖动时固定使用当前控制点（拖动过程中 path 不会变）
      const curParsed = parseCubicBezier(edgePath)
      const dc1x = curParsed?.c1x ?? sourceX
      const dc1y = curParsed?.c1y ?? sourceY
      const dc2x = curParsed?.c2x ?? targetX
      const dc2y = curParsed?.c2y ?? targetY

      let hasMoved = false

      const handleMouseMove = (ev: MouseEvent) => {
        // 检测是否实际移动了
        if (mouseStartRef.current) {
          const dx = ev.clientX - mouseStartRef.current.x
          const dy = ev.clientY - mouseStartRef.current.y
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved = true
          }
        }
        ev.preventDefault()
        const rect = flowContainer.getBoundingClientRect()
        const zoom = reactFlowInstance.getZoom()
        const vp = reactFlowInstance.getViewport()

        // 屏幕坐标 → Flow 坐标
        const fx = (ev.clientX - rect.left - vp.x) / zoom
        const fy = (ev.clientY - rect.top - vp.y) / zoom

        // 在曲线上找最近的 t（二次搜索提高精度）
        let bestT = currentPos
        let bestDist = Infinity

        // 粗搜
        for (let t = 0; t <= 1; t += 0.01) {
          const p = bezierPoint(t, sourceX, sourceY, dc1x, dc1y, dc2x, dc2y, targetX, targetY)
          const d = (p.x - fx) ** 2 + (p.y - fy) ** 2
          if (d < bestDist) {
            bestDist = d
            bestT = t
          }
        }
        // 精搜（在最优附近 0.02 范围内）
        const lo = Math.max(0, bestT - 0.02)
        const hi = Math.min(1, bestT + 0.02)
        for (let t = lo; t <= hi; t += 0.001) {
          const p = bezierPoint(t, sourceX, sourceY, dc1x, dc1y, dc2x, dc2y, targetX, targetY)
          const d = (p.x - fx) ** 2 + (p.y - fy) ** 2
          if (d < bestDist) {
            bestDist = d
            bestT = t
          }
        }

        bestT = Math.max(0.05, Math.min(0.95, bestT))

        if (edgeData?.onUpdateLabelPosition) {
          edgeData.onUpdateLabelPosition(id, bestT)
        }
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        // 如果没有移动，视为点击
        if (!hasMoved && edgeData?.onEdgeClick) {
          edgeData.onEdgeClick(id, edgeData.volume, edgeData.volumeUnit)
        }
        mouseStartRef.current = null
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [id, edgeData, reactFlowInstance, sourceX, sourceY, targetX, targetY, edgePath, currentPos]
  )

  // 拖动时禁止画布操作
  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  const labelText = `${Number((edgeData?.volume ?? 0).toFixed(3))} ${edgeData?.volumeUnit ?? 'μL'}`

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="transfer-edge-label"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${pt.x}px, ${pt.y}px)`,
            pointerEvents: 'all',
            cursor: isDragging ? 'grabbing' : 'grab',
            background: 'rgba(255,255,255,0.95)',
            border: `1.5px solid ${isDragging ? '#4f46e5' : '#e2e8f0'}`,
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 12,
            fontWeight: 600,
            color: '#1e293b',
            userSelect: 'none',
            zIndex: isDragging ? 9999 : 10,
            boxShadow: isDragging
              ? '0 2px 8px rgba(79,70,229,0.3)'
              : '0 1px 3px rgba(0,0,0,0.1)',
            transition: isDragging ? 'none' : 'box-shadow 0.15s',
          }}
          onMouseDown={handleMouseDown}
        >
          {labelText}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default TransferEdge
