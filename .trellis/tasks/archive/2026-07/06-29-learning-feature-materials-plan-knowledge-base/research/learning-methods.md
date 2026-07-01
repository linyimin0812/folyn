# Research: Evidence-Based Learning Methods & Markdown-Driven Embedding

- **Query**: Which evidence-backed learning methods exist, how do mainstream tools implement them, and how to embed each cheaply into Quill's markdown-driven "Study" workbench (one .md per topic, `## 资料`/`## 计划`/`## 笔记` sections, AI via CLI adapter, existing Pomodoro + schedule + wiki links + callouts).
- **Scope**: mixed (external learning science + internal repo grounding)
- **Date**: 2026-06-29

> Note: the `mcp__exa__*` search tools were not available in this research environment. Findings below draw on established, well-documented learning-science literature and the canonical SM-2 spec, cross-checked against the actual Quill repo patterns (cited with file:line). Treat the tool-UX descriptions as widely-known public behavior, not freshly-verified citations.

---

## 1. Repo grounding (what we embed INTO)

Confirmed patterns the embeddings below reuse — no new storage engine, all markdown + existing call paths.

| Capability | Location | Pattern |
|---|---|---|
| Section-managed markdown writeback | `apps/desktop/src/schedule/markdown.ts:1-240` | `## 段` heading → lines matching a managed regex are rewritten in place by `lineIndex`; unmanaged lines preserved verbatim; new records appended to section tail; section missing → created at EOF (`appendToSection` L229). This is THE pattern a `## 复习` section should copy. |
| Structured attrs in list lines | `markdown.ts:21-22` | `- [ ] title @{col:.. cat:.. prio:.. due:.. prog:..}` — `ATTR_RE = /(\w+):(\S+)/g` (L22). Adding `due:`/`next:`/`ef:`/`rep:` attrs is zero-format-cost. |
| Task type | `apps/desktop/src/schedule/types.ts:5` | `TaskCategory` enum; PRD Decision 5 already plans to add `learn`. Study↔schedule link via `study:<slug> unit:<n>` attrs. |
| AI single call path | `packages/cli-adapter/src/claudeAdapter.ts:51-113` | `adapter.send(prompt, {resumeSessionId})` spawns `claude -p --output-format stream-json`. One path for ALL AI actions. |
| AI panel open + attach | `apps/desktop/src/components/sidebar/ContextMenu.tsx:139-140` | `useAiStore.getState().addFileToChat(name, path)` then `useSettingsStore.getState().updateSettings({ showAiPanel: true })`. This is the existing "open AI panel with context" pattern → reuse for "Feynman tutor" / "generate SQ3R questions". |
| AI chat modes | `apps/desktop/src/store/aiStore.ts:15` | `AiChatMode = 'chat' | 'wiki' | 'clip'` + `setChatMode`. A `'study'` mode (or just prefilled prompt) fits. |
| Pomodoro component | `apps/desktop/src/components/schedule/Pomodoro.tsx:1-24` | Work/break rounds, store-driven (`useScheduleStore` pomo slice). Reusable as-is for any study session. |
| Container/callout directives | `packages/container-plugins/src/plugins/CalloutPlugin.tsx:41-49` | `:::callout{type="tip" title="..."}` variants: info/warning/tip/danger/error/note. Reusable for elaboration prompts, Feynman-gap callouts, Q-blocks. |
| Wiki links `[[]]` | `apps/desktop/src/services/wikiIngestService.ts`, `wikiQueryService.ts`, `wikiLintService.ts`, `graphDataBuilder` | Atomic linked notes already supported → Zettelkasten embedding is nearly free. |
| Study topic doc shape (decided) | `.trellis/tasks/06-29-.../prd.md` Decision 2 | One `学习/<主题>.md` with `## 资料` / `## 计划` / `## 笔记`. New `## 复习` section is the natural home for spaced repetition. |
| Plan unit format (decided) | prd.md Decision 4b | `- [ ] 1. 单元名 @{est:2h dep:- prog:0}` — extend with `next:`/`due:` for review scheduling. |

---

## 2. Methods → tool reference → Quill embedding → MVP-fit

