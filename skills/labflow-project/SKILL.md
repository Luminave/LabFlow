---
name: labflow-project
description: 在 LabFlow 里新建或修改一个实验工程（配液流程），跑校验、对账、导出 SOP 与流程图，并让界面正确重载。用于「把这个实验排进 LabFlow」「改一下配液流程」「工程 validate 不通过」「导出 SOP / 流程图」这类请求。不涉及 LabFlow 应用本身的开发。
---

<!-- 本文件在 DSH skill 目录与仓库各存一份，改一处要同步另一处：
     C:\Users\27133\.dsh\skills\labflow-project\SKILL.md
     D:\project\LabFlow\skills\labflow-project\SKILL.md -->

# labflow-project（LabFlow 工程手册）

> 一次实验 = 从仓库挑试剂 + 在一个工程 yml 里写流程。**真相在磁盘文件上，应用只是编辑器**。
> 配套长文：`D:\project\LabFlow\docs\数据正本与Agent协作.md`（第十节「还欠的事」、第十一节「操作规程」）。

## 一、什么时候用

用：
- 把一次实验的配液排成工程：原液 → 稀释 → 退火 → 挂发卡 → 上样
- 改已有工程：浓度、体积、加一支管、调布局
- `validate` 不通过要查原因；核对浓度与用量；导出 SOP / 流程图

不用：
- 改 LabFlow 应用本身（`src/`、`dist-cli/` 的代码）。那是开发任务，本文只讲写工程文件。

## 二、文件在哪

| 东西 | 位置 | 说明 |
|---|---|---|
| 试剂仓库正本 | `D:\学习\labflow\仓库.yml` | 试剂、分组、余量。**取 id 只能从这里** |
| 工程正本 | `D:\学习\labflow\工程\<名>.yml` | 一个工程一个文件，`schemaVersion: 2` |
| 应用数据库 | 本地 sql.js 库 | 只是缓存，别拿它当准 |
| 导出目录 | 应用「讲述者 → 3. 导出工程」里设 | 默认 `D:\学习\labflow\导出\<工程名>` |

数据根可以在应用里改；命令行支持 `--root <目录>` 或环境变量 `LABFLOW_DATA_ROOT`（拿副本试跑更安全）。

## 三、标准动作顺序（照做，别跳）

0. 批量改（3 支管以上）先加锁：`node dist-cli/labflow.mjs lock <名> --note "改什么"`，改完 `unlock`。界面会冻住，防止两边同时写同一个文件。
1. **读 `仓库.yml` 拿试剂 id**。源试管的 `id` 必须**等于**仓库里那支试剂的 `id`，不是自己新生成的。
2. 写/改 `D:\学习\labflow\工程\<名>.yml`。新 UUID 用 `node -e "console.log(crypto.randomUUID())"` 生成；**已有工程的 `project.id` 不许改**（改名、改浓度、改体积都安全）。
3. `node dist-cli/labflow.mjs validate <名>` —— **退出码必须是 0**。非 0 就按报错逐条改，不许猜。
4. `node dist-cli/labflow.mjs calc <名>` —— 逐管核对关键浓度、总体积、试剂用量。
5. **界面会自动热重载，不要叫用户找不存在的按钮**。主进程 `fs.watch` 监听数据根目录与 `工程/`（`electron/main.ts:1808` `watchDir`，150 ms 去抖后 `scheduleStoreScan`），渲染端 `useStoreHotReload`（`src/renderer/src/utils/storeHotReload.ts:90`）按 `planHotReload`（`:46`）决定：
   - 改的是 `仓库.yml` → **必定自动重载**，并弹 toast「仓库文件已更新，已重新载入」，用户什么都不用做；
   - 改的是当前开着的工程、且界面没有未保存改动 → 自动重载，toast「工程文件已更新，已重新载入」；
   - 改的是当前开着的工程、但界面有未保存改动（dirty）→ **不覆盖**，只在实验页顶部挂一条黄条「⚠️ 工程文件已被外部修改：<文件名>」+ 两个按钮「重新载入」「先不管」（`ExperimentPage.tsx:1516-1527`）。
   所以「重新载入」不是常驻顶栏按钮；只有那条黄条里才有。回复里只说「若已打开这个工程且顶部出现黄条，点『重新载入』」，别许诺一个找不到的按钮。
   ⚠️ **改 `仓库.yml` 不一定改得动界面**：本机装的若是 **0.2.18 及更早**，仓库页读的是 `C:\Users\<用户名>\AppData\Roaming\labflow\data\labflow.db` 的 `tubes` 表，文件只当备份（实见 2026-11-23）。这种情形要「文件 ＋ 库」两边都改，改完让用户按 **Ctrl+R** 整页重载（切页不重拉库）。0.2.19 起才真正以 `仓库.yml` 为正本。
6. 别自己宣布"已经生效"：让用户看 toast / 黄条，再一起看画布与讲述者。

## 四、硬性规则（违反必被校验或主人否定）

**单位**
- 一律希腊字母 `μ`（U+03BC）。写成 `µ`（U+00B5）就算错——应用自己重存会写错，回写时顺手改回来。

**PBS 胶囊（最常漏的一项）**
- 每支需要 PBS 的试管配**一个独立的** buffer 节点，不共用、不合并：

