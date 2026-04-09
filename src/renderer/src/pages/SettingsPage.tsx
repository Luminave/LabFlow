import { useState, useEffect } from 'react'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const { colors, setColor, removeColor, loadColors } = useSubstanceColorStore()
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
    if (confirm(`确定删除 "${name}" 的颜色配置？`)) {
      removeColor(name)
    }
  }
  
  // 清除所有数据
  const handleClearAllData = () => {
    if (confirm('⚠️ 警告：此操作将清除所有数据！\n\n包括：\n- 所有试管数据\n- 所有实验记录\n- 所有试管历史\n- 所有颜色配置\n\n此操作不可恢复！')) {
      if (confirm('再次确认：真的要清除所有数据吗？\n\n这将删除所有记录，无法恢复！')) {
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
    { name: '黄色', value: '#fef08a' },
    { name: '青色', value: '#a5f3fc' },
    { name: '紫色', value: '#c4b5fd' },
    { name: '红色', value: '#fca5a5' },
    { name: '绿色', value: '#86efac' },
    { name: '橙色', value: '#fdba74' },
    { name: '粉色', value: '#fbcfe8' },
    { name: '蓝色', value: '#93c5fd' },
    { name: '灰色', value: '#e2e8f0' },
  ]
  
  const colorList = Array.from(colors.values())
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>成分颜色设置</h1>
        <p className={styles.subtitle}>为成分指定颜色，将在所有界面中高亮显示</p>
      </header>
      
      <div className={styles.content}>
        {/* 添加新颜色 */}
        <div className={styles.addSection}>
          <h3>添加新成分颜色</h3>
          <div className={styles.addRow}>
            <input
              type="text"
              placeholder="成分名称（如 E1、DNA）"
              value={newSubstance}
              onChange={(e) => setNewSubstance(e.target.value)}
              className={styles.input}
            />
            <div className={styles.colorPicker}>
              <label>文字色</label>
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
            </div>
            <div className={styles.colorPicker}>
              <label>背景色</label>
              <input
                type="color"
                value={newBgColor}
                onChange={(e) => setNewBgColor(e.target.value)}
              />
            </div>
            <button className={styles.addBtn} onClick={handleAddColor}>
              添加
            </button>
          </div>
          
          {/* 预设背景色 */}
          <div className={styles.presets}>
            <span>快速选择背景色：</span>
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
          <h3>已配置的颜色 ({colorList.length})</h3>
          
          {colorList.length === 0 ? (
            <p className={styles.empty}>暂无颜色配置</p>
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
                        保存
                      </button>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => setEditingName(null)}
                      >
                        取消
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
                        <span>文字: {item.color}</span>
                        <span>背景: {item.bgColor}</span>
                      </div>
                      <div className={styles.actions}>
                        <button
                          className={styles.editBtn}
                          onClick={() => setEditingName(item.name)}
                        >
                          编辑
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteColor(item.name)}
                        >
                          删除
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
          <h3>预览效果</h3>
          <div className={styles.previewCards}>
            {colorList.slice(0, 6).map(item => (
              <div key={item.name} className={styles.previewCard}>
                <div className={styles.previewName}>试管示例</div>
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
            <summary>开发者选项</summary>
            <div className={styles.devContent}>
              <p className={styles.devWarning}>
                ⚠️ 以下操作会清除所有数据，请谨慎使用！
              </p>
              <button className={styles.clearBtn} onClick={handleClearAllData}>
                清除所有数据
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
