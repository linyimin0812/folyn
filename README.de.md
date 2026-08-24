[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md)

<h1 align="center">Folyn Editor</h1>

<p align="center">
  Lokal zuerst · Vault-isoliert · KI-nativ<br/>
  Local-first, vault-based, AI-native knowledge workspace.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" />
  <img alt="downloads" src="https://img.shields.io/github/downloads/linyimin0812/folyn/total?label=downloads" />
  <img alt="stack" src="https://img.shields.io/badge/Tauri-2-orange" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

> Eine App, all Ihr Wissen. Isoliert jeden Datensatz in einem Vault, fasst Markdown, Whiteboards, ER-Diagramme und Mindmaps in einem Editor zusammen und bindet KI-Agenten direkt in den Workflow ein — alles bleibt auf Ihren eigenen Geräten.

## Why Folyn

- **Vault-Isolierung mehrerer Vaults** — Öffnen Sie für jedes Projekt oder jede Notizsammlung einen eigenen Vault. Daten bleiben unabhängig, jederzeit umschaltbar. Ihr lokales Gerät ist die einzige Wahrheitsquelle.
- **Multi-Format-Bearbeitung** — Markdown (mit Container-Plugins: Button / Callout / Card / Tabs / Timeline / Steps / Grid / FilePreview / StatusTag / Collapsible, sowie Graphviz / Mermaid / PlantUML-Diagramm-Container), Rich-Text, CSV, JSON, markmap-Mindmaps, dbml-ER-Diagramme, drawio-Architekturdiagramme, excalidraw-Handwhiteboards, graphviz-DOT — ein Editor für alles.
- **Universelle Vorschau** — Office-Dokumente, Audio/Video, Archive, E-Books, Präsentationen und Zeichnungen — ohne Folyn zu verlassen ansehen.
- **Tiefe KI-Integration** — Eingebaute Adapter für sechs CLI-Agenten: Claude Code, Codex CLI, Gemini CLI, Opencode, Pi Code Agent, Qoder. Frei zwischen Modellanbietern wechseln, kein Vendor-Lock-in.
- **Desktop-Begleiter-Assistent** — Ein auf dem Desktop residierender Begleiter, der Kalendererinnerungen und Aufgabenänderungen pushst; ein Klick öffnet einen Chat mit dem LLM.
- **Internes Terminal** — Öffnen Sie ein Terminal in Folyn und lassen Sie Claude Code / Codex / andere CLI-Agenten das aktuelle Dokument lesen und schreiben — kein Fensterwechsel.
- **Plugin-System** — Microkernel- + Plugin-SDK-Architektur. Übersetzung, Kalender, Wiki, Clips und Projektanalyse werden als Plugins mitgeliefert; Drittanbieter-Erweiterungen unterstützt.
- **Spracheingabe** — Sprache-zu-Text mit automatischer Nachbearbeitung, direkt am Cursor eingefügt (aktuell nur macOS).

## For Users

### Hinweise zum ersten Start

Die App ist nicht codesigniert; das System blockiert sie beim ersten Start. Gehen Sie wie folgt vor:

- **Windows**: Beim ersten Start erscheint eine SmartScreen-Warnung „Windows hat Ihren PC geschützt“. Klicken Sie **Weitere Informationen → Trotzdem ausführen**.
- **macOS**: Erscheint nach der Installation „kann nicht geöffnet werden“ oder „beschädigt“, führen Sie im Terminal aus:
  ```bash
  xattr -cr /Applications/Folyn.app
  ```
  Öffnen Sie dann erneut aus dem Launchpad.

### Vault-Isolierung mehrerer Vaults

Öffnen Sie für jedes Projekt oder jede Notizsammlung einen eigenen Vault. Jeder Vault ist ein eigener Datenraum — Notizen, Anhänge und Plugin-Konfigurationen werden getrennt gespeichert; Vault-Wechsel ist wie ein kompletter Arbeitsumgebungswechsel. Daten bleiben auf dem lokalen Gerät; kein Cloud-Konto nötig.

<p align="center">
  <img src="docs/assets/screenshots/vault-1.png" alt="Vault switching" width="860" />
</p>

### Multi-Format-Bearbeitung

- **Markdown** — Standard-Syntax + eine Reihe Container-Plugins: Button / Callout / Card / Collapsible / FilePreview / Grid / StatusTag / Steps / Tabs / Timeline, sowie Graphviz / Mermaid / PlantUml-Diagramm-Container
- **Rich-Text** — WYSIWYG, für Layouts ohne Markdown-Syntax
- **Strukturierte Daten** — CSV, JSON, direkt bearbeiten
- **Mindmaps** — markmap, Markdown-Outlines automatisch als visuelle Struktur gerendert
- **Modellierung & Diagramme** — dbml (ER) / drawio (Architektur, Fluss) / excalidraw (Hand-Whiteboard) / graphviz (DOT) / plantuml / mermaid

