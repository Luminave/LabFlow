# LabFlow

实验室试剂管理与实验流程模拟工具

## 🚀 快速开始

### Windows 用户

1. **下载项目**
   ```bash
   git clone https://github.com/Luminave/LabFlow.git
   cd LabFlow
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动应用**
   - 双击 `启动LabFlow.bat` 文件
   - 或者在命令行运行：
     ```bash
     npm run dev
     ```

4. **访问界面**
   - 浏览器会自动打开 http://localhost:5173/
   - 如果没有自动打开，请手动访问该地址

### Linux 用户

1. **下载项目**
   ```bash
   git clone https://github.com/Luminave/LabFlow.git
   cd LabFlow
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动应用**
   ```bash
   npm run dev
   ```

4. **访问界面**
   - 浏览器会自动打开 http://localhost:5173/
   - 或者手动访问 http://localhost:5173/

### macOS 用户

暂未提供原生支持，可以使用浏览器访问模式（同Linux）。

## 功能特性

### 📦 试剂仓库管理
- 添加、编辑、删除试剂
- 追踪试剂体积、浓度、存储位置
- 试剂状态管理（可用、不足、已弃）

### 🔬 实验流程模拟
- 可视化流程图编辑
- 拖拽添加试管
- 连线表示移液操作
- 自动计算浓度和体积

### 📋 实验记录
- 保存实验历史
- 查看实验详情
- 支持回退实验（恢复仓库状态）

### 🔍 试管溯源
- 每个试管唯一编号
- 追踪试管来源和去向
- 记录使用历史

## 技术栈

- **Electron** - 跨平台桌面应用
- **React** + **TypeScript** - 前端框架
- **React Flow** - 流程图可视化
- **Zustand** - 状态管理
- **SQLite** - 本地数据存储
- **Vite** - 构建工具

## 开发

### 浏览器访问模式（推荐）

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问 http://localhost:5173/
```

### Electron 桌面应用模式

```bash
# 安装依赖
npm install

# 开发模式（需要正确安装Electron）
npm run electron:dev

# 构建桌面应用
npm run electron:build
```

**注意：** Electron 模式可能需要额外配置，建议使用浏览器访问模式。

## 📦 构建产物

### 浏览器访问版本
- **启动脚本：** `启动LabFlow.bat`（Windows）
- **配置文件：** `vite.config.browser.ts`
- **访问地址：** http://localhost:5173/

### Electron 桌面应用
- **Windows：** `release/LabFlow Setup 0.1.0.exe`
- **Linux：** `release/LabFlow-0.1.0.AppImage`

## 🔧 故障排除

### Windows 用户

**问题：** 双击 `启动LabFlow.bat` 后浏览器没有自动打开
**解决：**
1. 确保已安装 Node.js（推荐 v18 或更高版本）
2. 手动运行 `npm run dev`
3. 然后手动访问 http://localhost:5173/

**问题：** 提示 "npm 不是内部或外部命令"
**解决：**
1. 下载并安装 Node.js：https://nodejs.org/
2. 重启命令行窗口

### Linux 用户

**问题：** 端口 5173 被占用
**解决：**
```bash
# 查找占用端口的进程
lsof -i :5173

# 杀死进程
kill -9 <PID>
```

**问题：** 权限不足
**解决：**
```bash
# 使用 sudo 运行
sudo npm run dev
```

## 📁 项目结构

```
LabFlow/
├── electron/           # Electron 主进程
│   ├── main.ts        # 主进程入口
│   └── preload.ts     # 预加载脚本
├── src/
│   ├── renderer/      # 渲染进程（React 应用）
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── styles/
│   └── shared/        # 共享代码
│       ├── types/     # TypeScript 类型定义
│       └── utils/     # 工具函数
├── database/          # 数据库文件目录
└── public/            # 静态资源
```

## 使用说明

### 添加试剂
1. 进入"试剂仓库"页面
2. 点击"添加试剂"按钮
3. 填写试剂信息（名称、体积、浓度等）
4. 保存

### 创建实验
1. 进入"实验模拟"页面
2. 输入实验名称，点击"开始新实验"
3. 点击"从仓库添加"选择原料试剂
4. 点击"新建试管"创建中间产物
5. 从试管拖出连线到目标试管
6. 点击连线上的数字修改移液体积

### 结束实验
1. 完成流程设计后，点击"结束实验"
2. 确认后，所有修改将同步到试剂仓库
3. 实验记录保存在"实验记录"页面

## License

MIT
