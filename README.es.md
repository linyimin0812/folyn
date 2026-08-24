[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md)

<h1 align="center">Editor Folyn</h1>

<p align="center">
  Local primero · Vault aislado · IA nativa<br/>
  Local-first, vault-based, AI-native knowledge workspace.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" />
  <img alt="downloads" src="https://img.shields.io/github/downloads/linyimin0812/folyn/total?label=downloads" />
  <img alt="stack" src="https://img.shields.io/badge/Tauri-2-orange" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

> Una app, todo tu contexto. Aísla cada conjunto de datos en un Vault, reúne markdown, pizarras, diagramas ER y mapas mentales en un solo editor, y conecta los agentes de IA directamente a tu flujo — todo permanece en tus propios dispositivos.

## Why Folyn

- **Aislamiento multi-Vault** — Abre un Vault separado para cada proyecto o conjunto de notas. Los datos son independientes entre sí, cambia en cualquier momento. Tu dispositivo local es la única fuente de verdad.
- **Edición multiformato** — Markdown (con plugins de contenedor: Button / Callout / Card / Tabs / Timeline / Steps / Grid / FilePreview / StatusTag / Collapsible, más contenedores de diagramas Graphviz / Mermaid / PlantUML), texto enriquecido, CSV, JSON, mapas mentales markmap, diagramas ER dbml, diagramas de arquitectura drawio, pizarras manuales excalidraw, DOT graphviz — un editor para todo.
- **Vista previa universal** — Documentos de Office, audio/vídeo, archivos comprimidos, libros electrónicos, presentaciones y planos — visualízalos sin salir de Folyn.
- **Integración profunda de IA** — Adaptadores integrados para seis agentes CLI: Claude Code, Codex CLI, Gemini CLI, Opencode, Pi Code Agent, Qoder. Cambia libremente entre proveedores de modelos, sin atarte a uno.
- **Asistente mascota de escritorio** — Un compañero residente en el escritorio que envía recordatorios de calendario y notificaciones de cambios de tareas; un clic abre un chat con el LLM.
- **Terminal integrada** — Abre una terminal dentro de Folyn y deja que Claude Code / Codex / otros agentes CLI lean y escriban el documento actual — sin cambiar de ventana.
- **Sistema de plugins** — Arquitectura de microkernel + SDK de plugin. Traducción, calendario, Wiki, Clips y análisis de proyectos se entregan como plugins; se admiten extensiones de terceros.
- **Entrada por voz** — Voz a texto con pulido automático, pegado directo en el cursor (actualmente solo macOS).

## For Users

### Notas sobre el primer inicio

La app no está firmada con código; el sistema la bloqueará en el primer inicio. Desbloquéala así:

- **Windows**: Al primer inicio verás una advertencia de SmartScreen “Windows protegió tu PC”. Haz clic en **Más información → Ejecutar de todos modos**.
- **macOS**: Si aparece “no se puede abrir” o “está dañado” tras la instalación, ejecuta en Terminal:
  ```bash
  xattr -cr /Applications/Folyn.app
  ```
  Luego vuelve a abrir desde Launchpad.

### Aislamiento multi-Vault

Abre un Vault separado para cada proyecto o conjunto de notas. Cada Vault es su propio espacio de datos — notas, adjuntos y configuraciones de plugins se almacenan de forma independiente; cambiar de Vault es como cambiar de entorno de trabajo completo. Los datos permanecen en el dispositivo local; no se requiere cuenta en la nube.

<p align="center">
  <img src="docs/assets/screenshots/vault-1.png" alt="Vault switching" width="860" />
</p>

### Edición multiformato

- **Markdown** — Sintaxis estándar + un conjunto de plugins de contenedor: Button / Callout / Card / Collapsible / FilePreview / Grid / StatusTag / Steps / Tabs / Timeline, más contenedores de diagramas Graphviz / Mermaid / PlantUml
- **Texto enriquecido** — WYSIWYG, para composiciones que no necesitan sintaxis markdown
- **Datos estructurados** — CSV, JSON, editados directamente
- **Mapas mentales** — markmap, esquemas markdown auto-renderizados como estructura visual
- **Modelado y diagramas** — dbml (ER) / drawio (arquitectura, flujo) / excalidraw (pizarra manual) / graphviz (DOT) / plantuml / mermaid

