import { useState, useEffect } from 'react'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { useI18nStore } from '../stores/i18nStore'
import { t } from '../i18n/translations'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const { colors, setColor, removeColor, loadColors } = useSubstanceColorStore()
  const { language } = useI18nStore()
  const [newSubstance, setNewSubstance] = useState('')
  const [newColor, setNewColor] = useState('#1e293b')
  const [newBgColor, setNewBgColor] = useState('#fef08a')
  const [editingName, setEditingName] = useState<string | null>(null)
  
  useEffect(() => {
    loadColors()
  }, [loadColors])
  
  const handleAddColor = () => {
    if (!newSubstance.trim()) {
      alert('请输入成分名称')
      return
    }
    setColor(newSubstance.trim(), newColor, newBgColor)
    setNewSubstance('')
    setNewColor('#1e293b')
    setNewBgColor('#fef08a')
  }
  
  const handleUpdateColor = (name: string, color: string, bgColor: string) => {
    setColor(name, color, bgColor)
    setEditingName(null)
  }
  
  const handleDeleteColor = (name: string) => {
    if (confirm(`${language === 'zh' ? '确定删除' : 'Delete color config for'} "${name}"?`)) {
      removeColor(name)
    }
  }
  
  // 清除所有数据
  const handleClearAllData = () => {
    if (confirm(language === 'zh' ? '⚠️ 警告：此操作将清除所有数据！\n\n包括：\n- 所有试管数据\n- 所有实验记录\n- 所有试管历史\n- 所有颜色配置\n\n此操作不可恢复！' : '⚠️ Warning: This will clear ALL data!\n\nIncluding:\n- All tube data\n- All experiment records\n- All tube history\n- All color configs\n\nThis cannot be undone!')) {
      if (confirm(language === 'zh' ? '再次确认：真的要清除所有数据吗？\n\n这将删除所有记录，无法恢复！' : 'Confirm again: Really clear ALL data?\n\nThis will delete everything, cannot be undone!')) {
        // 清除 localStorage
        localStorage.removeItem('labflow_tubes')
        localStorage.removeItem('labflow_current_experiment')
        localStorage.removeItem('labflow_experiments')
        localStorage.removeItem('labflow_tube_histories')
        localStorage.removeItem('substance_colors')
        
        // 清除数据库
        if (window.electronAPI) {
          // 重新加载页面
          window.location.reload()
        } else {
          window.location.reload()
        }
      }
    }
  }
  
  // 预设颜色选项
  const presetBgColors = [
    { name: language === 'zh' ? '黄色' : 'Yellow', value: '#fef08a' },
    { name: language === 'zh' ? '青色' : 'Cyan', value: '#a5f3fc' },
    { name: language === 'zh' ? '紫色' : 'Purple', value: '#c4b5fd' },
    { name: language === 'zh' ? '红色' : 'Red', value: '#fca5a5' },
    { name: language === 'zh' ? '绿色' : 'Green', value: '#86efac' },
    { name: language === 'zh' ? '橙色' : 'Orange', value: '#fdba74' },
    { name: language === 'zh' ? '粉色' : 'Pink', value: '#fbcfe8' },
    { name: language === 'zh' ? '蓝色' : 'Blue', value: '#93c5fd' },
    { name: language === 'zh' ? '灰色' : 'Gray', value: '#e2e8f0' },
  ]
  
  const colorList = Array.from(colors.values())
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('settings.title', language)}</h1>
        <p className={styles.subtitle}>{language === 'zh' ? '为成分指定颜色，将在所有界面中高亮显示' : 'Assign colors to substances, shown across all views'}</p>
      </header>
      
      <div className={styles.content}>
        {/* 添加新颜色 */}
        <div className={styles.addSection}>
          <h3>{language === 'zh' ? '添加新成分颜色' : 'Add New Substance Color'}</h3>
          <div className={styles.addRow}>
            <input
              type="text"
              placeholder={language === 'zh' ? '成分名称（如 E1、DNA）' : 'Substance name (e.g. E1, DNA)'}
              value={newSubstance}
              onChange={(e) => setNewSubstance(e.target.value)}
              className={styles.input}
            />
            <div className={styles.colorPicker}>
              <label>{language === 'zh' ? '文字色' : 'Text Color'}</label>
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
            </div>
            <div className={styles.colorPicker}>
              <label>{language === 'zh' ? '背景色' : 'Background Color'}</label>
              <input
                type="color"
                value={newBgColor}
                onChange={(e) => setNewBgColor(e.target.value)}
              />
            </div>
            <button className={styles.addBtn} onClick={handleAddColor}>
              {language === 'zh' ? '添加' : 'Add'}
            </button>
          </div>
          
          {/* 预设背景色 */}
          <div className={styles.presets}>
            <span>{language === 'zh' ? '快速选择背景色：' : 'Quick select background:'}</span>
            {presetBgColors.map(preset => (
              <button
                key={preset.value}
                className={styles.presetBtn}
                style={{ backgroundColor: preset.value }}
                onClick={() => setNewBgColor(preset.value)}
                title={preset.name}
              />
            ))}
          </div>
        </div>
        
        {/* 已配置的颜色列表 */}
        <div className={styles.colorList}>
          <h3>{language === 'zh' ? '已配置的颜色' : 'Configured Colors'} ({colorList.length})</h3>
          
          {colorList.length === 0 ? (
            <p className={styles.empty}>{language === 'zh' ? '暂无颜色配置' : 'No color configurations'}</p>
          ) : (
            <div className={styles.list}>
              {colorList.map(item => (
                <div key={item.name} className={styles.colorItem}>
                  {editingName === item.name ? (
                    // 编辑模式
                    <div className={styles.editRow}>
                      <span className={styles.name}>{item.name}</span>
                      <input
                        type="color"
                        defaultValue={item.color}
                        id={`edit-color-${item.name}`}
                      />
                      <input
                        type="color"
                        defaultValue={item.bgColor}
                        id={`edit-bgcolor-${item.name}`}
                      />
                      <button
                        className={styles.saveBtn}
                        onClick={() => {
                          const color = (document.getElementById(`edit-color-${item.name}`) as HTMLInputElement).value
                          const bgColor = (document.getElementById(`edit-bgcolor-${item.name}`) as HTMLInputElement).value
                          handleUpdateColor(item.name, color, bgColor)
                        }}
                      >
                        {language === 'zh' ? '保存' : 'Save'}
                      </button>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => setEditingName(null)}
                      >
                        {language === 'zh' ? '取消' : 'Cancel'}
                      </button>
                    </div>
                  ) : (
                    // 显示模式
                    <>
                      <span
                        className={styles.preview}
                        style={{ color: item.color, backgroundColor: item.bgColor }}
                      >
                        {item.name}
                      </span>
                      <div className={styles.colorInfo}>
                        <span>{language === 'zh' ? '文字' : 'Text'}: {item.color}</span>
                        <span>{language === 'zh' ? '背景' : 'Bg'}: {item.bgColor}</span>
                      </div>
                      <div className={styles.actions}>
                        <button
                          className={styles.editBtn}
                          onClick={() => setEditingName(item.name)}
                        >
                          {language === 'zh' ? '编辑' : 'Edit'}
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteColor(item.name)}
                        >
                          {language === 'zh' ? '删除' : 'Delete'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 预览 */}
        <div className={styles.previewSection}>
          <h3>{language === 'zh' ? '预览效果' : 'Preview'}</h3>
          <div className={styles.previewCards}>
            {colorList.slice(0, 6).map(item => (
              <div key={item.name} className={styles.previewCard}>
                <div className={styles.previewName}>{language === 'zh' ? '试管示例' : 'Sample Tube'}</div>
                <div className={styles.previewVolume}>100 μL</div>
                <div className={styles.previewSubstances}>
                  <span style={{ color: item.color, backgroundColor: item.bgColor, padding: '2px 6px', borderRadius: '4px' }}>
                    {item.name}: 1.0 μM
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* 开发者选项 */}
        <div className={styles.devSection}>
          <details>
            <summary>{language === 'zh' ? '开发者选项' : 'Developer Options'}</summary>
            <div className={styles.devContent}>
              <p className={styles.devWarning}>
                ⚠️ {language === 'zh' ? '以下操作会清除所有数据，请谨慎使用！' : 'The following operations will clear all data, use with caution!'}
              </p>
              <button className={styles.clearBtn} onClick={handleClearAllData}>
                {language === 'zh' ? '清除所有数据' : 'Clear All Data'}
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
