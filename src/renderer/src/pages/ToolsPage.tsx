import { useState, useMemo, useCallback } from 'react'
import { useI18nStore } from '../stores/i18nStore'
import styles from './ToolsPage.module.css'

// DNA/RNA 碱基互补配对
const DNA_COMPLEMENT: Record<string, string> = {
  'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G',
  'a': 't', 't': 'a', 'g': 'c', 'c': 'g'
}

const RNA_COMPLEMENT: Record<string, string> = {
  'A': 'U', 'U': 'A', 'G': 'C', 'C': 'G',
  'a': 'u', 'u': 'a', 'g': 'c', 'c': 'g'
}

// 分子量 (g/mol)
const DNA_MW: Record<string, number> = {
  'A': 313.21, 'T': 304.20, 'G': 329.21, 'C': 289.18
}

const RNA_MW: Record<string, number> = {
  'A': 329.21, 'U': 306.17, 'G': 345.21, 'C': 305.18
}

// 碱基数目统计
interface BaseCount {
  A: number
  T: number
  G: number
  C: number
  U: number
}

export default function ToolsPage() {
  const { language } = useI18nStore()
  
  // 核酸链计算器状态
  const [chainType, setChainType] = useState<'DNA' | 'RNA'>('DNA')
  const [inputSequence, setInputSequence] = useState('')
  const [reverse, setReverse] = useState(false)
  const [complement, setComplement] = useState(false)
  const [swapType, setSwapType] = useState(false)
  const [copied, setCopied] = useState(false)
  
  // 验证输入序列
  const validateSequence = useCallback((seq: string, type: 'DNA' | 'RNA'): { valid: boolean; error: string } => {
    if (!seq.trim()) {
      return { valid: false, error: '' }
    }
    
    const upperSeq = seq.toUpperCase()
    
    if (type === 'DNA') {
      // DNA 不允许 U
      if (upperSeq.includes('U')) {
        return { 
          valid: false, 
          error: language === 'zh' ? '❌ DNA 链不应包含碱基 U' : '❌ DNA should not contain U' 
        }
      }
      // 只允许 A, T, G, C
      const invalidChars = upperSeq.replace(/[ATGC]/g, '')
      if (invalidChars.length > 0) {
        return { 
          valid: false, 
          error: language === 'zh' 
            ? `❌ 包含无效字符: ${[...new Set(invalidChars)].join(', ')}` 
            : `❌ Invalid characters: ${[...new Set(invalidChars)].join(', ')}`
        }
      }
    } else {
      // RNA 不允许 T
      if (upperSeq.includes('T')) {
        return { 
          valid: false, 
          error: language === 'zh' ? '❌ RNA 链不应包含碱基 T' : '❌ RNA should not contain T'
        }
      }
      // 只允许 A, U, G, C
      const invalidChars = upperSeq.replace(/[AUGC]/g, '')
      if (invalidChars.length > 0) {
        return { 
          valid: false, 
          error: language === 'zh' 
            ? `❌ 包含无效字符: ${[...new Set(invalidChars)].join(', ')}` 
            : `❌ Invalid characters: ${[...new Set(invalidChars)].join(', ')}`
        }
      }
    }
    
    return { valid: true, error: '' }
  }, [language])
  
  // 处理输出序列
  const { outputSequence, outputType, validation, stats, molecularWeight } = useMemo(() => {
    const validation = validateSequence(inputSequence, chainType)
    
    if (!validation.valid || !inputSequence.trim()) {
      return { 
        outputSequence: '', 
        outputType: chainType,
        validation, 
        stats: { A: 0, T: 0, G: 0, C: 0, U: 0 } as BaseCount,
        molecularWeight: 0
      }
    }
    
    let result = inputSequence
    let resultType = chainType
    
    // 交换核酸链类型
    if (swapType) {
      resultType = chainType === 'DNA' ? 'RNA' : 'DNA'
    }
    
    // 互补
    if (complement) {
      const complementMap = chainType === 'DNA' ? DNA_COMPLEMENT : RNA_COMPLEMENT
      result = result.split('').map(base => complementMap[base] || base).join('')
    }
    
    // 反向（在互补之后，这样可以正确处理小写字母位置）
    if (reverse) {
      result = result.split('').reverse().join('')
    }
    
    // 如果交换了类型，需要转换碱基
    if (swapType && !complement) {
      if (chainType === 'DNA' && resultType === 'RNA') {
        result = result.replace(/[Tt]/g, (m) => m === 'T' ? 'U' : 'u')
      } else if (chainType === 'RNA' && resultType === 'DNA') {
        result = result.replace(/[Uu]/g, (m) => m === 'U' ? 'T' : 't')
      }
    } else if (swapType && complement) {
      // 交换类型 + 互补时，互补已经处理了碱基，但类型转换也要正确
      if (chainType === 'DNA' && resultType === 'RNA') {
        result = result.replace(/[Tt]/g, (m) => m === 'T' ? 'U' : 'u')
      } else if (chainType === 'RNA' && resultType === 'DNA') {
        result = result.replace(/[Uu]/g, (m) => m === 'U' ? 'T' : 't')
      }
    }
    
    // 计算碱基统计（基于原始序列）
    const upperInput = inputSequence.toUpperCase()
    const stats: BaseCount = { A: 0, T: 0, G: 0, C: 0, U: 0 }
    for (const base of upperInput) {
      if (base in stats) {
        stats[base as keyof BaseCount]++
      }
    }
    
    // 计算分子量（基于原始序列，加上磷酸骨架的贡献）
    const mwMap = chainType === 'DNA' ? DNA_MW : RNA_MW
    let mw = 0
    const seqLength = upperInput.replace(/[^ATUGC]/g, '').length
    for (const base of upperInput) {
      if (base in mwMap) {
        mw += mwMap[base as keyof typeof mwMap]
      }
    }
    // 减去磷酸二酯键形成时失去的水分子 (n-1 个 H2O)
    if (seqLength > 1) {
      mw -= (seqLength - 1) * 18.015
    }
    // 加上 5' 端的 H 和 3' 端的 OH
    mw += 1.008 + 17.007
    
    return { outputSequence: result, outputType: resultType, validation, stats, molecularWeight: mw }
  }, [inputSequence, chainType, reverse, complement, swapType, validateSequence])
  
  // 复制到剪贴板
  const handleCopy = async () => {
    if (!outputSequence) return
    
    try {
      await navigator.clipboard.writeText(outputSequence)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }
  
  // 碱基数目统计显示
  const statsDisplay = useMemo(() => {
    const items = []
    if (stats.A > 0) items.push(`A: ${stats.A}`)
    if (stats.T > 0) items.push(`T: ${stats.T}`)
    if (stats.G > 0) items.push(`G: ${stats.G}`)
    if (stats.C > 0) items.push(`C: ${stats.C}`)
    if (stats.U > 0) items.push(`U: ${stats.U}`)
    return items
  }, [stats])
  
  // 序列长度
  const seqLength = inputSequence.replace(/[^ATUGCatugc]/g, '').length

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {language === 'zh' ? '小工具' : 'Tools'}
        </h1>
        <p className={styles.subtitle}>
          {language === 'zh' 
            ? '⚠️ 小工具页面不保存数据，仅供实时计算使用' 
            : '⚠️ Tools page does not save data, for real-time use only'}
        </p>
      </header>

      <div className={styles.content}>
        {/* 核酸链计算器 */}
        <div className={styles.toolCard}>
          <h2 className={styles.toolTitle}>
            🧬 {language === 'zh' ? '核酸链计算器' : 'Nucleic Acid Calculator'}
          </h2>
          
          {/* 核酸链类型选择 */}
          <div className={styles.typeSelector}>
            <label className={styles.typeLabel}>
              {language === 'zh' ? '核酸链类型：' : 'Chain Type:'}
            </label>
            <div className={styles.typeButtons}>
              <button
                className={`${styles.typeBtn} ${chainType === 'DNA' ? styles.typeBtnActive : ''}`}
                onClick={() => setChainType('DNA')}
              >
                DNA
              </button>
              <button
                className={`${styles.typeBtn} ${chainType === 'RNA' ? styles.typeBtnActive : ''}`}
                onClick={() => setChainType('RNA')}
              >
                RNA
              </button>
            </div>
            <span className={styles.directionHint}>
              {language === 'zh' ? '输入方向：5′→3′' : 'Input direction: 5′→3′'}
            </span>
          </div>
          
          {/* 输入框 */}
          <div className={styles.inputSection}>
            <label className={styles.inputLabel}>
              {language === 'zh' ? '输入序列：' : 'Input Sequence:'}
            </label>
            <textarea
              className={styles.sequenceInput}
              placeholder={language === 'zh' 
                ? `请输入 ${chainType} 序列 (5′→3′)...` 
                : `Enter ${chainType} sequence (5′→3′)...`}
              value={inputSequence}
              onChange={(e) => setInputSequence(e.target.value)}
              rows={4}
            />
            {validation.error && (
              <div className={styles.errorMsg}>{validation.error}</div>
            )}
          </div>
          
          {/* 操作按钮 */}
          <div className={styles.actionButtons}>
            <button
              className={`${styles.actionBtn} ${reverse ? styles.actionBtnActive : ''}`}
              onClick={() => setReverse(!reverse)}
            >
              🔄 {language === 'zh' ? '反向' : 'Reverse'}
            </button>
            <button
              className={`${styles.actionBtn} ${complement ? styles.actionBtnActive : ''}`}
              onClick={() => setComplement(!complement)}
            >
              🔀 {language === 'zh' ? '互补' : 'Complement'}
            </button>
            <button
              className={`${styles.actionBtn} ${swapType ? styles.actionBtnActive : ''}`}
              onClick={() => setSwapType(!swapType)}
            >
              🔁 {language === 'zh' ? '交换核酸链类型' : 'Swap Type'}
            </button>
          </div>
          
          {/* 输出 */}
          {outputSequence && validation.valid && (
            <div className={styles.outputSection}>
              <label className={styles.outputLabel}>
                {language === 'zh' ? '输出序列：' : 'Output Sequence:'}
                <span className={styles.outputType}>
                  ({outputType}, {language === 'zh' ? (reverse ? '反向' : '正向') : (reverse ? 'Reverse' : 'Forward')}{complement ? (language === 'zh' ? ', 互补' : ', Complement') : ''})
                </span>
              </label>
              <div className={styles.outputBox}>
                <pre className={styles.outputSequence}>5′-{outputSequence}-3′</pre>
                <button 
                  className={styles.copyBtn}
                  onClick={handleCopy}
                  title={language === 'zh' ? '复制' : 'Copy'}
                >
                  {copied ? '✅' : '📋'}
                </button>
              </div>
            </div>
          )}
          
          {/* 统计信息 */}
          {inputSequence.trim() && validation.valid && (
            <div className={styles.statsSection}>
              <h3>{language === 'zh' ? '📊 序列信息' : '📊 Sequence Info'}</h3>
              <div className={styles.statsGrid}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>
                    {language === 'zh' ? '碱基数目' : 'Length'}
                  </span>
                  <span className={styles.statValue}>{seqLength}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>
                    {language === 'zh' ? '分子量' : 'Mol. Weight'}
                  </span>
                  <span className={styles.statValue}>{molecularWeight.toFixed(2)} g/mol</span>
                </div>
              </div>
              {statsDisplay.length > 0 && (
                <div className={styles.baseCount}>
                  <span className={styles.baseCountLabel}>
                    {language === 'zh' ? '碱基统计：' : 'Base Count:'}
                  </span>
                  <div className={styles.baseCountItems}>
                    {statsDisplay.map(item => (
                      <span key={item} className={styles.baseCountItem}>{item}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* 后续小工具位置预留 */}
        {/* <div className={styles.toolCard}>
          <h2 className={styles.toolTitle}>
            🔧 {language === 'zh' ? '更多工具即将推出' : 'More tools coming soon'}
          </h2>
        </div> */}
      </div>
    </div>
  )
}
