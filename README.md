<p align="center">
  <img src="docs/assets/hero.png" alt="Quill hero" width="860" />
</p>

<h1 align="center">Quill</h1>

<p align="center">
  本地优先 · AI 驱动 · 多功能 Markdown 工作台<br/>
  Local-first, AI-enhanced Markdown workspace built with Tauri 2 + React + CodeMirror 6.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" />
  <img alt="stack" src="https://img.shields.io/badge/Tauri-2-orange" />
  <img alt="frontend" src="https://img.shields.io/badge/React-18-61dafb" />
  <img alt="editor" src="https://img.shields.io/badge/CodeMirror-6-red" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

> 一个桌面应用,把 Markdown 编辑、本地多 Vault 文档管理、可视化文件查看器、AI 桌宠 Cloudia、以及五大 Feature Agent(study / analyze / clips / schedule / wiki)装进同一个壳里。数据本地存,可端到端加密同步到 S3 / WebDAV。

## Why Quill

- **不止是 Markdown 编辑器** — 内置 15+ 种文件类型编辑器:Markdown、代码、HTML、CSV、JSON、SVG、PlantUML、Graphviz、Mermaid、DBML、Drawio、Excalidraw、Mind Map、富文本、Clip、Office、图片预览。一个 Vault 里什么都能放。
- **AI 桌宠 Cloudia** — 角落里一只会冒泡通知的小宠物,通过 Bubble Template 模板化推送提醒,可点击展开交互面板。不是装饰,是真正的通知入口。
- **五大 Feature Agent** — 每个能力域都有专属 Agent:study(学习)、analyze(分析)、clips(剪藏)、schedule(日程)、wiki(知识库)。Vault 级别的 Agent 循环,带文件系统和工具。
- **本地优先 + 端到端加密同步** — 文档全部存本地;可选 S3 / WebDAV 同步,支持 E2E 加密。数据是你的。
- **内容寻址版本历史** — 每次保存自动快照,SHA-256 去重存储,任意时刻可回滚。
- **插件化 AI 适配器** — 开箱支持 Claude Code CLI;adapter 抽象可扩展其它 CLI Agent。
- **跨平台** — macOS / Windows / Linux 桌面端,Tauri 2 打包。

## Screenshots

<p align="center">
  <img src="docs/assets/editor-markdown.png" alt="Markdown editor" width="860" />
  <sub>CodeMirror 6 驱动的 Markdown 编辑器 + 实时预览 + 容器指令(:::callout / :::tabs)</sub>
</p>

<p align="center">
  <img src="docs/assets/cloudia-pet.png" alt="Cloudia pet" width="860" />
  <sub>AI 桌宠 Cloudia — 气泡通知 + 角落 toast + 可展开交互面板</sub>
</p>

<p align="center">
  <img src="docs/assets/file-viewers.png" alt="File viewers" width="860" />
  <sub>PlantUML / Graphviz / Mermaid / DBML / Drawio / Excalidraw / Mind Map / CSV / JSON 等开箱即用</sub>
</p>

<p align="center">
  <img src="docs/assets/feature-agents.png" alt="Feature agents" width="860" />
  <sub>study / analyze / clips / schedule / wiki — 五大 Vault 级 Agent</sub>
</p>

<p align="center">
  <img src="docs/assets/version-history.png" alt="Version history" width="860" />
  <sub>内容寻址版本快照,SHA-256 去重,任意时刻回滚</sub>
</p>

> 截图占位,后续补图到 `docs/assets/`。建议尺寸 1600×900 PNG 或 MP4/GIF 动图。

## For Users

### 首次运行提示

应用未做代码签名,首次运行时会触发系统安全拦截,按以下步骤放行即可:

- **Windows**:首次运行会看到 SmartScreen "Windows 已保护你的电脑" 警告。点击 **更多信息 → 仍要运行**。
- **macOS**:安装完成后首次打开若提示"无法打开"或"已损坏",在 Terminal 中执行:
  ```bash
  xattr -cr /Applications/Quill.app
  ```
  然后重新从启动台打开。

### 编辑与预览

