# Mochi

A Tauri desktop app with an embedded AI pet (Cloudia) that surfaces notifications via bubble templates, corner toasts, and an interactive panel. Multi-vault, multi-feature (study / analyze / clips / schedule / wiki), plugin-host AI capability for trusted-tier plugins.

## Language

**Bubble Template AI Agent**:
The "AI 生成" entry point in `BubbleTemplateBlock` (settings → notifications). A multi-turn LLM chat that clarifies the user's intent and drafts a `BubbleTemplate`. Despite the label "AI Agent", it is NOT an agent loop — no tools, no file access, no self-sanitization. Backed by `runRigChat` (multi-turn, tool-free, history persisted by the rig backend keyed by `sessionId`). Accepts three input modes: free text, HTML file upload (read as text, injected into the prompt), and image file upload (vision; sent as image content blocks, requires the rig backend extension recorded in ADR-0001). Output is a `BubbleTemplate` JSON in a `\`\`json` code fence that enters the same `tryImport` validation + `addTemplate` path as user-pasted JSON. See ADR-0001 for the rejected alternatives (agent loop, plugin agent).
_Avoid_: Template Agent, Feature Agent (overlaps with `runFeatureAgent`-backed feature agents like study/wiki), Plugin Agent (overlaps with `buildPluginAi.agent`).

**Feature Agent**:
A vault-scoped agent loop backed by `runFeatureAgent` — spawns the `claude-cli` sidecar with tools, file-system access, and a canonical `agents/<feature>.md` system prompt seeded into `<vault>/__<feature>__/.claude/`. Currently registered: study, analyze, clips, schedule, wiki. Distinct from the Bubble Template AI Agent despite both being called "agent" in casual speech.
_Avoid_: AI Agent (ambiguous — could mean either Bubble Template AI Agent or a Feature Agent).

**Version Snapshot**:
The content of a Versionable File at a single moment, stored as a blob file named by the SHA-256 of its UTF-8 bytes under `~/.mochi/vaults/<vaultId>/versions/blobs/`. Snapshots are taken on file save and on tab close; identical-to-last-hash writes are skipped (dedup). Restore always snapshots the current state first, then overwrites with the chosen snapshot's blob.
_Avoid_: backup, checkpoint, save-state.

**Version Index**:
Per-vault JSON file at `~/.mochi/vaults/<vaultId>/versions/index.json` mapping each vault-relative file path to a time-ordered array of `{hash, ts, size}` entries — the lookup table that pairs Version Snapshot blobs back to the files and moments they belong to. Single source of truth for "what versions does this file have"; rewritten atomically on each new snapshot.
_Avoid_: version log, history manifest.

**Versionable File**:
Any file whose type has an editor registered in `apps/desktop/src/components/file-types/` (markdown, html, code, plantuml, graphviz, csv, json, svg, web, clip, dbml, drawio, excalidraw, mmap, rich-text). Only these files participate in version history; non-editor types (images, previews) do not. First snapshot is lazy — taken the first time the file is saved or its tab is closed after the feature ships, not at feature rollout.
_Avoid_: tracked file, versioned file (overlaps with git).
