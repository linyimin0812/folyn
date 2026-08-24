[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md)

<h1 align="center">Mochi Editor</h1>

<p align="center">
  Local-first · Vault-isolated · AI-native<br/>
  Local-first, vault-based, AI-native knowledge workspace.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" />
  <img alt="downloads" src="https://img.shields.io/github/downloads/linyimin0812/mochi/total?label=downloads" />
  <img alt="stack" src="https://img.shields.io/badge/Tauri-2-orange" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

> One app, all your context. Isolate each set of data in a Vault, fit markdown, whiteboards, ER diagrams, and mind maps into one editor, and wire AI agents straight into your workflow — everything stays on your own devices.

## Why Mochi

- **Vault multi-vault isolation** — Open a separate vault for each project or note set. Data stays independent, switch anytime. Your local device is the single source of truth.
- **Multi-format editing** — Markdown (with container plugins: Button / Callout / Card / Tabs / Timeline / Steps / Grid / FilePreview / StatusTag / Collapsible, plus Graphviz / Mermaid / PlantUML diagram containers), rich text, CSV, JSON, markmap mind maps, dbml ER diagrams, drawio architecture diagrams, excalidraw hand-drawn whiteboards, graphviz DOT — one editor handles them all.
- **Universal preview** — Office documents, audio/video, archives, e-books, presentations and drawings — view them without leaving Mochi.
- **Deep AI integration** — Built-in adapters for six CLI agents: Claude Code, Codex CLI, Gemini CLI, Opencode, Pi Code Agent, Qoder. Switch freely across model vendors, no vendor lock-in.
- **Desktop pet assistant** — A resident desktop companion that pushes schedule reminders and task-change notifications; click to bring up a chat with the LLM.
- **In-app terminal** — Open a terminal inside Mochi and let Claude Code / Codex / other CLI agents read and write the current document — no window switching.
- **Plugin system** — Microkernel + plugin SDK architecture. Translation, schedule, Wiki, Clips, and project analysis ship as plugins; third-party extensions supported.
- **Voice input** — Speech-to-text with automatic polish, pasted straight to the cursor (currently macOS only).

## For Users

### First-run notes

The app is not code-signed; the OS will block it on first launch. Dismiss as follows:

- **Windows**: You'll see a SmartScreen "Windows protected your PC" warning on first run. Click **More info → Run anyway**.
- **macOS**: If "can't be opened" or "damaged" appears after install, run in Terminal:
  ```bash
  xattr -cr /Applications/Mochi.app
  ```
  Then reopen from Launchpad.

### Vault multi-vault isolation

Open a separate vault for each project or note set. Each vault is its own data space — notes, attachments, and plugin configs are stored independently; switching vaults is like switching a whole workspace. Data stays on the local device; no cloud account required.

<p align="center">
  <img src="docs/assets/screenshots/vault-1.png" alt="Vault switching" width="860" />
</p>

### Multi-format editing

- **Markdown** — Standard syntax + a set of container plugins: Button / Callout / Card / Collapsible / FilePreview / Grid / StatusTag / Steps / Tabs / Timeline, plus Graphviz / Mermaid / PlantUml diagram containers
- **Rich text** — WYSIWYG, for layouts that don't need markdown syntax
- **Structured data** — CSV, JSON, edited directly
- **Mind maps** — markmap, markdown outlines auto-rendered as visual structure
- **Modeling & diagrams** — dbml (ER) / drawio (architecture, flow) / excalidraw (hand-drawn whiteboard) / graphviz (DOT) / plantuml / mermaid

<p align="center">
  <img src="docs/assets/screenshots/editing-2.png" alt="Markdown editor with container plugins" width="860" />
</p>

### Universal preview

View Office documents, audio/video, archives, e-books, presentations and drawings without leaving Mochi — no extra software required.

<p align="center">
  <img src="docs/assets/screenshots/viewing-1.png" alt="Full-format preview" width="860" />
</p>

### Deep AI integration

No vendor lock-in — mainstream CLI agents adapted straight into the editor:

- **Claude Code**
- **Codex CLI**
- **Gemini CLI**
- **Opencode**
- **Pi Code Agent**
- **Qoder**

Configure CLI paths in Settings → AI. Switch freely across model vendors by task or preference.

<p align="center">
  <img src="docs/assets/screenshots/ai-1.png" alt="AI integration" width="860" />
</p>

### Desktop pet assistant

Resident on desktop, pushes schedule reminders and task changes to the foreground; click to bring up the LLM chat window and ask anytime without breaking your flow.

External apps (scripts, cron, CI) can trigger pet notifications via a local HTTP API — default `127.0.0.1:17382`, `POST /pet/action` pushes a bubble, supporting `target` navigation, `launch` to open a URL/app, and `actions` for bubble buttons. See [`docs/pet-notify-api.en.md`](docs/pet-notify-api.en.md).

<p align="center">
  <img src="docs/assets/screenshots/pet-1.png" alt="Desktop pet" width="860" />
</p>

### In-app terminal

Open a terminal panel inside the Mochi workspace, side-by-side with the editor, file paths auto-synced. Claude Code / Codex CLI / other agents can modify the current document directly; AI edits appear in the editor immediately. Command output can be pasted back at the cursor — "edit → invoke → paste back" collapses into one pipeline.

<p align="center">
  <img src="docs/assets/screenshots/terminal-1.png" alt="In-app terminal" width="860" />
</p>

### Plugin system

Microkernel + plugin SDK architecture; the core stays lean and features load on demand:

- **Translation** — Multilingual content processing
- **Schedule** — Task settings / notifications / focus pomodoro / task board
- **Wiki knowledge base** — Organize and link knowledge entries as a Wiki, building a navigable knowledge network
- **Clips** — Capture web content and auto-summarize pages
- **Project analysis** — Analyze GitHub projects, output HTML analysis reports

Third-party plugin extensions supported; see `docs/plugins.html`.

<p align="center">
  <img src="docs/assets/screenshots/plugins-1.png" alt="Plugins" width="860" />
</p>

### Voice input

Speech is transcribed to text in real time and auto-polished — removing filler and pauses — then pasted at the cursor. Currently macOS only; Windows not yet supported.

<p align="center">
  <img src="docs/assets/screenshots/voice-1.png" alt="Voice input" width="860" />
</p>

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
mochi/
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
│   ├── cli-adapter/          # AI CLI adapter abstraction (Claude / Codex / Gemini / Opencode / Pi / Qoder)
│   ├── container-plugins/    # Markdown container directive plugins
│   ├── plugin-host/          # Plugin host runtime
│   ├── plugin-sdk/           # Plugin SDK for third-party authors
│   ├── create-mochi-plugin/  # Plugin scaffolding CLI
│   └── vault-provider/       # Vault storage provider abstraction
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Extension Points

- **`cli-adapter` package** — Implement the adapter interface to plug in a new CLI Agent
- **`container-plugins` package** — Custom `:::directive` container plugins, registered to the slash menu
- **`vault-provider` package** — Custom storage backends (beyond local / GitHub / WebDAV / S3)
- **`plugin-host` + `plugin-sdk`** — Third-party plugins register capabilities via the SDK; the microkernel loads them on demand
- **`create-mochi-plugin`** — Scaffolding CLI to quickly start a new plugin
- **File types** — Register a new Handler under `apps/desktop/src/components/file-types/` to extend file types

See `docs/plugins.html` for details.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Tauri 2 system deps — see [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

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

## License

MIT