<p align="center">
  <img src="docs/assets/screenshots/editing-2.png" alt="Markdown editor with container plugins" width="860" />
</p>

### Vista previa universal

Visualiza documentos de Office, audio/vídeo, archivos comprimidos, libros electrónicos, presentaciones y planos sin salir de Folyn — no hace falta software adicional.

<p align="center">
  <img src="docs/assets/screenshots/viewing-1.png" alt="Full-format preview" width="860" />
</p>

### Integración profunda de IA

Sin atarse a un proveedor — los principales agentes CLI adaptados directamente al editor:

- **Claude Code**
- **Codex CLI**
- **Gemini CLI**
- **Opencode**
- **Pi Code Agent**
- **Qoder**

Configura las rutas CLI en Settings → AI. Cambia libremente entre proveedores según la tarea o la preferencia.

<p align="center">
  <img src="docs/assets/screenshots/ai-1.png" alt="AI integration" width="860" />
</p>

### Asistente mascota de escritorio

Residente en el escritorio, envía recordatorios de calendario y cambios de tarea al frente; un clic abre la ventana de chat con el LLM para preguntar sin interrumpir el ritmo de trabajo.

Las apps externas (scripts, cron, CI) pueden disparar notificaciones de la mascota vía una API HTTP local — por defecto `127.0.0.1:17382`, `POST /pet/action` envía una burbuja, soportando `target` para navegación, `launch` para abrir URL/app, y `actions` para botones de burbuja. Ver [`docs/pet-notify-api.es.md`](docs/pet-notify-api.es.md).

<p align="center">
  <img src="docs/assets/screenshots/pet-1.png" alt="Desktop pet" width="860" />
</p>

### Terminal integrada

Abre un panel de terminal en el espacio de trabajo de Folyn, junto al editor, con rutas de archivo sincronizadas automáticamente. Claude Code / Codex CLI / otros agentes pueden modificar el documento actual directamente; las ediciones de IA aparecen en el editor al instante. La salida de comandos se puede re-pegar en el cursor — “editar → invocar → re-pegar” se comprime en un solo flujo.

<p align="center">
  <img src="docs/assets/screenshots/terminal-1.png" alt="In-app terminal" width="860" />
</p>

### Sistema de plugins

Arquitectura de microkernel + SDK de plugin; el núcleo se mantiene ligero y las funciones se cargan bajo demanda:

- **Traducción** — Procesamiento de contenido multilingüe
- **Calendario** — Ajustes de tareas / notificaciones / pomodoro de enfoque / tablero de tareas
- **Base de conocimiento Wiki** — Organizar y enlazar entradas de conocimiento como Wiki, construyendo una red navegable
- **Clips** — Capturar contenido web y resumir páginas automáticamente
- **Análisis de proyectos** — Analizar proyectos de GitHub, generar informes en HTML

Extensiones de terceros soportadas; ver `docs/plugins.html`.

<p align="center">
  <img src="docs/assets/screenshots/plugins-1.png" alt="Plugins" width="860" />
</p>

### Entrada por voz

El habla se transcribe a texto en tiempo real y se pule automáticamente — eliminando muletillas y pausas — y se pega en el cursor. Actualmente solo macOS; Windows aún no soportado.

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

- **Paquete `cli-adapter`** — Implementa la interfaz de adaptador para conectar un nuevo Agent de CLI
- **Paquete `container-plugins`** — Plugins de contenedor `:::directive` personalizados, registrados en el menú slash
- **Paquete `vault-provider`** — Backends de almacenamiento personalizados (más allá de local / GitHub / WebDAV / S3)
- **`plugin-host` + `plugin-sdk`** — Plugins de terceros registran capacidades vía el SDK; el microkernel los carga bajo demanda
- **`create-folyn-plugin`** — CLI de scaffolding para iniciar rápidamente un nuevo plugin
- **Tipos de archivo** — Registra un nuevo Handler bajo `apps/desktop/src/components/file-types/` para extender tipos de archivo

Ver `docs/plugins.html` para detalles.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Dependencias del sistema de Tauri 2 — ver [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

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