```yaml
  - id: buffer-<PBS试剂id>-<目标管id>
    name: PBS
    type: buffer
    warehouseId: buffer-<PBS试剂id>-<目标管id>   # 与 id 同一串
    totalVolume: 0 μL
    remainingVolume: 0 μL
    selectedBuffer: <PBS试剂id>
```

- **目标管自己也要写** `selectedBuffer: <PBS试剂id>`；卡片和管两边都写才认。
- 胶囊贴在目标管**左侧或下方**（例：管 `x: 320, y: 0` → 胶囊 `x: 240, y: -30`）。**别吊在正上方**，会拉出尖锐的倒 S 形连线。
- PBS 移液量 = 目标管总体积 − 其它来源之和，连线 `volume` 必须能对上。

**中间产物**
- 必须写 `configOrder`：从 1 开始连续编号，不重复、不跳号。讲述者按它排 SOP 步骤。

**浓度**
- `substances` 里写的浓度**必须等于**连线算出来的可达浓度，否则报 `concentration_mismatch`（差 >5%）。
- 先手算再落盘：`Σ(体积 × 浓度) / 总体积`，写进 yml，再让 `validate` 兜底。

**体积**
- 按「够用就好」：退火 / 孵育 / 上样通常 20 μL。
- 只有下游要多次取用才做多一点。例：一支退火液要分给三支挂发卡，才做 30 μL。

**布局**
- 按列从左到右排：原液 → 稀释 → 退火 → 挂发卡。
- **与前后步骤没有连线关系的管（如「上样」）单独一行放最下面**，不要横插在连续流程中间。
- 同列 `x` 对齐、`y` 间距 ≥150，别让管框叠在一起。

## 五、验收命令

```bash
node dist-cli/labflow.mjs validate <名>          # 退出码 0 通过 / 1 有问题 / 2 用法错
node dist-cli/labflow.mjs calc <名>              # 每管最终成分与体积
node dist-cli/labflow.mjs calc <名> --json       # 机器可读，好比对
node dist-cli/labflow.mjs export <名> --out <目录>   # 只写 SOP（.md）
```

- 改过 `src/core` 或 CLI 源码，先 `npm run build:cli` 重建，否则命令行还是旧逻辑。
- `export` 只能出 SOP；**流程图 PNG 与白板 canvas 必须在界面里导**（是截当前画布，得先打开那个工程）。

## 六、绝不能做

- **不要替用户点界面里的「保存」**：保存写的是界面内存里的内容，内存可能是旧的，一点就把旧版写回磁盘、盖掉你刚写的文件。
- **不要自己提交 git**。
- **不要在 yml 里手填一份"看起来对"的浓度去骗过校验**。浓度要么算得出来，要么就是没做对。
- **不要在 Obsidian 里改导出的 `.canvas`**（会被应用重存覆盖）。
- **不要改已有工程的 `project.id`**，也不要让两个工程共用一个 id。

## 七、常见坑（症状 → 原因 → 怎么办）

| 症状 | 原因 | 怎么办 |
|---|---|---|
| `warehouse_ref_missing` | 源管 id 与仓库 id 不一致 | 回 `仓库.yml` 复制那支试剂的 `id`，原样贴 |
| `config_order_missing` / 序号重复跳号 | 漏写 `configOrder` 或编号有洞 | 从 1 连续编到 N，一个不漏 |
| `concentration_mismatch` | 标称浓度 ≠ 连线可达浓度 | 按 `Σ(v×c)/V` 重算；改体积比也能修正 |
| `validate --json` 里 message 是空串 | `dist-cli` 是旧构建，缺这个码的文案分支 | `npm run build:cli` 重建即可 |
| 界面还是旧内容 | ①窗口没开着（重载只在应用运行时发生）；②改的是**正开着的工程**且界面有未保存改动，热重载被故意拦下挂黄条 | 关掉工程再打开；或点黄条里的「重新载入」 |
| 单位变成 `µ`、`name:` 引号消失 | 应用自己重存过的痕迹 | 回写时统一改 `μ`、补回引号 |
| 导出的 PNG 被裁边 | 画布太密（几十支管）时只截可视区，`fitView` 没给 `minZoom`，被 React Flow 默认 0.5 夹住 | 已知缺陷，不是写错了；导出前先缩到能看全 |
| 打包版启动后立刻退出，exit 0、无窗口、无任何输出 | 环境里有 `ELECTRON_RUN_AS_NODE=1`（调试残留会被子进程继承）→ Electron 当纯 Node 跑 main | 用 `env -u ELECTRON_RUN_AS_NODE ./LabFlow.exe` 启动，或先 `unset` 它；别据此判断"装坏了" |

## 八、和 Obsidian 配合

- 导出设置建议：**SOP 开、流程图 PNG 开、白板 canvas 关、数据 yml 关**（导出副本永不回读，留着只会混淆）。
- 导出目录建在知识库里，例 `D:\学习\labflow\导出\<工程名>`，这样 vault 能直接索引到。
- 笔记里引图：`![[<日期>-<工程名>.png]]`；链 SOP：`[[<日期>-<工程名>.md]]`。
- 想从笔记跳回应用：SOP 头部的 `labflow://open?project=<工程名>` 链接，点了直接载入该工程。
- canvas 只当视图看：它的坐标由应用的 manifest 决定，在 Obsidian 里拖完一重存就丢；要改布局就改 yml 里的 `x` / `boardX`。

## 九、篇幅

能删就删。给用户的话先一句结论，再两三条支撑；写文件不必凑长度，`validate` 过 + `calc` 对得上才算完。