<p align="center">
  <img src="docs/assets/screenshots/editing-2.png" alt="Markdown editor with container plugins" width="860" />
</p>

### Universelle Vorschau

Office-Dokumente, Audio/Video, Archive, E-Books, Präsentationen und Zeichnungen ohne Folyn-Verlassen ansehen — keine zusätzliche Software nötig.

<p align="center">
  <img src="docs/assets/screenshots/viewing-1.png" alt="Full-format preview" width="860" />
</p>

### Tiefe KI-Integration

Kein Vendor-Lock-in — gängige CLI-Agenten direkt in den Editor integriert:

- **Claude Code**
- **Codex CLI**
- **Gemini CLI**
- **Opencode**
- **Pi Code Agent**
- **Qoder**

CLI-Pfade unter Settings → AI konfigurieren. Nach Aufgabe oder Vorliebe frei zwischen Anbietern wechseln.

<p align="center">
  <img src="docs/assets/screenshots/ai-1.png" alt="AI integration" width="860" />
</p>

### Desktop-Begleiter-Assistent

Residiert auf dem Desktop, pusht Kalendererinnerungen und Aufgabenänderungen in den Vordergrund; ein Klick öffnet das LLM-Chat-Fenster und erlaubt Fragen ohne Arbeitsfluss zu unterbrechen.

Externe Apps (Skripte, cron, CI) können Benachrichtigungen über eine lokale HTTP-API auslösen — standardmäßig `127.0.0.1:17382`, `POST /pet/action` pusht eine Blase, unterstützt `target`-Navigation, `launch` zum Öffnen einer URL/App und `actions` für Blasen-Buttons. Siehe [`docs/pet-notify-api.de.md`](docs/pet-notify-api.de.md).

<p align="center">
  <img src="docs/assets/screenshots/pet-1.png" alt="Desktop pet" width="860" />
</p>

### Internes Terminal

Öffnen Sie ein Terminal-Panel im Folyn-Arbeitsbereich, nebeneinander mit dem Editor, Dateipfade automatisch synchronisiert. Claude Code / Codex CLI / andere Agenten können das aktuelle Dokument direkt ändern; KI-Bearbeitungen erscheinen sofort im Editor. Kommando-Ausgabe kann am Cursor zurückeingefügt werden — „Bearbeiten → Aufrufen → Zurücksetzen“ zu einer Pipeline verdichtet.

<p align="center">
  <img src="docs/assets/screenshots/terminal-1.png" alt="In-app terminal" width="860" />
</p>

### Plugin-System

Microkernel- + Plugin-SDK-Architektur; der Kern bleibt schlank, Funktionen werden bei Bedarf geladen:

- **Übersetzung** — Mehrsprachige Inhaltsverarbeitung
- **Kalender** — Aufgabeneinstellungen / Benachrichtigungen / Fokus-Pomodoro / Aufgaben-Board
- **Wiki-Wissensbasis** — Wissenseinträge als Wiki organisieren und verlinken, ein navigierbares Wissensnetz aufbauen
- **Clips** — Web-Inhalte erfassen und Seiten automatisch zusammenfassen
- **Projektanalyse** — GitHub-Projekte analysieren, HTML-Berichte ausgeben

Drittanbieter-Plugin-Erweiterungen unterstützt; siehe `docs/plugins.html`.

<p align="center">
  <img src="docs/assets/screenshots/plugins-1.png" alt="Plugins" width="860" />
</p>

### Spracheingabe

Sprache wird in Echtzeit zu Text transkribiert und automatisch nachbearbeitet — Füllwörter und Pausen entfernt — und am Cursor eingefügt. Aktuell nur macOS; Windows noch nicht unterstützt.

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
folyn/
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
│   ├── create-folyn-plugin/  # Plugin scaffolding CLI
│   └── vault-provider/       # Vault storage provider abstraction
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Extension Points

- **`cli-adapter`-Paket** — Adapter-Schnittstelle implementieren, um einen neuen CLI-Agenten anzubinden
- **`container-plugins`-Paket** — Eigene `:::directive`-Container-Plugins, im Slash-Menü registriert
- **`vault-provider`-Paket** — Eigene Storage-Backends (über local / GitHub / WebDAV / S3 hinaus)
- **`plugin-host` + `plugin-sdk`** — Drittanbieter-Plugins registrieren Fähigkeiten über das SDK; der Microkernel lädt sie bei Bedarf
- **`create-folyn-plugin`** — CLI-Gerüst, um schnell ein neues Plugin zu starten
- **Dateitypen** — Einen neuen Handler unter `apps/desktop/src/components/file-types/` registrieren, um Dateitypen zu erweitern

Siehe `docs/plugins.html` für Details.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Tauri 2 Systemabhängigkeiten — siehe [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

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
