# Quill

AI-enhanced local-first Markdown editor built with Tauri 2 + React + CodeMirror 6.

## Features

- **Markdown editing** — CodeMirror 6-based editor with syntax highlighting, GFM support, remark directives, and slash commands
- **Live preview** — Real-time Markdown rendering with code highlighting (highlight.js), container directives, and synchronized scrolling
- **AI assistant** — Built-in side panel that integrates with CLI-based AI tools (e.g. Claude Code) for writing assistance, code generation, and file editing with diff review
- **Vault system** — Local-first document management with pluggable storage backends (local filesystem, GitHub, WebDAV, S3)
- **Container plugins** — Extensible directive system (`:::callout`, `:::tabs`, etc.) with a plugin registry and slash menu insertion
- **Export** — Export documents as Markdown, HTML, or PDF
- **Themes** — Light / Dark / System appearance modes
- **Customizable** — Configurable editor font, font size, tab size, line numbers, auto-save, shortcuts, and more
- **Cross-platform** — Desktop app for macOS, Windows, and Linux via Tauri 2

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri 2 (Rust) |
| Frontend | React 18, Vite 6, TypeScript |
| Editor | CodeMirror 6 |
| Markdown | unified / remark / rehype pipeline |
| State | Zustand 5 |
| Styling | Tailwind CSS 3 |
| Monorepo | pnpm workspaces |

## Project Structure

```
quill/
├── apps/
│   └── desktop/              # Tauri desktop app
│       ├── src/              # React frontend
│       │   ├── components/   # UI components (shell, editor, AI, sidebar, etc.)
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

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Tauri 2 system dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Getting Started

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

All settings are accessible from the in-app **Settings** page:

| Category | Options |
|----------|---------|
| Appearance | Theme, font size, line height, status bar, AI panel visibility |
| Editor | Font, font size, tab size, wrap column, line numbers, syntax highlighting, auto-save, spell check |
| Shortcuts | Customizable keyboard shortcuts (Save, Bold, Italic, etc.) |
| AI | CLI adapter selection, CLI path |
| Vault | Vault path, image path, document extension, file watching, trash on delete |
| Sync | Sync method (S3 / WebDAV), endpoint, credentials, E2E encryption |

## AI Integration

Quill integrates with AI CLI tools through a pluggable adapter system. Out of the box it supports Claude Code — set the CLI path in Settings → AI, and use the side panel to chat, generate text, or apply code edits with full diff review.

## License

MIT
