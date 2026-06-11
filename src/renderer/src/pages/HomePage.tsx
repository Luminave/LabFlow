import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18nStore } from '../stores/i18nStore'
import { useExperimentStore } from '../stores/experimentStore'
import { useThemeStore } from '../stores/themeStore'
import { useFontSizeStore, MIN_SIZE, MAX_SIZE } from '../stores/fontSizeStore'
import { t } from '../i18n/translations'
import styles from './HomePage.module.css'

// 名言/句子数据
const QUOTES = [
  { text: "The important thing in science is not so much to obtain new facts as to discover new ways of thinking about them.", author: "- William Lawrence Bragg" },
  { text: "在科学上没有平坦的大道,只有不畏劳苦沿着陡峭山路攀登的人,才有希望达到光辉的顶点。", author: "- 马克思" },
  { text: "实验是科学之父,实践是理论之母。", author: "- 中国谚语" },
  { text: "The good thing about science is that it's true whether or not you believe in it.", author: "- Neil deGrasse Tyson" },
  { text: "科学研究能破除迷信,因为它鼓励人们根据因果关系来思考和观察事物。", author: "- 爱因斯坦" },
  { text: "In the fields of observation chance favors only the prepared mind.", author: "- Louis Pasteur" },
  { text: "实验室是科学家的摇篮,每一次失败都是成功的预演。", author: "- 佚名" },
  { text: "Nothing in life is to be feared, it is only to be understood. Now is the time to understand more, so that we may fear less.", author: "- Marie Curie" },
  { text: "科学的每一次进步,都始于一个大胆的假设和无数次严谨的实验。", author: "- 佚名" },
  { text: "The greatest enemy of knowledge is not ignorance, it is the illusion of knowledge.", author: "- Daniel J. Boorstin" },
  { text: "真正的科学家应当是个幻想家,谁不是幻想家,谁就只能把自己称为实践家。", author: "- 巴尔扎克" },
  { text: "Research is what I'm doing when I don't know what I'm doing.", author: "- Wernher von Braun" },
  { text: "科学的真正目的,在于用新的发明和发现丰富人类的生活。", author: "- 弗朗西斯·培根" },
  { text: "The art of medicine consists of amusing the patient while nature cures the disease.", author: "- Voltaire" },
  { text: "每一滴试剂都有它的故事,每一个数据都有它的意义。", author: "- 实验室格言" },
]

