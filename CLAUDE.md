# CLAUDE.md - LabFlow 项目

## 项目概述
- **名称**: LabFlow（实验室试剂管理系统）
- **技术栈**: Electron + React + TypeScript + SQLite
- **项目路径**: D:\project\LabFlow
- **GitHub**: https://github.com/Luminave/LabFlow
- **GitHub 用户名**: Luminave
- **当前版本**: v0.2.3
- **Node.js**: 22

## 构建与启动
```bash
cd D:\project\LabFlow
npm run dev                  # 开发模式
npm run build                # 构建 Vite 前端
npm run electron:build       # 构建所有平台
npm run electron:build -- --win   # 仅 Windows
npm run electron:build -- --mac   # 仅 macOS
npm run electron:build -- --linux # 仅 Linux
```

## 重要配置
- **镜像源**: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
- **Vite 端口**: 5173

## 已完成功能
- 核心功能: 实验室试剂管理、实验模拟和可视化、试管连接关系管理
- 新增功能: 中英文切换、检查功能、耗损功能、作为原料功能、实验时间功能
- 技术特性: 自动保存到 localStorage + SQLite、右侧检查结果面板
- 首页(默认页面、时钟、搜索、名言、彩蛋)
- 小工具页面(核酸链计算器)
- 数据备份页面(定时备份、快照恢复)
- 深色/浅色主题切换、字号大小切换(12-20px)
- 试管分组功能(创建/管理/折叠/搜索定位/空分组显示)
- 讲述者功能(按配置序号生成实验步骤)
- 管号功能(tubeNumber,仅实验工程中存储)
- 试管溯源按钮、状态选择器合并、分组隐藏功能

## 打包状态
- **Linux AppImage**: ✅ 已完成 (110MB)
- **Linux deb**: ❌ 网络问题失败(FPM 工具下载超时)
- **Windows**: ✅ 已完成(浏览器访问模式)
  - 使用 `vite.config.browser.ts` 配置
  - 双击 `Start-LabFlow.bat` 启动
  - 访问地址: http://localhost:5173/
  - 安装脚本: `LabFlow-Installer.bat`
- **macOS**: 待构建

## 关键代码位置
- 类型定义: `src/shared/types/index.ts`
- 自定义边组件: `src/renderer/src/components/TransferEdge.tsx`
- 实验页面: `src/renderer/src/pages/ExperimentPage.tsx`
- 实验 Store: `src/renderer/src/stores/experimentStore.ts`
  - `completeExperiment` ~第1037行
  - `revertExperiment` ~第1103行
- 讲述者页面: `src/renderer/src/pages/NarratorPage.tsx`
- 分组 Store: `src/renderer/src/stores/groupStore.ts`
- 仓库页面: `src/renderer/src/pages/WarehousePage.tsx`
- 数据库迁移: `src/shared/utils/database.ts`

## 数据结构
- `TubeGroup` 接口: id(UUID)、name、color、notes、createdAt、hidden
- 试管的 `groupId` 字段绑定分组
- 试管 `configOrder` 字段: 讲述者排序用
- 试管 `tubeNumber` 字段: 仅实验工程,不入仓库

## 已知问题
- macOS 版本未构建
- Electron 在 Windows 上安装失败(已用浏览器访问模式绕开)

## 历史日志
- 项目开发历史日志位于: `D:\project\docs\memory\`
- 长期记忆文件: `D:\project\docs\memory\MEMORY-main.md`
- 日志时间范围: 2026-03-21 ~ 2026-06-11

## 开发规则
- ⚠️ **推送到 GitHub 前必须先问主人确认**
- `trash` > `rm`（可恢复优于永久删除）
- 遇到下载问题告诉主人
