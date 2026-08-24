[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md)

<h1 align="center">Mochi エディター</h1>

<p align="center">
  ローカル優先 · Vault 分離 · AI ネイティブ<br/>
  Local-first, vault-based, AI-native knowledge workspace.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" />
  <img alt="downloads" src="https://img.shields.io/github/downloads/linyimin0812/mochi/total?label=downloads" />
  <img alt="stack" src="https://img.shields.io/badge/Tauri-2-orange" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

> ひとつのアプリに、すべての文脈を。Vault で各データを隔離し、markdown・ホワイトボード・ER 図・マインドマップをひとつのエディタに収め、AI エージェントをワークフローに直接接続します——すべてのデータはあなたのデバイスに残ります。

## Why Mochi

- **Vault の複数倉庫隔離** — プロジェクトやメモごとに独立した Vault を作成。データは互いに干渉せず、いつでも切り替え可能。ローカルが唯一の真のソースです。
- **多形式編集** — Markdown（コンテナプラグイン：Button / Callout / Card / Tabs / Timeline / Steps / Grid / FilePreview / StatusTag / Collapsible、および Graphviz / Mermaid / PlantUML 図表コンテナ）、リッチテキスト、CSV、JSON、markmap マインドマップ、dbml ER 図、drawio アーキテクチャ図、excalidraw 手描きホワイトボード、graphviz DOT——ひとつのエディタですべて対応。
- **全形式プレビュー** — Office ドキュメント、音声・動画、アーカイブ、電子書籍、プレゼンや図面を Mochi から離れずに表示。
- **AI 深度統合** — 6 種の CLI エージェントを内蔵アダプターで統合：Claude Code、Codex CLI、Gemini CLI、Opencode、Pi Code Agent、Qoder。モデルベンダーを横断して自由に切り替え、単一ベンダーに縛られません。
- **デスクトップペットアシスタント** — デスクトップ常駐の相棒がスケジュール通知やタスク変更通知をプッシュし、クリックで LLM とのチャットを起動します。
- **アプリ内ターミナル** — Mochi 内でターミナルを開き、Claude Code / Codex などの CLI エージェントが現在のドキュメントを読み書き——ウィンドウ切り替え不要。
- **プラグインシステム** — マイクロカーネル + プラグイン SDK アーキテクチャ。翻訳・スケジュール・Wiki・Clips・プロジェクト分析はプラグインとして提供され、サードパーティ拡張も可能。
- **音声入力** — 音声をテキストに書き起こし自動で補正し、カーソル位置に直接貼り付け（現在は macOS のみ対応）。

## For Users

### 初回実行時の注意

アプリはコード署名されていないため、初回実行時にシステムのセキュリティ警告が出ます。以下の手順で解除してください：

- **Windows**: 初回実行時に SmartScreen の「Windows によって PC は保護されました」警告が出ます。**実行の詳細情報 → 実行**をクリック。
- **macOS**: インストール後に「開けません」または「破損しています」と表示された場合、Terminal で以下を実行：
  ```bash
  xattr -cr /Applications/Mochi.app
  ```
  その後、Launchpad から再度開いてください。

### Vault 複数倉庫隔離

プロジェクトやメモごとに独立した Vault を作成します。各 Vault は独立したデータ空間——メモ・添付ファイル・プラグイン設定は個別に保存され、Vault の切り替えはワークスペースごと切り替えるのと同じです。データはローカルデバイスに保存され、クラウドアカウントに依存しません。

<p align="center">
  <img src="docs/assets/screenshots/vault-1.png" alt="Vault switching" width="860" />
</p>

### 多形式編集

- **Markdown** — 標準構文 + コンテナプラグイン：Button / Callout / Card / Collapsible / FilePreview / Grid / StatusTag / Steps / Tabs / Timeline、および Graphviz / Mermaid / PlantUml 図表コンテナ
- **リッチテキスト** — WYSIWYG、Markdown 構文が不要なレイアウト向け
- **構造化データ** — CSV・JSON を直接編集
- **マインドマップ** — markmap、Markdown アウトラインを自動的に視覚構造に変換
- **モデリングと図** — dbml（ER）／ drawio（アーキテクチャ図・フロー図）／ excalidraw（手描きホワイトボード）／ graphviz（DOT）／ plantuml／ mermaid

