# Extension Dev Skill

> `packages/extension-dev-skill` — agent skill package, not application code.

---

This package (`folyn-extension-dev-skill`) is an orchestrator skill for AI coding agents: it walks an agent through the extension lifecycle **scaffold → develop → build & test → publish**. Its documentation is the skill itself:

- **Authoritative doc**: [`packages/extension-dev-skill/SKILL.md`](../../../../packages/extension-dev-skill/SKILL.md)
- Depth references: `packages/extension-dev-skill/references/contribution-points.md`, `references/publish-checklist.md`

Do not duplicate the skill's content here — when working on extension development flows, read the SKILL.md directly. Changes to the skill are edits to that file (plus `index.js` if the dispatch metadata changes).

For the code the skill points at, see the specs for [`extension-sdk`](../../extension-sdk/frontend/index.md), [`extension-host`](../../extension-host/frontend/index.md), and [`create-folyn-extension`](../../create-folyn-extension/frontend/index.md).
