[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md)

<h1 align="center">Éditeur Quill</h1>

<p align="center">
  Local d'abord · Vault isolé · AI natif<br/>
  Local-first, vault-based, AI-native knowledge workspace.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" />
  <img alt="downloads" src="https://img.shields.io/github/downloads/linyimin0812/quill/total?label=downloads" />
  <img alt="stack" src="https://img.shields.io/badge/Tauri-2-orange" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

> Une seule application, tout votre contexte. Isolez chaque jeu de données dans un Vault, rassemblez markdown, tableaux blancs, diagrammes ER et cartes mentales dans un seul éditeur, et branchez les agents IA directement sur votre flux de travail — tout reste sur vos propres appareils.

## Why Quill

- **Isolation multi-Vault** — Ouvrez un Vault séparé pour chaque projet ou jeu de notes. Les données restent indépendantes, basculez à tout moment. Votre appareil local est la source de vérité unique.
- **Édition multi-format** — Markdown (avec plugins de conteneur : Button / Callout / Card / Tabs / Timeline / Steps / Grid / FilePreview / StatusTag / Collapsible, plus conteneurs de diagrammes Graphviz / Mermaid / PlantUML), texte enrichi, CSV, JSON, cartes mentales markmap, diagrammes ER dbml, diagrammes d'architecture drawio, tableaux blancs manuels excalidraw, DOT graphviz — un seul éditeur pour tout.
- **Prévisualisation universelle** — Documents Office, audio/vidéo, archives, livres électroniques, présentations et plans — visualisez sans quitter Quill.
- **Intégration IA profonde** — Adaptateurs intégrés pour six agents CLI : Claude Code, Codex CLI, Gemini CLI, Opencode, Pi Code Agent, Qoder. Basculez librement entre les fournisseurs de modèles, sans verrouillage.
- **Assistant animal de bureau** — Un compagnon résident sur le bureau qui pousse les rappels de calendrier et les notifications de changement de tâche ; un clic ouvre un chat avec le LLM.
- **Terminal intégré** — Ouvrez un terminal dans Quill et laissez Claude Code / Codex / autres agents CLI lire et écrire le document courant — pas de changement de fenêtre.
- **Système de plugins** — Architecture microkernel + SDK plugin. Traduction, calendrier, Wiki, Clips et analyse de projet sont fournis en tant que plugins ; extensions tierces prises en charge.
- **Saisie vocale** — Synthèse vocale en texte avec polissage automatique, collée directement au curseur (actuellement macOS uniquement).

## For Users

### Notes de première exécution

L'application n'est pas signée ; le système la bloquera au premier lancement. Procédez comme suit :

- **Windows** : Un avertissement SmartScreen « Windows a protégé votre PC » apparaît au premier lancement. Cliquez sur **Plus d'informations → Exécuter quand même**.
- **macOS** : Si « impossible d'ouvrir » ou « endommagé » apparaît après l'installation, exécutez dans le Terminal :
  ```bash
  xattr -cr /Applications/Quill.app
  ```
  Puis rouvrez depuis le Launchpad.

### Isolation multi-Vault

Ouvrez un Vault séparé pour chaque projet ou jeu de notes. Chaque Vault est un espace de données indépendant — notes, pièces jointes et configurations de plugins sont stockés séparément ; changer de Vault équivaut à changer d'environnement de travail complet. Les données restent sur l'appareil local ; aucun compte cloud requis.

<p align="center">
  <img src="docs/assets/screenshots/vault-1.png" alt="Vault switching" width="860" />
</p>

### Édition multi-format

- **Markdown** — Syntaxe standard + un ensemble de plugins de conteneur : Button / Callout / Card / Collapsible / FilePreview / Grid / StatusTag / Steps / Tabs / Timeline, plus conteneurs de diagrammes Graphviz / Mermaid / PlantUml
- **Texte enrichi** — WYSIWYG, pour les mises en page sans syntaxe markdown
- **Données structurées** — CSV, JSON, édités directement
- **Cartes mentales** — markmap, plans markdown auto-rendus en structure visuelle
- **Modélisation et diagrammes** — dbml (ER) / drawio (architecture, flux) / excalidraw (tableau blanc manuel) / graphviz (DOT) / plantuml / mermaid

<p align="center">
  <img src="docs/assets/screenshots/editing-2.png" alt="Markdown editor with container plugins" width="860" />
</p>

### Prévisualisation universelle

