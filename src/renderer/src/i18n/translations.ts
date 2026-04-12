import { Language } from '../stores/i18nStore'

export const translations: Record<string, Record<Language, string>> = {
  // 应用标题
  'app.subtitle': { zh: '实验室试剂管理系统', en: 'Lab Reagent Management System' },
  
  // 侧边栏
  'nav.home': { zh: '首页', en: 'Home' },
  'nav.warehouse': { zh: '试剂仓库', en: 'Warehouse' },
  'nav.experiment': { zh: '实验模拟', en: 'Experiment' },
  'nav.history': { zh: '实验记录', en: 'History' },
  'nav.trace': { zh: '试管溯源', en: 'Tube Trace' },
  'nav.settings': { zh: '颜色设置', en: 'Color Settings' },
  'nav.tools': { zh: '小工具', en: 'Tools' },
  'nav.backup': { zh: '数据备份', en: 'Data Backup' },
  'nav.narrator': { zh: '讲述者', en: 'Narrator' },
  
  // 工具栏
  'toolbar.newExperiment': { zh: '新建工程', en: 'New Project' },
  'toolbar.newWaste': { zh: '新建耗损', en: 'New Waste' },
  'toolbar.open': { zh: '打开工程', en: 'Open' },
  'toolbar.experimentName': { zh: '实验名称...', en: 'Experiment name...' },
  'toolbar.startExperiment': { zh: '开始新实验', en: 'Start New' },
  'toolbar.defaultBuffer': { zh: '默认缓冲液:', en: 'Default Buffer:' },
  'toolbar.noBuffer': { zh: '无', en: 'None' },
  'toolbar.showBuffers': { zh: '显示缓冲液', en: 'Show Buffers' },
  'toolbar.addFromWarehouse': { zh: '+ 从仓库添加', en: '+ Add from Warehouse' },
  'toolbar.newTube': { zh: '+ 新建试管', en: '+ New Tube' },
  'toolbar.newSample': { zh: '+ 新建上样', en: '+ New Sample' },
  'toolbar.newWasteTube': { zh: '+ 新建耗损', en: '+ New Waste' },
  'toolbar.save': { zh: '保存', en: 'Save' },
  'toolbar.saveAs': { zh: '另存为', en: 'Save As' },
  'toolbar.quickNaming': { zh: '快捷命名', en: 'Quick Naming' },
  'toolbar.endExperiment': { zh: '结束实验', en: 'End Experiment' },
  'toolbar.check': { zh: '检查', en: 'Check' },
  
  // 试管类型
  'tube.source': { zh: '📦 原料', en: '📦 Source' },
  'tube.buffer': { zh: '💧 缓冲液', en: '💧 Buffer' },
  'tube.sample': { zh: '🔴 上样', en: '🔴 Sample' },
  'tube.waste': { zh: '🗑️ 耗损', en: '🗑️ Waste' },
  'tube.intermediate': { zh: '🧪 中间产物', en: '🧪 Intermediate' },
  
  // 试管详情
  'tubeDetail.sampleVolume': { zh: '上样体积', en: 'Sample Volume' },
  'tubeDetail.wasteVolume': { zh: '耗损体积', en: 'Waste Volume' },
  'tubeDetail.name': { zh: '名称', en: 'Name' },
  'tubeDetail.targetVolume': { zh: '目标体积', en: 'Target Volume' },
  'tubeDetail.unit': { zh: '单位', en: 'Unit' },
  'tubeDetail.substanceConcentration': { zh: '目标物质浓度（设置后点击"自动计算"更新连线）', en: 'Target Substance Concentration (click "Auto Calc" to update connections)' },
  'tubeDetail.substanceName': { zh: '物质名称', en: 'Substance Name' },
  'tubeDetail.concentration': { zh: '浓度', en: 'Concentration' },
  'tubeDetail.addSubstance': { zh: '+ 添加物质', en: '+ Add Substance' },
  'tubeDetail.bufferFill': { zh: '缓冲液补足', en: 'Buffer Fill' },
  'tubeDetail.noBuffer': { zh: '不使用缓冲液', en: 'No Buffer' },
  'tubeDetail.createBufferHint': { zh: '请先在仓库中创建缓冲液', en: 'Please create buffer in warehouse first' },
  'tubeDetail.asSource': { zh: '作为原料（上次实验剩下的试剂）', en: 'As Source (remaining from last experiment)' },
  'tubeDetail.asSourceHint': { zh: '选中后，检查时将赦免此试管的成分输入问题', en: 'Check will skip substance source validation for this tube' },
  'tubeDetail.trace': { zh: '溯源', en: 'Trace' },
  'tubeDetail.deleteTube': { zh: '删除试管', en: 'Delete Tube' },
  'tubeDetail.close': { zh: '关闭', en: 'Close' },
  'tubeDetail.cancel': { zh: '取消', en: 'Cancel' },
  'tubeDetail.autoCalculate': { zh: '自动计算', en: 'Auto Calculate' },
  'tubeDetail.save': { zh: '保存', en: 'Save' },
  
  // 只读模式
  'readOnly.notice': { zh: '🔒 此实验已结束，试管信息仅供查看', en: '🔒 Experiment ended, view only' },
  'readOnly.badge': { zh: '已结束（只读）', en: 'Ended (Read Only)' },
  
  // 状态
  'status.draft': { zh: '草稿', en: 'Draft' },
  'status.completed': { zh: '已完成', en: 'Completed' },
  'status.reverted': { zh: '已回退', en: 'Reverted' },
  
  // 检查结果
  'check.title': { zh: '检查结果', en: 'Check Results' },
  'check.noErrors': { zh: '✅ 工程检查通过，没有发现问题！', en: '✅ Check passed, no issues found!' },
  'check.problems': { zh: '个问题', en: 'problems' },
  'check.recheck': { zh: '重新检查', en: 'Recheck' },
  
  // 错误类型
  'error.volumeExceed': { zh: '⚠️ 体积超出', en: '⚠️ Volume Exceeded' },
  'error.bufferMissing': { zh: '💧 缺少缓冲液', en: '💧 Buffer Missing' },
  'error.substanceSourceMissing': { zh: '🔗 缺少成分来源', en: '🔗 Substance Source Missing' },
  'error.calculationError': { zh: '🔢 计算错误', en: '🔢 Calculation Error' },
  'error.zeroConcentration': { zh: '📊 浓度为0', en: '📊 Zero Concentration' },
  
  // 仓库页面
  'warehouse.title': { zh: '试剂仓库', en: 'Reagent Warehouse' },
  'warehouse.emptyHint': { zh: '暂无试管，点击右上方"添加试剂"开始', en: 'No tubes, click "Add Reagent" to start' },
  'warehouse.addReagent': { zh: '添加试剂', en: 'Add Reagent' },
  'warehouse.searchPlaceholder': { zh: '搜索试管名称或成分...', en: 'Search by name or substance...' },
  'warehouse.export': { zh: '导出', en: 'Export' },
  'warehouse.import': { zh: '导入', en: 'Import' },
  
  // 历史记录页面
  'history.title': { zh: '实验记录', en: 'Experiment History' },
  'history.emptyHint': { zh: '暂无实验记录', en: 'No experiment records' },
  'history.tubes': { zh: '个试管', en: 'tubes' },
  
  // 溯源页面
  'trace.title': { zh: '试管溯源', en: 'Tube Trace' },
  'trace.selectHint': { zh: '请选择要溯源的试管', en: 'Select a tube to trace' },
  'trace.searchPlaceholder': { zh: '搜索试管名称...', en: 'Search tube name...' },
  
  // 设置页面
  'settings.title': { zh: '颜色设置', en: 'Color Settings' },
  'settings.substanceColors': { zh: '物质颜色配置', en: 'Substance Color Configuration' },
  'settings.addColor': { zh: '+ 添加颜色', en: '+ Add Color' },
  'settings.resetDefault': { zh: '重置默认颜色', en: 'Reset Default Colors' },
  
  // 弹窗
  'modal.projectManagement': { zh: '工程管理', en: 'Project Management' },
  'modal.saveAs': { zh: '另存为', en: 'Save As' },
  'modal.selectTube': { zh: '选择试管', en: 'Select Tube' },
  'modal.newName': { zh: '新名称', en: 'New Name' },
  
  // 耗损标签
  'waste.tag': { zh: '耗损', en: 'Waste' },
  
  // 提示信息
  'alert.enterName': { zh: '请输入实验名称', en: 'Please enter experiment name' },
  'alert.experimentSaved': { zh: '实验已保存！', en: 'Experiment saved!' },
  'alert.savedAs': { zh: '实验已另存为：', en: 'Experiment saved as: ' },
  'alert.confirmEnd': { zh: '确定结束实验？\n\n所有修改将同步到试剂仓库：\n- 原料试管的剩余体积将更新\n- 中间产物将添加到仓库\n\n此操作不可撤销。', en: 'Confirm end experiment?\n\nAll changes will sync to warehouse:\n- Source tube volumes will update\n- Intermediate tubes will be added\n\nThis cannot be undone.' },
  'alert.confirmDelete': { zh: '确定删除这个试管？相关的移液连接也会被删除。', en: 'Delete this tube? Related connections will also be deleted.' },
  'alert.tubeNameEmpty': { zh: '试管名称不能为空', en: 'Tube name cannot be empty' },
  'alert.tubeNameDuplicate': { zh: '试管名称 "', en: 'Tube name "' },
  'alert.tubeNameDuplicateSuffix': { zh: '" 已存在，请使用其他名称', en: '" already exists, please use another name' },
  'alert.enterNewName': { zh: '请输入新名称', en: 'Please enter new name' },
  'alert.connectFirst': { zh: '请先从源试管连线到此试管', en: 'Please connect from source tube first' },
  'alert.enterVolume': { zh: '请输入体积', en: 'Please enter volume' },
  'alert.enterConcentration': { zh: '请输入浓度', en: 'Please enter concentration' },
  'alert.calculationFailed': { zh: '自动计算失败：', en: 'Auto calculation failed: ' },
  
  // 空试管
  'emptyTube': { zh: '空试管', en: 'Empty Tube' },
  
  // 语言切换
  'language.switch': { zh: 'EN', en: '中文' },
}

export function t(key: string, language: Language): string {
  const translation = translations[key]
  if (!translation) {
    console.warn(`Translation not found: ${key}`)
    return key
  }
  return translation[language] || translation['zh']
}
