# LabFlow

> A visual laboratory reagent management and experiment workflow simulator — making experiment design more intuitive and efficient

## ⬇️ Download

👉 **[Get the latest release](https://github.com/Luminave/LabFlow/releases/latest)**

| Edition | File | Notes |
|---|---|---|
| **Installer (recommended)** | `LabFlow Setup 0.2.18.exe` | Adds Start-menu / desktop entries and registers the `labflow://` protocol, so notes and web pages can open a project directly |
| **Portable** | `LabFlow 0.2.18.exe` | No installation, no registry writes — double-click to run; copy it to another machine and it still works |

> On first launch Windows may warn about an unknown publisher — click **More info → Run anyway**.
> GitHub replaces spaces in asset names with dots: the installer downloads as `LabFlow.Setup.0.2.18.exe` (same file).

---

## 🆕 What's New in v0.2.18

- 🔒 **`concentration_mismatch` when nominal and reachable concentration differ by more than 5%**: a recipe that claims a nominal concentration but cannot be reached through the transfer graph now fails validation instead of silently producing an impossible dilution plan
- 🖼️ **Auto `fitView` before exporting screenshots**: `minZoom 0.05` plus the union of all node bounds, so dense boards are no longer cropped
- 📄 **Project source of truth moved to plain files**: `仓库.yml` + `工程/<name>.yml`; the UI reads from disk when a project is opened, and agents can read/write the files directly
- 🔐 **Agent lock + `labflow` CLI**: the lock blocks every write entry point and cannot be stolen by another owner; `validate / calc / export` compute only and never write by default
- 🔗 **`labflow://` deep links**: open a project from Obsidian, a web page or an agent, including cold start
- 🧩 **`labflow-project` skill and agent operating rules**: new skill plus `docs/数据正本与Agent协作.md`, fixing the "write → validate → tell the user to reload" loop
- 🪟 **Screenshot folder moved**: `screenshots/` → `docs/screenshots/`
- 🐛 Also: tighter settlement / revert bounds, hash-based conflict detection, deleting a project now archives it, file watcher covers the `工程/` subdirectory, file-only projects now show up in the project list

> v0.2.4–v0.2.17: internal iterations (input freeze fixes, database transactions and backups, app icons and packaging, drag-connect bugs) — see the commit history.

---

## 🆕 What's New in v0.2.3

- 🐛 **Fix**: Narrator page could not be scrolled with mouse wheel
- 🐛 **Fix**: Data Backup page could not be scrolled with mouse wheel

---

## 🆕 What's New in v0.2.0

- 🏠 **Brand New Home Page**: Clock, search, daily quotes — a welcoming start every time
- 🧰 **Utility Tools**: Nucleic acid chain calculator (sequence length ↔ molecular weight conversion)
- 📦 **Tube Grouping**: Group reagents by batch, with collapse and search-to-locate support
- 🎙️ **Narrator**: Automatically converts flowcharts into copyable SOP text steps
- 🎨 **Component Color Config**: Custom text and background colors for each component on tube labels
- 💾 **Data Backup**: Scheduled auto-backup + snapshot restore + JSON export/import
- 🌗 **Dark / Light Theme** + **Font Size Adjustment** (12–20 px)
- 🔧 **Refresh Button**: Reload raw material data and recalculate all intermediate products
- 🐛 **Fixes**: Experiment revert / completion state persistence

---

![Experiment Simulation](docs/screenshots/实验模拟功能（主图）.png)

## 🚀 Quick Start

### Windows installer (recommended)

1. Download `LabFlow Setup 0.2.18.exe` from [Releases](https://github.com/Luminave/LabFlow/releases/latest)
2. Run it (unknown publisher → More info → Run anyway)
3. Launch from the Start menu or desktop shortcut; the `labflow://` protocol is registered

### Windows portable

1. Download `LabFlow 0.2.18.exe` from the same Releases page
2. Double-click to run — no install, no registry (no `labflow://` deep links, everything else identical)

### From source (Windows / Linux / macOS)

```bash
git clone https://github.com/Luminave/LabFlow.git
cd LabFlow
npm install
npm run electron:dev   # desktop mode (Electron, the main form)
npm run dev            # browser mode: http://localhost:5173/
```

> `LabFlow-Installer.bat` / `Start-LabFlow.bat` are legacy scripts from the browser-only era: they install Git + Node and start `npm run dev`. They are **not** an installation method — use the installers above.

---

## Features

### 📦 Reagent Warehouse

![Reagent Warehouse](docs/screenshots/试剂仓库截图.png)

- **CRUD Operations**: Add, edit, delete reagents. Track name, volume, concentration, storage location
- **Tube Grouping**: Auto-named by batch (e.g. `260412`), 12 preset colors randomly assigned
  - Groups can be collapsed / expanded with persistent state
  - Search bar supports searching by reagent or group name, with auto-locate and highlight flash
  - Ungrouped reagents displayed outside group boxes
- **Group Management**: Edit name, color (8 presets + custom palette), and notes
- **Status Management**: Available / Low / Deprecated — switch directly on reagent cards

### 🔬 Experiment Simulation

- **Visual Flowchart**: Drag-and-drop tube nodes, connect with liquid transfer lines
- **Add from Warehouse**: Click to add warehouse reagents to your experiment
- **Create Tubes / Load Samples**: Create intermediate product nodes
- **Volume Editing**: Click the number on a connection line to modify transfer volume
- **Auto Concentration Calculation**: Target tube concentration and total volume updated in real-time
- **Check Function**: One-click validation of all tube concentrations and volumes, results in the right panel
- **Consumption / Raw Material**: Mark reagents as consumed or designate as raw materials
- **Experiment Timer**: Track time spent on each step
- **Refresh Button**: Reload raw material data and recalculate all intermediate products

### 🎙️ Narrator (SOP Generator)

![Narrator](docs/screenshots/讲述者截图.png)

- **Auto-generate SOP**: Converts flowcharts into linear text steps
- **Config Order**: Assign `configOrder` to tubes, narrator follows the sequence
- **One-click Copy**: Copy button on each step for easy pasting into lab notebooks or papers
- **Sorted by Volume**: Steps sorted by transfer volume (largest first), major components shown first

### 🎨 Component Color Configuration

![Color Settings](docs/screenshots/颜色设置截图.png)

- **Custom Colors**: Set text and background colors for each component (e.g. DNA, RNA, protein)
- **Quick Presets**: 9-color palette for one-click application
- **Live Preview**: Tube model cards at the bottom show how colors render in the actual UI
- **HEX Values**: Precise #RRGGBB for publication-quality figures

### 💾 Data Backup

![Data Backup](docs/screenshots/数据备份功能截图.png)

- **Data Overview**: At-a-glance statistics — reagent count, experiment records, tube history, group count
- **Scheduled Auto-backup**: Default every 30 minutes, customizable interval
- **Skip When Unchanged**: Automatically skips backup if no data changes detected
- **Snapshot Restore**: Browse backup history, click "Restore to this snapshot" to roll back
- **Export / Import**: Export as JSON file, import to restore

### 📋 Experiment Records

- **Auto-save History**: Each experiment is saved automatically when completed
- **View Details**: Review the final state of every tube in an experiment
- **Revert Experiment**: Roll back warehouse state to before the experiment

### 🔍 Tube Traceability

- Unique ID assigned to each tube (e.g. `260413-Tube 4`)
- Track tube origin and destination
- Record which experiments used each tube

### ⚙️ More

- 🌗 **Dark / Light theme toggle**
- 🔤 **Font size adjustment**: 12 – 20 px, adapts to different screens and visual needs
- 🌐 **Chinese / English language switch**

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Electron** + **electron-builder** | Desktop shell and packaging (installer / portable) |
| **React 18** + **TypeScript** | Frontend framework |
| **React Flow** (`@xyflow/react`) | Flowchart visualization |
| **Zustand** | State management |
| **js-yaml** | Reading/writing the plain-file project source (`仓库.yml` / `工程/<name>.yml`) |
| **sql.js** (SQLite) | Index, history and backups |
| **Vite** | Build tool & dev server |
| **react-router-dom** | Routing |
| **date-fns** | Date utilities |
| **Vitest** | Unit tests (`tests/`) |

---

## Project Structure

```
LabFlow/
├── electron/                  # Main process (window, deep links, data root, file watcher)
├── src/
│   ├── core/                  # Project source-of-truth files, validation (incl. concentration_mismatch), settlement
│   ├── cli/                   # CLI `labflow`: validate / calc / export
│   ├── renderer/              # Renderer process (React app)
│   │   ├── components/
│   │   │   ├── Layout.tsx     # Layout (nav bar + version)
│   │   │   └── TransferEdge.tsx  # Custom transfer edge
│   │   ├── pages/
│   │   │   ├── HomePage.tsx       # Home
│   │   │   ├── WarehousePage.tsx  # Reagent warehouse
│   │   │   ├── ExperimentPage.tsx # Experiment simulation
│   │   │   ├── RecordPage.tsx     # Experiment records
│   │   │   ├── NarratorPage.tsx   # Narrator
│   │   │   ├── BackupPage.tsx     # Data backup
│   │   │   └── ToolsPage.tsx      # Utility tools
│   │   ├── stores/            # Zustand state management
│   │   ├── i18n/              # Internationalization
│   │   └── styles/            # CSS Module styles
│   └── shared/
│       ├── types/             # TypeScript type definitions
│       └── utils/             # Utilities (database, backup, etc.)
├── docs/                      # Docs and screenshots/ (README images)
├── skills/labflow-project/    # Skill for agent-assisted project editing
├── tests/                     # Vitest unit tests
├── vite.config.ts             # Electron desktop build config
├── vite.config.browser.ts     # Browser-only Vite config
├── LabFlow-Installer.bat      # Legacy script (installs Git+Node, runs browser dev server)
├── Start-LabFlow.bat          # Legacy launcher (same caveat)
└── package.json
```

---

## Development

### Desktop mode (main form)

```bash
npm install
npm run electron:dev      # Vite + Electron with hot reload
npm run electron:build    # build installer + portable (output in release/)
```

### Browser mode (UI debugging)

```bash
npm install
npm run dev
# Visit http://localhost:5173/
```

> Browser mode has no `labflow://` deep links and cannot touch the local project folder — use it for UI work only.

### CLI and tests

```bash
npm run build:cli    # build dist-cli/labflow.mjs
npm run labflow -- validate 261123
npm test             # Vitest
```

---

## Troubleshooting

### Windows

| Issue | Solution |
|-------|----------|
| "Unknown publisher" / SmartScreen block | Click **More info → Run anyway** |
| `labflow://` links do nothing | Deep links are registered by the **installer** only; the portable build opens the app directly |
| Still seeing the old UI after updating | Quit the old process (including tray) and relaunch; local data is preserved |
| `npm not recognized` | Install Node.js, then restart terminal |
| Blank window in source mode | Make sure the Vite dev server from `npm run electron:dev` is listening on port 5173 |

### Linux

```bash
# Port 5173 is in use
lsof -i :5173
kill -9 <PID>
```

---

## License

MIT
