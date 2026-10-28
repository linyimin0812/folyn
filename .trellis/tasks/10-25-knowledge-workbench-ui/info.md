# Design references

- UI notes: /Users/yiminlin/.codex/visualizations/2026/10/24/01a16dbd-7233-72c0-b51d-3d0b3d1883dd/folyn-knowledge-ui-notes.md
- Prototype: /Users/yiminlin/.codex/visualizations/2026/10/24/01a16dbd-7233-72c0-b51d-3d0b3d1883dd/folyn-knowledge-ui.html
- Existing source files under components/knowledge; do not overwrite user's uncommitted work. Inspect before editing.
- Confirmed code issues: Workbench inner wrapper lacks flex, null content means loading AND error; snapshot excerpt state never resets on new citation. Main text is unbounded; sidebar uses 10px for primary information; answer currently whitespace-pre-wrap only.
- Prefer useful overview/list and editorial reading layout, theme-aware subtle dividers. No dashboard metrics cards or new app shell.