| Method | Core idea (one line) | Why it works | What learner does | Tool impl (UX) | Quill embedding (concrete) | MVP-fit |
|---|---|---|---|---|---|---|
| **Spaced Repetition** (Ebbinghaus forgetting curve; SM-2) | Restudy just before the predicted moment of forgetting; expanding intervals. | Each retrieval strengthens the memory trace and pushes the curve flatter; spacing forces reconstruction (deeper encoding) than massed re-exposure. | Rate a card Again/Hard/Good/Easy; scheduler picks next date. | **Anki**: card front/back, daily review queue, SM-2-derived scheduler (ease, intervals, lapses). | New `## 复习` section in topic doc, one line per reviewable atom: `- [ ] 原子摘要 @{next:2026-07-02 rep:2 ef:2.2 lapses:0 src:[[子文档]]}`. Scanner (copy of `schedule/markdown.ts`) surfaces due items; rating writes back `next`/`rep`/`ef` via SM-2 (see §3). Atoms = `## 笔记` bullets or linked sub-docs. | **HIGH value, MED cost** — scheduler is ~30 LOC; reuse section-writeback verbatim. |
| **Active Recall** | Retrieve from memory instead of re-reading; the act of retrieval, not the answer, builds memory. | Retrieval is a learning event (testing effect); it identifies gaps reading hides. | Close the book, write/say what you know, then check. | **Anki** (cloze/Q&A), **RemNote** (notes-as-flashcards: each bullet → a card), **Readwise** (resurfaced highlights → prompt to recall). | AI action "生成自测题" prefills AI panel: `根据 @<topic>.md 的 ## 笔记 生成 5 道回忆题，先只给题，答案折叠`. User answers in `## 笔记` or a `:::callout{type="tip"}` block; AI grades on demand. Pairs with `## 复习` atoms. | **HIGH value, LOW cost** — pure prompt + callout, no scheduler. |
| **Feynman Technique** | Explain the topic in plain language (ELI5); gaps in your explanation = gaps in understanding. | Translating to simple language forces active reorganization and exposes hidden jargon-masking; teaching > recognition. | Draft a simple explanation, find where you get stuck, go back to source, refine. | **Notion** (free-form explain page), **Obsidian** (atomic note in own words). No dedicated tool — it's a writing practice. | AI action "费曼挑战": prefills `扮演一个 5 岁小孩，听我用大白话讲 @<topic>.md 的 <单元>，哪里听不懂就追问，直到我讲清或暴露知识盲区`. Run mid-session in the existing AI panel; user drops exposed gaps into `## 笔记` as `:::callout{type="warning" title="盲区"}`. | **HIGH value, LOW cost** — one AI prompt + callout reuse. |
| **Zettelkasten** (slip-box) | Atomic, self-contained notes linked by references; ideas collide bottom-up to form new insight. | Atomicity forces distillation; linking builds a generative graph rather than a hierarchical archive; context-rich notes are more retrievable. | Write one idea per note in own words; add `[[links]]` to related notes; maintain an index/hub. | **Obsidian**: backlinks + graph view + `[[wikilinks]]` + atomic notes. **RemNote**: concepts as nested bullets with refs. | Already 90% built — `wikiIngestService`/`graphDataBuilder` exist. Embedding = convention: deep notes live under `学习/<主题>/` as atomic `.md`, linked from `## 笔记` via `[[子文档]]` (PRD Decision 4c). Workbench "知识库"区 lists these linked sub-docs (graph already available). | **HIGH value, ~FREE** — convention + reuse. |
| **SQ3R** (Survey/Question/Read/Recite/Review) | Structured reading: survey structure → write questions → read for answers → recite → review. | Pre-questions set a retrieval purpose; recitation = active recall; review = spaced repetition. Turns passive reading into active processing. | Skim headings, write Qs per heading, read to answer, close & recite, periodic review. | **Readwise** (surfacing highlights to re-read/review), **Notion** templates with SQ3R sections. | AI action "SQ3R 预读": given a `## 资料` entry, AI generates survey + per-heading questions, writes them into `## 笔记` as a `:::callout{type="info" title="预读问题"}` block. User reads to answer; review folds into `## 复习`. | **MED value, LOW cost** — prompt + callout. |
| **Interleaving** | Mix different but related topics/problem types within one session rather than blocking one. | Reconstructing "which strategy applies" on each item builds discrimination and transfer; blocks give illusuous fluency. | Shuffle problem types; switch topics every few items. | Few tools enforce this; **Anki** decks can be mixed (filtered decks); **Obsidian** random review plugins. | Cheap MVP: study workbench "今日复习" queue = union of due atoms across ALL topics (not just current), shuffled. A `## 复习` scanner already跨-topic if it walks `学习/*.md`. Label each atom with `topic:<slug>` so the queue shows source. | **MED value, LOW cost** — emerges from a multi-topic review scanner. |
| **Elaboration** | Connect new info to prior knowledge: explain why, give examples, relate to X. | Generative processing builds multiple retrieval paths; self-generated elaborations > provided ones. | After a note, write "this is like…", "because…", "example:…". | **Notion** (free text), **Obsidian** (linked elaborative notes). | Convention + AI nudge: `## 笔记` bullets follow a template `- **概念**: … \| 因为: … \| 例子: … \| 类比: [[…]]`. AI action "追问 elaboration": `对 @<topic>.md ## 笔记 每条要点追问"为什么/举个例子/像什么"，我答后你补全`. Renders in `:::callout{type="tip"}`. | **MED value, LOW cost**. |
| **Desirable Difficulties** (Bjork) | Make learning appropriately harder (spacing, interleaving, variation, testing) to boost durable retention. | Difficulty that triggers effortful retrieval scales long-term retention; "fluency" during study ≠ retention. | Use spacing/interleaving/testing rather than massed re-reading; don't optimize for ease. | Cross-cutting; not a single feature — it's the *rationale* for the above methods. | Not a separate feature — it's the design principle: prefer active-recall/Feynman/interleaved review over "re-read materials". Documented as design note in PRD; no code. | **HIGH value (rationale), FREE**. |
| **Pomodoro** | 25m focused work + 5m break, 4 rounds then long break; protect against fatigue & procrastination. | Time-boxed commitment reduces starting friction; breaks sustain vigilance; externalizing the timer offloads self-regulation. | Start timer, single-task, break, repeat. | **Built in**: Quill `Pomodoro.tsx`. Cross-cutting (Forest, Be Focused, etc.). | **Already exists** — `components/schedule/Pomodoro.tsx`. Embed by surfacing the same component in the Study workbench header, optionally auto-logging a round to `## 计划` unit `prog:` bump or a `## 复习` session stamp. | **FREE** — reuse component. |