- CodeMirror 6 编辑器:语法高亮、GFM、remark 指令、slash 命令
- 实时预览:highlight.js 代码高亮、容器指令、同步滚动
- 导出:Markdown / HTML / PDF
- 主题:Light / Dark / System
- 可定制:字体、字号、tab 宽、行号、自动保存、快捷键

### 多文件类型支持

一个 Vault 里可同时打开:Markdown · 代码 · HTML · CSV · JSON · SVG · PlantUML · Graphviz · Mermaid · DBML · Drawio · Excalidraw · Mind Map · 富文本 · Clip · Office · 图片预览。每种类型都有专属编辑器或查看器。

### 多 Vault 管理

本地优先文档管理,可插拔存储后端:本地文件系统 / GitHub / WebDAV / S3。每个 Vault 独立配置同步策略与加密选项。

### AI 能力

- **Cloudia 桌宠**:模板化气泡通知 + 交互面板
- **Feature Agent**:study / analyze / clips / schedule / wiki,每个 Agent 都是 Vault 级别的 Agent 循环
- **Bubble Template AI**:多轮对话澄清意图,生成通知模板
- **CLI 适配器**:开箱支持 Claude Code,Settings → AI 里配置 CLI 路径即可

### 同步与加密

S3 / WebDAV 同步,支持端到端加密。本地是唯一真源,云只是镜像。

## For Developers

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri 2 (Rust) |
| Frontend | React 18, Vite 6, TypeScript |
| Editor | CodeMirror 6 |
| Markdown | unified / remark / rehype pipeline |
| State | Zustand 5 |
| Styling | Tailwind CSS 3 |
| Monorepo | pnpm workspaces |

### Project Structure

```
quill/
├── apps/
│   └── desktop/              # Tauri desktop app
│       ├── src/              # React frontend
│       │   ├── components/   # shell, editor, AI, sidebar, file-types, ...
│       │   ├── editor/       # CodeMirror extensions
│       │   ├── hooks/        # React hooks
│       │   ├── store/        # Zustand stores
│       │   └── utils/        # Utility modules
│       └── src-tauri/        # Rust backend (Tauri commands)
├── packages/
│   ├── cli-adapter/          # AI CLI adapter abstraction (Claude, etc.)
│   ├── container-plugins/    # Markdown container directive plugins
│   └── vault-provider/       # Vault storage provider abstraction
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Extension Points

- **`cli-adapter` 包** — 实现 adapter 接口即可接入新的 CLI Agent
- **`container-plugins` 包** — 自定义 `:::directive` 容器插件,注册到 slash 菜单
- **`vault-provider` 包** — 自定义存储后端(local / GitHub / WebDAV / S3 之外)
- **文件类型** — 在 `apps/desktop/src/components/file-types/` 下注册新 Handler 即可扩展文件类型
- **Feature Agent** — 在 Vault 内通过 `agents/<feature>.md` 系统提示词定义新能力域

详见 `docs/plugin-development.md` 与 `docs/plugin-sdk-reference.md`。

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Tauri 2 系统依赖 — 见 [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Install & Run

```bash
# Install dependencies
pnpm install

# Start development (frontend + Tauri dev window)
pnpm dev

# Build the frontend only
pnpm build

# Build the desktop app (platform-specific installer)
pnpm build:app
```

## Configuration

所有设置在应用内 **Settings** 页面:

| Category | Options |
|----------|---------|
| Appearance | Theme, font size, line height, status bar, AI panel visibility |
| Editor | Font, font size, tab size, wrap column, line numbers, syntax highlighting, auto-save, spell check |
| Shortcuts | Customizable keyboard shortcuts (Save, Bold, Italic, etc.) |
| AI | CLI adapter selection, CLI path |
| Vault | Vault path, image path, document extension, file watching, trash on delete |
| Sync | Sync method (S3 / WebDAV), endpoint, credentials, E2E encryption |

## Internationalization (i18n)

UI 字符串通过 `i18next` + `react-i18next` 本地化,支持 zh / en。默认跟随 `navigator.language`,持久化到 `localStorage`。在 Topbar 的地球图标或 Settings → Appearance 的语言行切换。

## License

MIT
