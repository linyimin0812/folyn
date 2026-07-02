# clips: fetch via curl.md service

## Goal

让 clips 抓取网页改用 **curl.md** 服务（`GET https://curl.md/<url>` → 返回优化 Markdown），替代当前"clips agent 用 WebFetch 直接抓原页"的做法。curl.md 服务端做 HTML→Markdown 提取，质量与控制都更好；也让 clips 的抓取路径与 cli-adapter 的 WebFetch 解耦，利于 `06-28-agent-sdk-adapter` 迁移。

## What I already know

- curl.md 是外部 URL→Markdown 服务：`GET https://curl.md/<url>` 返回页面正文的优化 Markdown（见归档 PRD `06-13-web-link-clipper`：原设计即 `fetch('https://curl.md/${url}')`）。
- `.claude/settings.local.json` 已放行 `WebFetch(domain:curl.md)`。
- 现状：`clipService.generateClip` 不抓网页，clips agent（`tools: WebFetch, WebSearch, Read`）用 WebFetch 抓原页 URL。
- 仓库**无 TS 层 HTTP**：无 `@tauri-apps/plugin-http`、无现存 `fetch()`、`csp:null`。联网全走 agent WebFetch。
- `tauri-plugin-shell = "2"` 可用（可执行 shell curl）。
- `generateInfographic` 读已存 clip 文件，不抓网页，不受影响。

## Assumptions (temporary)

- curl.md 服务公开可用，返回 Markdown 文本。
- 抓到的 Markdown 注入 clips agent prompt，agent 据此生成元数据 JSON。

## Open Questions

（已收敛——见 Decision）

## Requirements

- `clipService.generateClip` 把传给 clips agent 的 URL 从原页 URL 改为 `https://curl.md/<原 URL>`（clipService 构造，URL encode 原始 URL），prompt 明确指示 agent 用 WebFetch 抓取该 curl.md URL 获取页面 Markdown，再据此生成元数据 JSON。
- `features/clips/.claude/agents/clips.md` 工作流更新：第 1 步由"WebFetch 抓取目标 URL"改为"WebFetch 抓取 `https://curl.md/<url>` 获取 Markdown"。
- agent 的 `tools` 行保持 `WebFetch, WebSearch, Read`（WebFetch 域名 = curl.md，已放行）。
- 现有元数据 JSON 契约不变；`generateInfographic` 不受影响。

## Acceptance Criteria

- [ ] `generateClip` 传给 agent 的 prompt 含 `https://curl.md/<encode(url)>` 且指示 WebFetch 该 URL。
- [ ] clips agent（clips.md）工作流第 1 步更新为抓 curl.md。
- [ ] curl.md 抓取失败/返回空时，agent 仍返回最小合法 JSON（已有降级机制，保持）。
- [ ] 单测覆盖 clipService 构造的 curl.md URL 与 prompt 内容。
- [ ] tsc + vitest 绿。

## Definition of Done

- tsc / vitest 绿；新增/扩展单测。
- clips agent 契约文档（clips.md）更新。

## Technical Approach

- `generateClip` 内构造 `const mdUrl = 'https://curl.md/' + encodeURIComponent(url)`，prompt 注入该 URL 并指示 agent WebFetch 它拿 Markdown 正文。
- clips.md agent 工作流第 1 步改为 WebFetch curl.md URL；其余（提炼→JSON 输出）不变。
- 不新增依赖、不动 Tauri 配置、不动 adapter。

## Decision (ADR-lite)

- **Context**：curl.md 是网页→Markdown 服务；clips 现依赖 agent WebFetch 抓原页，质量与控制弱。
- **Decision**：选最小改动方案——agent 用 WebFetch 调 `https://curl.md/<url>` 拿 Markdown，clipService 只改 prompt 与 URL 构造。不在 TS 层加 HTTP 能力。
- **Consequences**：实现极简、零新依赖；但仍依赖 cli-adapter 提供 WebFetch（`06-28-agent-sdk-adapter` 迁移时需确认 Agent SDK 路径仍提供 WebFetch 或再调整）。curl.md 服务可用性影响 clips 抓取。

## Out of Scope (explicit)

- 不在 TS 层加 HTTP 能力（不加 @tauri-apps/plugin-http / shell curl）。
- 不改 agent 的 tools 行。
- 不动 generateInfographic。
- 不做 curl.md 失败时的原页 WebFetch 回退（agent 已有最小 JSON 降级）。

## Technical Notes

- 受影响文件：`services/clipService.ts`、`features/clips/.claude/agents/clips.md`，可能新增 fetch helper。
- curl.md API：`GET https://curl.md/<url>`（URL 需 encode）。
- 原 PRD 参考：`.trellis/tasks/archive/2026-06/06-13-web-link-clipper/prd.md`。