---

## 3. SM-2 algorithm spec (minimal implementable scheduler)

Reference: Piotr Wozniak, *SuperMemo 2* (1987) — the canonical algorithm Anki's scheduler descends from. Enough to implement a `reviewAtom(atom, rating)` that writes `next`/`rep`/`ef`/`lapses` attrs back to a `## 复习` line.

### State (per atom, stored as `@{...}` attrs on the markdown line)
- `rep` — successful-repetition count (consecutive), starts 0.
- `ef` — ease factor, starts 2.5, floored at 1.3.
- `interval` — current interval in days (derivable; store `next` date instead for portability).
- `next` — next review date `YYYY-MM-DD` (the load-bearing attr; a daily scanner just compares `next <= today`).
- `lapses` — count of "Again" resets (optional, for analytics).

### Rating input (UI → q)
Map the four buttons to SM-2 quality `q ∈ 0..5`:

| Button | q | Meaning |
|---|---|---|
| Again | 0 | total blackout / wrong |
| Hard | 3 | correct with serious difficulty |
| Good | 4 | correct after hesitation |
| Easy | 5 | perfect, instant |

(Hard can also use q=4 with a "factor of 0.8" interval modifier as Anki does; the q=3 mapping is the SM-2-pure choice and is simpler for MVP.)

### Update rules
Given old `rep`, `ef`, last `interval` (recompute from prior `next` − reviewed-date, or store `ivl`):