<p align="center">
  <img src="docs/assets/screenshots/editing-2.png" alt="Markdown editor with container plugins" width="860" />
</p>

### 全形式プレビュー

Office ドキュメント、音声・動画、アーカイブ、電子書籍、プレゼンや図面を Mochi から離れずに表示——別途ソフトをインストールする必要はありません。

<p align="center">
  <img src="docs/assets/screenshots/viewing-1.png" alt="Full-format preview" width="860" />
</p>

### AI 深度統合

単一モデルベンダーに縛られず、主流の CLI エージェントをエディタに直接統合：

- **Claude Code**
- **Codex CLI**
- **Gemini CLI**
- **Opencode**
- **Pi Code Agent**
- **Qoder**

Settings → AI で CLI パスを設定するだけ。タスクや好みに合わせてモデルベンダーを自由に切り替えられます。

<p align="center">
  <img src="docs/assets/screenshots/ai-1.png" alt="AI integration" width="860" />
</p>

### デスクトップペットアシスタント

デスクトップに常駐し、スケジュールリマインダーやタスク変更を眼前にプッシュします；クリックで LLM チャットウィンドウを起動し、作業リズムを崩さずにいつでも質問できます。

外部アプリ（スクリプト・cron・CI）はローカル HTTP API でペット通知をトリガー可能——デフォルトは `127.0.0.1:17382`、`POST /pet/action` でバブルをプッシュし、`target` でジャンプ、`launch` で URL／アプリを起動、`actions` でバブルボタンをサポート。詳細は [`docs/pet-notify-api.ja.md`](docs/pet-notify-api.ja.md) を参照。

<p align="center">
  <img src="docs/assets/screenshots/pet-1.png" alt="Desktop pet" width="860" />
</p>

### アプリ内ターミナル

Mochi ワークスペース内にターミナルパネルを開き、エディタと並列表示、ファイルパスは自動同期。Claude Code / Codex CLI などのエージェントが現在のドキュメントを直接変更でき、AI の編集結果は即座にエディタに反映されます。コマンド出力はカーソル位置に貼り戻せ、「編集 → 呼び出し → 貼り戻し」を一条のパイプラインに圧縮します。

<p align="center">
  <img src="docs/assets/screenshots/terminal-1.png" alt="In-app terminal" width="860" />
</p>

### プラグインシステム

マイクロカーネル + プラグイン SDK アーキテクチャ、コアは軽量に保ち機能はオンデマンドで読み込み：

- **翻訳** — 多言語コンテンツ処理
- **スケジュール** — タスク設定／通知リマインダー／集中ポモドーロ／タスクボード
- **Wiki 知識ベース** — Wiki 形式でナレッジエントリを組織・リンクし、相互ジャンプ可能なナレッジネットワークを構築
- **Clips** — ウェブコンテンツを取得し自動で要約
- **プロジェクト分析** — GitHub プロジェクトを分析し HTML 形式でレポートを出力

サードパーティプラグイン拡張対応、詳細は `docs/plugins.html` を参照。

<p align="center">
  <img src="docs/assets/screenshots/plugins-1.png" alt="Plugins" width="860" />
</p>

### 音声入力

話し言葉をリアルタイムでテキストに書き起こし自動で補正——口語の繰り返しや間を取り除き、現在のカーソル位置に直接貼り付けます。現在は macOS のみ対応、Windows は未対応。

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

- **`cli-adapter` パッケージ** — アダプターインターフェースを実装すれば新しい CLI Agent を統合可能
- **`container-plugins` パッケージ** — `:::directive` コンテナプラグインをカスタマイズしスラッシュメニューに登録
- **`vault-provider` パッケージ** — カスタムストレージバックエンド（local／GitHub／WebDAV／S3 以外）
- **`plugin-host` + `plugin-sdk`** — サードパーティプラグインは SDK プロトコルで能力を登録、マイクロカーネルがオンデマンドで読み込み
- **`create-mochi-plugin`** — 新しいプラグインを素早く始める足場 CLI
- **ファイル形式** — `apps/desktop/src/components/file-types/` に Handler を登録すれば新しいファイル形式を拡張

詳細は `docs/plugins.html` を参照。

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Tauri 2 のシステム依存 — [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) を参照

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
