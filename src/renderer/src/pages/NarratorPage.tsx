import { useState, useEffect, useMemo } from 'react'
import { useExperimentStore } from '../stores/experimentStore'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import styles from './NarratorPage.module.css'

export default function NarratorPage() {
  const { experiments, fetchExperiments } = useExperimentStore()
  const { language } = useI18nStore()
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>('')
  const [narratedSteps, setNarratedSteps] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [useTubeNumber, setUseTubeNumber] = useState(false) // 使用管号替代试管名称

  // 加载实验数据
  useEffect(() => {
    fetchExperiments()
  }, [fetchExperiments])

  // 可用的实验列表（草稿和已完成的都可以选择）
  const availableExperiments = useMemo(() =>
    experiments.filter(e => e.status === 'completed' || e.status === 'draft'),
    [experiments]
  )

  // 按配置序号排序的中间产物试管
  const sortedTubes = useMemo(() => {
    if (!selectedExperimentId) return []

    const experiment = experiments.find(e => e.id === selectedExperimentId)
    if (!experiment) return []

    // 筛选中间产物且不是作为原料的试管
    const filteredTubes = experiment.tubes
      .filter(tube => tube.type === 'intermediate' && !tube.asSource)

    // 按配置序号排序（有序号的在前，无序号的在后）
    return filteredTubes.sort((a, b) => {
      const orderA = a.configOrder || 999999
      const orderB = b.configOrder || 999999
      return orderA - orderB
    })
  }, [selectedExperimentId, experiments])

  // 获取试管显示名称（管号或名称）
  const getDisplayName = (tube: { name: string; tubeNumber?: string }) => {
    if (useTubeNumber && tube.tubeNumber) {
      // 确保管号以#开头
      return tube.tubeNumber.startsWith('#') ? tube.tubeNumber : '#' + tube.tubeNumber
    }
    return tube.name
  }

  // 选择实验后自动生成讲述
  useEffect(() => {
    if (selectedExperimentId && sortedTubes.length > 0) {
      generateNarration()
    } else {
      setNarratedSteps('')
    }
  }, [selectedExperimentId, sortedTubes, useTubeNumber])

  // 生成讲述步骤
  const generateNarration = () => {
    if (!selectedExperimentId || sortedTubes.length === 0) {
      setNarratedSteps('')
      return
    }

    const experiment = experiments.find(e => e.id === selectedExperimentId)
    if (!experiment) return

    const connections = experiment.connections
    const tubes = experiment.tubes
    const steps: string[] = []

    // 按配置序号排序的试管顺序生成步骤
    sortedTubes.forEach((narratorTube, stepIndex) => {
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
      const substancesStr = substanceInfo.length > 0 ? substanceInfo.join(';') : (language === 'zh' ? '空' : 'Empty')
      steps.push(`Step${stepIndex + 1}: ${getDisplayName(narratorTube)}   ${volumeStr}   (${substancesStr})`)

      // 小步骤（已按体积从大到小排序）
      incomingConnections.forEach((conn, lineIndex) => {
        const sourceTube = tubes.find(t => t.id === conn.fromTubeId)
        if (sourceTube) {
          steps.push(`(${lineIndex + 1}) ${getDisplayName(sourceTube)}→${conn.volume} μL→${getDisplayName(narratorTube)}`)
        }
      })

      steps.push('') // 空行分隔
    })

    setNarratedSteps(steps.join('\n').trim())
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>📖 {t('nav.narrator', language)}</h1>
        <p className={styles.subtitle}>{language === 'zh' ? '选择实验工程，按配置序号生成实验操作步骤' : 'Select project, generate steps by config order'}</p>
        <p className={styles.hint}>💡 {language === 'zh' ? '提示：回退的工程需要另存为新工程之后才能使用讲述者' : 'Tip: Reverted projects must be saved as new before using Narrator'}</p>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={useTubeNumber}
            onChange={e => setUseTubeNumber(e.target.checked)}
          />
          {language === 'zh' ? '使用管号' : 'Use Tube Number'}
        </label>
      </header>

      <div className={styles.content}>
        {/* 实验选择区域 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>1. {language === 'zh' ? '选择实验工程' : 'Select Project'}</h2>
          <select
            className={styles.select}
            value={selectedExperimentId}
            onChange={e => setSelectedExperimentId(e.target.value)}
          >
            <option value="">-- {language === 'zh' ? '请选择实验' : 'Select Experiment'} --</option>
            {availableExperiments.map(exp => (
              <option key={exp.id} value={exp.id}>
                {exp.name} [{exp.status === 'completed' ? t('status.completed', language) : t('status.draft', language)}] ({exp.completedAt ? new Date(exp.completedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US') : new Date(exp.updatedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')})
              </option>
            ))}
          </select>
        </div>

        {/* 试管列表显示 */}
        {selectedExperimentId && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>2. {language === 'zh' ? '试管配置顺序' : 'Tube Config Order'}</h2>
            {sortedTubes.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>🧪</div>
                <p>{language === 'zh' ? '该实验没有中间产物试管' : 'No intermediate tubes in this experiment'}</p>
                <p className={styles.hint}>{language === 'zh' ? '请先在实验模拟中配置试管的"配置序号"' : 'Please set "Config Order" in Experiment first'}</p>
              </div>
            ) : (
              <>
                <div className={styles.tubeList}>
                  {sortedTubes.map((tube, index) => (
                    <div key={tube.id} className={styles.tubeCard}>
                      <div className={styles.tubeOrder}>
                        {tube.configOrder || '?'}
                      </div>
                      <div className={styles.tubeInfo}>
                        <div className={styles.tubeName}>{tube.name}</div>
                        <div className={styles.tubeVolume}>
                          {language === 'zh' ? '序号:' : 'Order:'} {tube.configOrder || (language === 'zh' ? '未设置' : 'Not Set')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {!sortedTubes.every(t => t.configOrder) && (
                  <p className={styles.warning}>⚠️ {language === 'zh' ? '部分试管未设置配置序号，请在实验模拟中补充' : 'Some tubes missing config order, please set in Experiment'}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* 讲述结果 */}
        {narratedSteps && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{language === 'zh' ? '实验操作步骤' : 'Experiment Steps'}</h2>
            <div className={styles.stepsOutput}>
              <pre className={styles.stepsText}>{narratedSteps}</pre>
              <button
                className={styles.copyBtn}
                onClick={() => {
                  navigator.clipboard.writeText(narratedSteps)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? `✅ ${language === 'zh' ? '已复制' : 'Copied'}` : `📋 ${language === 'zh' ? '复制' : 'Copy'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