1. `q < 3` (Again): `rep ← 0`, `interval ← 1` (re-learn today/tomorrow), `lapses += 1`.
2. `q >= 3`:
   - `rep == 0`: `interval ← 1`
   - `rep == 1`: `interval ← 6`
   - `rep >= 2`: `interval ← round(interval_prev * ef)`  (prev interval × ease)
   - `rep += 1`
3. Ease update (only when q >= 3, i.e. not a lapse — pure SM-2 updates EF every review; Anki avoids easing on lapses; pick one and document it):
   `ef ← ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))`
   then `ef ← max(1.3, ef)`.
4. `next ← today + interval` days, formatted `YYYY-MM-DD`.
5. Write back `next`, `rep`, `ef`, `lapses` to the line (reuse `serializeDaily`-style in-place rewrite by `lineIndex`).

### Worked example
- Fresh atom: `rep:0 ef:2.5`. Rate **Good** (q=4): `rep→1`, `interval=1`, `next = today+1`. EF: `2.5 + (0.1 - 1*(0.08+0.02)) = 2.5 + 0 = 2.5`.
- Next review, rate **Good**: `rep=1 → interval=6`, `rep→2`, `next = today+6`. EF stays ~2.5.
- Next, rate **Good**: `rep=2 → interval = round(6 * 2.5)=15`, `next = today+15`. EF ~2.5.
- Rate **Hard** (q=3): EF `= 2.5 + (0.1 - 2*(0.08+0.04)) = 2.5 + (0.1 - 0.24) = 2.36`.
- Rate **Again** (q=0): `rep→0`, `interval=1`, `lapses+1`. EF unchanged on lapse (Anki-style) or updated (pure SM-2, EF would drop to ~2.2). **Recommendation: don't update EF on lapse** to avoid ease hell — matches Anki.