export default function HomePage() {
  const { language } = useI18nStore()
  const navigate = useNavigate()
  const { experiments, fetchExperiments, createNewExperiment, saveCurrentExperiment } = useExperimentStore()
  const { theme, toggleTheme } = useThemeStore()
  const { fontSize, setFontSize } = useFontSizeStore()

  const [currentTime, setCurrentTime] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)])
  const [easterEgg, setEasterEgg] = useState(false)

  // 加载实验记录
  useEffect(() => {
    fetchExperiments()
  }, [fetchExperiments])

  // 实时时钟
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // 格式化时间
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  // 格式化日期
  const formatDate = (date: Date) => {
    return date.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    })
  }

  // 获取最近的实验(最近保存的5个)
  const recentExperiments = useMemo(() => {
    return [...experiments]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
  }, [experiments])

  // 搜索结果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []

    const query = searchQuery.toLowerCase()
    return experiments.filter(exp =>
      exp.name.toLowerCase().includes(query)
    ).slice(0, 20)
  }, [searchQuery, experiments])

  // 开始新实验
  const handleNewExperiment = () => {
    // 生成今天的日期作为名称
    const now = new Date()
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '') // yymmdd

    // 检查是否已有同名实验
    let experimentName = dateStr
    let counter = 1
    while (experiments.some(e => e.name === experimentName)) {
      counter++
      experimentName = `${dateStr}-${counter}`
    }

    // 创建新实验
    createNewExperiment(experimentName)
    saveCurrentExperiment(experimentName)

    // 跳转到实验页面
    navigate('/experiment')
  }

  // 打开实验
  const handleOpenExperiment = (experimentId: string, status: string) => {
    const store = useExperimentStore.getState()
    store.loadExperiment(experimentId)
    navigate(`/experiment/${experimentId}`)
  }

  // 跳转到实验记录页面并加载指定实验
  const handleGoToHistory = (experimentId?: string) => {
    if (experimentId) {
      // 先加载实验,然后跳转到实验页面查看
      const store = useExperimentStore.getState()
      store.loadExperiment(experimentId)
      navigate(`/experiment/${experimentId}`)
    } else {
      navigate('/history')
    }
  }

  return (
    <div className={styles.container}>
      {/* 彩蛋按钮 */}
      <button
        className={styles.easterEggBtn}
        onClick={() => setEasterEgg(!easterEgg)}
        title="26"
      >
        26
      </button>

      {/* 主题和字号控制区 */}
      <div className={styles.topControls}>
        {/* 捐赠按钮 */}
        <a
          href="https://afdian.tv/a/sailfire"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.donateBtn}
          title={language === 'zh' ? '如果这帮到了你,可以给我捐赠一杯咖啡吗 ☕' : 'If this helped you, could you buy me a coffee? ☕'}
        >
          ☕
        </a>

        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          title={theme === 'light' ? (language === 'zh' ? '切换到深色模式' : 'Switch to Dark Mode') : (language === 'zh' ? '切换到浅色模式' : 'Switch to Light Mode')}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>

        <div className={styles.fontSizeControl}>
          <span className={styles.fontSizeLabel}>A</span>
          <input
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
            className={styles.fontSizeSlider}
            title={`${fontSize}px`}
          />
          <span className={styles.fontSizeLabelLarge}>A</span>
          <span className={styles.fontSizeValue}>{fontSize}px</span>
        </div>
      </div>

      {/* 标题区域 */}
      <header className={styles.header}>
        <div className={styles.logoArea}>
          <span className={styles.logoIcon}>🧪</span>
          <h1 className={`${styles.title} ${easterEgg ? styles.titleEasterEgg : ''}`}>LabFlow</h1>
        </div>
        <p className={styles.subtitle}>
          {easterEgg
            ? 'Mamba Never Out'
            : (language === 'zh' ? '实验室试剂管理系统' : 'Lab Reagent Management System')}
        </p>
      </header>

      {/* 时钟区域 */}
      <div className={styles.clockSection}>
        <div className={styles.time}>{formatTime(currentTime)}</div>
        <div className={styles.date}>{formatDate(currentTime)}</div>
      </div>

      {/* 搜索框 */}
      <div className={styles.searchSection}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={language === 'zh' ? '搜索保存的工程和实验记录...' : 'Search saved projects and experiments...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className={styles.clearBtn} onClick={() => setSearchQuery('')}>
              ✕
            </button>
          )}
        </div>

        {/* 搜索结果 */}
        {searchQuery.trim() && (
          <div className={styles.searchResults}>
            {searchResults.length === 0 ? (
              <div className={styles.noResults}>
                {language === 'zh' ? '未找到匹配的记录' : 'No matching records found'}
              </div>
            ) : (
              <div className={styles.resultsList}>
                {searchResults.map(exp => (
                  <div key={exp.id} className={styles.resultItem}>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultName}>{exp.name}</span>
                      <span className={styles.resultStatus}>
                        {exp.status === 'completed' 
                          ? (language === 'zh' ? '✅ 已完成' : '✅ Completed')
                          : exp.status === 'reverted'
                          ? (language === 'zh' ? '↩️ 已回退' : '↩️ Reverted')
                          : (language === 'zh' ? '📝 草稿' : '📝 Draft')}
                      </span>
                    </div>
                    <button
                      className={styles.openBtn}
                      onClick={() => handleOpenExperiment(exp.id, exp.status)}
                    >
                      {language === 'zh' ? '打开' : 'Open'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 主要功能按钮 */}
      <div className={styles.actionSection}>
        <button className={`${styles.actionBtn} ${styles.actionBtnGreen}`} onClick={handleNewExperiment}>
          <span className={styles.actionIcon}>▶️</span>
          <span className={styles.actionText}>
            {language === 'zh' ? '开始新实验' : 'New Experiment'}
          </span>
        </button>

        <button className={`${styles.actionBtn} ${styles.actionBtnPurple}`} onClick={() => navigate('/history')}>
          <span className={styles.actionIcon}>📋</span>
          <span className={styles.actionText}>
            {language === 'zh' ? '实验记录' : 'History'}
          </span>
        </button>

        <button className={`${styles.actionBtn} ${styles.actionBtnOrange}`} onClick={() => navigate('/warehouse')}>
          <span className={styles.actionIcon}>📦</span>
          <span className={styles.actionText}>
            {language === 'zh' ? '试剂仓库' : 'Warehouse'}
          </span>
        </button>
      </div>

      {/* 最近工程和实验记录 */}
      <div className={styles.recentSection}>
        <h2 className={styles.sectionTitle}>
          {language === 'zh' ? '📅 最近工程和实验记录' : '📅 Recent Projects & Experiments'}
        </h2>

        {recentExperiments.length === 0 ? (
          <div className={styles.emptyRecent}>
            {language === 'zh' ? '暂无实验记录,开始你的第一个实验吧!' : 'No experiments yet. Start your first experiment!'}
          </div>
        ) : (
          <div className={styles.recentList}>
            {recentExperiments.map(exp => (
              <div key={exp.id} className={styles.recentItem}>
                <div className={styles.recentInfo}>
                  <span className={styles.recentName}>{exp.name}</span>
                  <span className={styles.recentTime}>
                    {new Date(exp.updatedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                <div className={styles.recentStatus}>
                  <span className={`${styles.statusBadge} ${exp.status === 'completed' ? styles.statusCompleted : exp.status === 'reverted' ? styles.statusReverted : styles.statusDraft}`}>
                    {exp.status === 'completed'
                      ? (language === 'zh' ? '已完成' : 'Completed')
                      : exp.status === 'reverted'
                      ? (language === 'zh' ? '已回退' : 'Reverted')
                      : (language === 'zh' ? '草稿' : 'Draft')}
                  </span>
                  <button
                    className={styles.recentOpenBtn}
                    onClick={() => handleGoToHistory(exp.id)}
                  >
                    {language === 'zh' ? '打开' : 'Open'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <footer className={styles.footer}>
        <blockquote className={styles.quote}>
          <p className={styles.quoteText}>"{quote.text}"</p>
          <cite className={styles.quoteAuthor}>{quote.author}</cite>
        </blockquote>

        <div className={styles.credits}>
          <p>
            Author: <a href="https://github.com/Luminave" target="_blank" rel="noopener noreferrer">Victor.G</a> |
            Powered by <a href="https://docs.openclaw.ai" target="_blank" rel="noopener noreferrer">OpenClaw</a> |
            Model: <a href="https://platform.xiaomimimo.com/" target="_blank" rel="noopener noreferrer">mimo-v2-pro</a>
          </p>
          <p className={styles.motto}>
            "Pessimists are always right, optimists always move forward."
          </p>
        </div>
      </footer>
    </div>
  )
}