Visualisez documents Office, audio/vidéo, archives, livres électroniques, présentations et plans sans quitter Quill — aucun logiciel supplémentaire requis.

<p align="center">
  <img src="docs/assets/screenshots/viewing-1.png" alt="Full-format preview" width="860" />
</p>

### Intégration IA profonde

Pas de verrouillage fournisseur — les principaux agents CLI sont adaptés directement dans l'éditeur :

- **Claude Code**
- **Codex CLI**
- **Gemini CLI**
- **Opencode**
- **Pi Code Agent**
- **Qoder**

Configurez les chemins CLI dans Settings → AI. Basculez librement entre fournisseurs selon la tâche ou la préférence.

<p align="center">
  <img src="docs/assets/screenshots/ai-1.png" alt="AI integration" width="860" />
</p>

### Assistant animal de bureau

Résident sur le bureau, pousse les rappels de calendrier et les changements de tâche au premier plan ; un clic ouvre la fenêtre de chat LLM pour poser des questions sans interrompre votre flux.

Les applications externes (scripts, cron, CI) peuvent déclencher des notifications via une API HTTP locale — par défaut `127.0.0.1:17382`, `POST /pet/action` pousse une bulle, prenant en charge `target` pour la navigation, `launch` pour ouvrir une URL ou une application, et `actions` pour les boutons de bulle. Voir [`docs/pet-notify-api.fr.md`](docs/pet-notify-api.fr.md).

<p align="center">
  <img src="docs/assets/screenshots/pet-1.png" alt="Desktop pet" width="860" />
</p>

### Terminal intégré

Ouvrez un panneau terminal dans l'espace de travail Quill, côte à côte avec l'éditeur, chemins de fichiers synchronisés automatiquement. Claude Code / Codex CLI / autres agents peuvent modifier directement le document courant ; les modifications IA apparaissent immédiatement dans l'éditeur. La sortie de commande peut être recollée au curseur — « éditer → appeler → coller » compressé en un seul pipeline.

<p align="center">
  <img src="docs/assets/screenshots/terminal-1.png" alt="In-app terminal" width="860" />
</p>

### Système de plugins

Architecture microkernel + SDK plugin ; le cœur reste léger et les fonctionnalités se chargent à la demande :

- **Traduction** — Traitement de contenu multilingue
- **Calendrier** — Paramètres de tâches / notifications / pomodoro de concentration / tableau de tâches
- **Base de connaissances Wiki** — Organiser et lier les entrées de connaissance en Wiki, construire un réseau de connaissances navigable
- **Clips** — Capturer le contenu web et résumer automatiquement les pages
- **Analyse de projet** — Analyser des projets GitHub, produire des rapports HTML

Extensions tierces prises en charge ; voir `docs/plugins.html`.

<p align="center">
  <img src="docs/assets/screenshots/plugins-1.png" alt="Plugins" width="860" />
</p>

### Saisie vocale

La parole est transcrite en texte en temps réel et polie automatiquement — supprimant les hésitations et les répétitions — puis collée au curseur. Actuellement macOS uniquement ; Windows pas encore pris en charge.

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
│   ├── cli-adapter/          # AI CLI adapter abstraction (Claude / Codex / Gemini / Opencode / Pi / Qoder)
│   ├── container-plugins/    # Markdown container directive plugins
│   ├── plugin-host/          # Plugin host runtime
│   ├── plugin-sdk/           # Plugin SDK for third-party authors
│   ├── create-quill-plugin/  # Plugin scaffolding CLI
│   └── vault-provider/       # Vault storage provider abstraction
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Extension Points

- **Package `cli-adapter`** — Implémentez l'interface d'adaptateur pour brancher un nouvel Agent CLI
- **Package `container-plugins`** — Plugins de conteneur `:::directive` personnalisés, enregistrés dans le menu slash
- **Package `vault-provider`** — Backends de stockage personnalisés (au-delà de local / GitHub / WebDAV / S3)
- **`plugin-host` + `plugin-sdk`** — Les plugins tiers enregistrent des capacités via le SDK ; le microkernel les charge à la demande
- **`create-quill-plugin`** — CLI de scaffolding pour démarrer rapidement un nouveau plugin
- **Types de fichiers** — Enregistrez un nouveau Handler sous `apps/desktop/src/components/file-types/` pour étendre les types de fichiers

Voir `docs/plugins.html` pour les détails.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Dépendances système Tauri 2 — voir [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

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