### MVP simplifications (safe, markdown-friendly)
- Store `next` (date) + `rep` + `ef` only; derive `interval` from history is unnecessary — recompute as `prevInterval` cached in an `ivl:` attr (1 extra attr) so the multiplier step has input. So attrs: `next rep ef ivl lapses`.
- No "learning steps" (Anki's 1m/10m same-day re-steps) — MVP treats Again as "due again tomorrow (`interval=1`)". Simple, sync-friendly, no time-of-day state.
- No fuzzing / hard-good interval modifiers / maximum-interval caps in v1; add later.
- Ratings reduce to 4 buttons; the q-mapping table above is the entire bridge to SM-2.

### Suggested line grammar (consistent with `schedule/markdown.ts` `ATTR_RE`)
```
- [ ] <atom summary> @{next:2026-07-02 rep:2 ef:2.36 ivl:6 lapses:0 topic:<slug> src:[[子文档]]}
```
On review, mark `[x]` for "reviewed today" then re-open with new `next`? No — better: keep `[ ]` = due, and a separate `last:` date tracks last review. Keep it minimal: `next` is the single due-flag; `next <= today` ⟹ due.

---

## 4. Concrete feature-embedding blueprint (PRD-actionable)

Ranked by value/cost for the Study workbench MVP (PR1–PR4 in `prd.md`):

1. **PR3 add-on — `## 复习` section + SM-2 scanner (HIGH value, MED cost).** Copy `schedule/markdown.ts` section-writeback into `apps/desktop/src/study/`. New `reviewAtom()` per §3. Workbench "复习"区 shows due atoms across all topics (interleaving for free). Reuses `lineIndex` rewrite — non-managed lines preserved. *Maps: Spaced Repetition, Active Recall (delivery), Interleaving, Desirable Difficulties.*
2. **PR4 add-on — AI action prompts (HIGH value, LOW cost).** Three prefilled-prompt actions via the `ContextMenu.tsx:139-140` pattern (`addFileToChat` + `showAiPanel`): "费曼挑战" / "生成自测题" / "SQ3R 预读". No new call path — all go through `claudeAdapter.send`. *Maps: Feynman, Active Recall, SQ3R.*
3. **PR3 add-on — `:::callout` blocks for gaps/questions (FREE).** Reuse `CalloutPlugin` variants: `type="warning" title="盲区"` (Feynman gaps), `type="info" title="预读问题"` (SQ3R), `type="tip" title="elaboration"` (elaboration). *Maps: Elaboration, Feynman, SQ3R.*
4. **PR2/PR3 — atomic sub-docs + `[[wiki]]` links (FREE).** Already supported by `wikiIngestService`/`graphDataBuilder`. Convention only: `学习/<主题>/<slug>.md` atomic notes linked from `## 笔记`. *Maps: Zettelkasten.*
5. **PR2 — Pomodoro in workbench header (FREE).** Import `Pomodoro.tsx` (or its store slice) into the Study workbench. Optional: log a completed round by bumping current unit `prog:`. *Maps: Pomodoro.*
6. **`## 笔记` bullet template (FREE, convention).** `- **概念**: … \| 因为: … \| 例子: … \| 类比: [[…]]`. AI "追问 elaboration" prompt enforces it. *Maps: Elaboration.*

### Minimal new attrs/sections summary
| Add | Where | Format | Reuses |
|---|---|---|---|
| `## 复习` section | topic doc | `- [ ] summary @{next:.. rep:.. ef:.. ivl:.. lapses:.. topic:.. src:[[..]]}` | section-writeback pattern, `ATTR_RE` |
| `cat:learn` + `study:<slug> unit:<n>` | daily note `## 任务` | (already in PRD Decision 5) | `schedule/markdown.ts` task line |
| 3 AI prompt actions | workbench UI | prefilled `adapter.send(prompt)` | `ContextMenu.tsx` open-panel pattern |
| callout blocks | `## 笔记` | `:::callout{type=.. title=..}` | `CalloutPlugin` |
| Pomodoro | workbench header | reuse component | `Pomodoro.tsx`, `scheduleStore` pomo slice |

---

## 5. Caveats / Not found

- **No live web citations**: `mcp__exa__*` tools were unavailable in this environment; the learning-science summaries are from established literature (Ebbinghaus 1885; Bjork & Bjork "desirable difficulties"; Wozniak SM-2 1987; Feynman-biography popularization) and the tool-UX descriptions are widely-known public behavior. If the PRD needs citable URLs, re-run with the `deep-research` skill or exa MCP once available.
- **SM-2 vs Anki's actual scheduler**: Anki uses a modified SM-2 (separate ease/hard-factor, learning/relearning steps, fuzz, max interval, "ease hell" mitigations). §3 is the pure SM-2 minimal core — sufficient for an MVP and intentionally simpler; documented where the MVP diverges (no lapse-ease-update, no same-day steps).
- **Active Recall "delivery"**: Active Recall is a principle, not a feature; in the blueprint it's realized *through* the `## 复习` queue + self-test AI prompt. It doesn't get its own row in code.
- **Desirable Difficulties**: cross-cutting rationale only — no code artifact; flag this in the PRD design notes so the team prefers effortful methods over "re-read materials" buttons.
- **Interleaving depends on multi-topic**: only meaningful once >1 study topic exists; cheap because the `## 复习` scanner naturally spans `学习/*.md`, but needs a `topic:<slug>` attr on each atom for display.
- **Zettelkasten graph view**: `graphDataBuilder` exists but I did not verify it renders in the Study workbench context — embedding may need a view-mode hook; confirm during PR3.

## Related Specs / Files
- `.trellis/tasks/06-29-learning-feature-materials-plan-knowledge-base/prd.md` — Study workbench PRD (Decisions 1–5, PR1–PR4 plan)
- `apps/desktop/src/schedule/markdown.ts` — section-writeback pattern to copy
- `apps/desktop/src/schedule/types.ts` — `TaskCategory` to extend with `learn`
- `packages/cli-adapter/src/claudeAdapter.ts` — single AI call path
- `apps/desktop/src/components/sidebar/ContextMenu.tsx:139-140` — open-AI-panel-with-context pattern
- `packages/container-plugins/src/plugins/CalloutPlugin.tsx` — callout variants to reuse
- `apps/desktop/src/components/schedule/Pomodoro.tsx` — reusable Pomodoro
- `apps/desktop/src/services/wikiIngestService.ts` (+ wikiQuery/Lint/graphDataBuilder) — existing Zettelkasten plumbing
