import { useState, useEffect, useMemo } from 'react'
import { useExperimentStore } from '../stores/experimentStore'
import styles from './NarratorPage.module.css'

interface NarratorTube {
  id: string
  name: string
  volume: number
  volumeUnit: string
  order: number
}

export default function NarratorPage() {
  const { experiments, fetchExperiments } = useExperimentStore()
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>('')
  const [narratorTubes, setNarratorTubes] = useState<NarratorTube[]>([])
  const [narratedSteps, setNarratedSteps] = useState<string>('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // 加载实验数据
  useEffect(() => {
    fetchExperiments()
  }, [fetchExperiments])

  // 可用的实验列表（草稿和已完成的都可以选择）
  const availableExperiments = useMemo(() =>
    experiments.filter(e => e.status === 'completed' || e.status === 'draft'),
    [experiments]
  )

  // 选择实验后，提取中间产物试管（排除作为原料的）
  useEffect(() => {
    if (!selectedExperimentId) {
      setNarratorTubes([])
      setNarratedSteps('')
      return
    }

    const experiment = experiments.find(e => e.id === selectedExperimentId)
    if (!experiment) return

    // 筛选中间产物且不是作为原料的试管
    const filteredTubes = experiment.tubes
      .filter(tube => tube.type === 'intermediate' && !tube.asSource)
      .map((tube, index) => ({
        id: tube.id,
        name: tube.name,
        volume: tube.remainingVolume,
        volumeUnit: tube.remainingVolumeUnit,
        order: index
      }))

    setNarratorTubes(filteredTubes)
    setNarratedSteps('')
  }, [selectedExperimentId, experiments])

  // 拖拽排序
  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      return
    }

    const newTubes = [...narratorTubes]
    const [draggedTube] = newTubes.splice(draggedIndex, 1)
    newTubes.splice(targetIndex, 0, draggedTube)

    setNarratorTubes(newTubes.map((tube, i) => ({ ...tube, order: i })))
    setDraggedIndex(null)
    setNarratedSteps('')
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  // 上移/下移按钮
  const moveTube = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= narratorTubes.length) return

    const newTubes = [...narratorTubes]
    const temp = newTubes[index]
    newTubes[index] = newTubes[newIndex]
    newTubes[newIndex] = temp

    setNarratorTubes(newTubes.map((tube, i) => ({ ...tube, order: i })))
    setNarratedSteps('')
  }

  // 生成讲述步骤
  const generateNarration = () => {
    if (!selectedExperimentId || narratorTubes.length === 0) {
      setNarratedSteps('请先选择实验并选择试管')
      return
    }

    const experiment = experiments.find(e => e.id === selectedExperimentId)
    if (!experiment) return

    const connections = experiment.connections
    const tubes = experiment.tubes
    const steps: string[] = []

    // 按照用户排列的试管顺序生成步骤
    narratorTubes.forEach((narratorTube, stepIndex) => {
      // 找到所有移入这个试管的连接，按体积从大到小排序
      const incomingConnections = connections
        .filter(conn => conn.toTubeId === narratorTube.id)
        .sort((a, b) => b.volume - a.volume) // 大体积优先

      if (incomingConnections.length === 0) return

      // 计算总体积和各成分浓度
      let totalVolume = 0
      const substanceMap = new Map<string, { name: string; totalAmount: number; unit: string }>()

      incomingConnections.forEach(conn => {
        const sourceTube = tubes.find(t => t.id === conn.fromTubeId)
        if (!sourceTube) return

        totalVolume += conn.volume

        // 累计各成分
        sourceTube.substances.forEach(sub => {
          // 移入的量 = 源试管浓度 × 移液体积
          const amount = sub.concentration * conn.volume
          const existing = substanceMap.get(sub.name)
          if (existing) {
            existing.totalAmount += amount
          } else {
            substanceMap.set(sub.name, {
              name: sub.name,
              totalAmount: amount,
              unit: sub.concentrationUnit
            })
          }
        })
      })

      // 计算最终浓度
      const substanceInfo: string[] = []
      substanceMap.forEach(sub => {
        if (totalVolume > 0) {
          const finalConcentration = sub.totalAmount / totalVolume
          // 格式化浓度显示
          let concStr = ''
          if (finalConcentration >= 1) {
            concStr = `${finalConcentration.toFixed(1)}${sub.unit}`
          } else if (finalConcentration >= 0.001) {
            concStr = `${(finalConcentration * 1000).toFixed(1)}n${sub.unit.substring(1)}`
          } else {
            concStr = `${finalConcentration.toFixed(4)}${sub.unit}`
          }
          substanceInfo.push(`${concStr} ${sub.name}`)
        }
      })

      // Step 标题
      const volumeStr = `${totalVolume}μL`
      const substancesStr = substanceInfo.length > 0 ? substanceInfo.join(';') : '空'
      steps.push(`Step${stepIndex + 1}: ${narratorTube.name}   ${volumeStr}   (${substancesStr})`)

      // 小步骤（已按体积从大到小排序）
      incomingConnections.forEach((conn, lineIndex) => {
        const sourceTube = tubes.find(t => t.id === conn.fromTubeId)
        if (sourceTube) {
          steps.push(`(${lineIndex + 1}) ${sourceTube.name}→${conn.volume} μL→${narratorTube.name}`)
        }
      })

      steps.push('') // 空行分隔
    })

    setNarratedSteps(steps.join('\n').trim())
  }

  // 格式化体积显示
  const formatVolume = (volume: number, unit: string) => {
    const unitLabel = unit === 'μL' ? 'μL' : unit === 'mL' ? 'mL' : unit
    return `${volume} ${unitLabel}`
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>📖 讲述者</h1>
        <p className={styles.subtitle}>选择实验，排列试管顺序，生成实验操作步骤</p>
      </header>

      <div className={styles.content}>
        {/* 实验选择区域 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>1. 选择实验工程</h2>
          <select
            className={styles.select}
            value={selectedExperimentId}
            onChange={e => setSelectedExperimentId(e.target.value)}
          >
            <option value="">-- 请选择实验 --</option>
            {availableExperiments.map(exp => (
              <option key={exp.id} value={exp.id}>
                {exp.name} [{exp.status === 'completed' ? '已完成' : '草稿'}] ({exp.completedAt ? new Date(exp.completedAt).toLocaleDateString('zh-CN') : new Date(exp.updatedAt).toLocaleDateString('zh-CN')})
              </option>
            ))}
          </select>
        </div>

        {/* 试管列表区域 */}
        {selectedExperimentId && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>2. 调整试管顺序</h2>
            {narratorTubes.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>🧪</div>
                <p>该实验没有中间产物试管</p>
              </div>
            ) : (
              <div className={styles.tubeList}>
                {narratorTubes.map((tube, index) => (
                  <div
                    key={tube.id}
                    className={`${styles.tubeCard} ${draggedIndex === index ? styles.dragging : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className={styles.tubeOrder}>{index + 1}</div>
                    <div className={styles.tubeInfo}>
                      <div className={styles.tubeName}>{tube.name}</div>
                      <div className={styles.tubeVolume}>
                        体积: {formatVolume(tube.volume, tube.volumeUnit)}
                      </div>
                    </div>
                    <div className={styles.tubeActions}>
                      <button
                        className={styles.moveBtn}
                        onClick={() => moveTube(index, 'up')}
                        disabled={index === 0}
                        title="上移"
                      >
                        ⬆️
                      </button>
                      <button
                        className={styles.moveBtn}
                        onClick={() => moveTube(index, 'down')}
                        disabled={index === narratorTubes.length - 1}
                        title="下移"
                      >
                        ⬇️
                      </button>
                    </div>
                    <div className={styles.dragHandle}>⠿</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 讲述按钮 */}
        {selectedExperimentId && narratorTubes.length > 0 && (
          <div className={styles.section}>
            <button className={styles.narrateBtn} onClick={generateNarration}>
              📖 讲述
            </button>
          </div>
        )}

        {/* 讲述结果 */}
        {narratedSteps && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>实验操作步骤</h2>
            <div className={styles.stepsOutput}>
              <pre className={styles.stepsText}>{narratedSteps}</pre>
              <button
                className={styles.copyBtn}
                onClick={() => navigator.clipboard.writeText(narratedSteps)}
              >
                📋 复制
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
