# Pet breathing animation — remove surrounding white glow

## Goal

桌宠图标的「呼吸灯」目前是 `pet-breathe` keyframes 用 `filter: drop-shadow(...)` 在图标周围画一圈白光 halo。用户不要这圈白光，只要图标本身的呼吸灯动效。

## What I already know

- `apps/desktop/src/components/pet/pet.css:114-117` — `pet-breathe` keyframes，用 `filter: drop-shadow(0 0 10/20px rgba(255,255,255,.4/1.0))` 画白光 halo。
- 该 keyframe 通过逗号分隔的 `animation` 列表挂在 4 个状态上：`is-idle` / `is-hover` / `is-drag` / `is-click`（pet.css:126-160）。注释明确：breathe owns `filter`，state keyframes own `transform`，互不冲突。
- 状态 keyframes（`pet-idle` / `pet-hover` / `pet-drag` / `pet-click`）全部用 `transform`（translateY / rotate / scale），所以**不能**直接把 breathe 改成 `transform: scale(...)`，会和 state keyframes 抢同一 property（CSS 多 animation 同名 property 后者覆盖前者）。
- `.pet-mascot` 是 `<svg>` 本体（PetMascot.tsx:30-38），已有 `transform-origin: center`（pet.css:82）。

## Decision (ADR-lite)

**Context**: 用户要保留「图标呼吸灯动效」但去掉白光。把 breathe 从 `filter` 改成 `transform: scale(...)` 会和状态 keyframes 冲突（多 animation 抢 `transform`）。

**Decision**: 把 `pet-breathe` keyframes 改成用独立的 CSS `scale` property（`scale: 1 ↔ 1.04`），而不是 `transform: scale(...)`。CSS `scale` / `translate` / `rotate` 三个独立 property 与 `transform` 独立合成，互不覆盖——breathe 拥有 `scale`，state keyframes 拥有 `transform`，与原架构「breathe owns 一个非 transform 属性」的拆分一致，只是把 `filter` 换成 `scale`。

**Consequences**:
- 优点：零结构改动（不引入 wrapper div、不改 PetMascot.tsx），只改 pet.css 一个文件。`scale` 与 `transform` 合成 → 在 hover/drag/click 状态下，scale 呼吸会和 state 的 transform scale 相乘（如 drag 1.02 × breathe 1.04 ≈ 1.06），可接受。
- 缺点：依赖 CSS `scale` property（Safari 14.1+ / Chrome 104+）。Tauri WKWebView / WebView2 都满足。
- 风险：去掉 halo 后 88px mascot 在 120px 窗口里有 16px margin，scale 1.04 → ~91.5px，不会裁剪。

## Requirements

- R1: 移除 `pet-breathe` 中的 `filter: drop-shadow(...)` 白光 halo。
- R2: `pet-breathe` 改为 `scale: 1 ↔ 1.04` 的图标本身呼吸（2.4s ease-in-out infinite，与原节奏一致）。
- R3: 保留 4 个状态的现有 `animation` 列表（is-idle / is-hover / is-drag / is-click 仍引用 `pet-breathe`），呼吸在状态切换期间不停。
- R4: state keyframes（pet-idle / pet-hover / pet-drag / pet-click）不变。
- R5: 清理 pet.css 与 PetMascot.tsx 中关于 drop-shadow halo / 16px headroom for halo 的过时注释。

## Acceptance Criteria

- [ ] 桌宠在 idle 状态下，图标本身有 2.4s 周期的轻微缩放呼吸（1.0 ↔ 1.04），周围无白光 halo。
- [ ] hover / drag / click 状态下呼吸仍持续，状态动效（translateY / rotate / squish）不丢失。
- [ ] macOS + Windows 桌宠窗口在透明背景下，图标边缘无 drop-shadow 残影。
- [ ] pet.css 中 `drop-shadow` / 白光 halo 相关注释全部更新或删除，无过期描述。
- [ ] `pnpm lint` 与 `pnpm typecheck`（apps/desktop）通过。

## Definition of Done

- pet.css 单文件改动（可能加 PetMascot.tsx 注释清理）。
- 手动在桌宠窗口验证 idle / hover / drag / click 4 状态下的呼吸与白光去除。
- lint / typecheck 绿。

## Out of Scope

- 不调整呼吸节奏（2.4s 不变）。
- 不改 hover/drag/click 状态动效本身。
- 不改 PetApp.tsx 的 click-through / setIgnoreCursorEvents 逻辑。
- 不动 PetMascot.tsx 的 SVG 结构（不加 wrapper `<g>`）。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/pet/pet.css`（核心改动）
  - `apps/desktop/src/components/pet/PetMascot.tsx`（仅注释清理，第 16-18 行提到 halo headroom）
  - `apps/desktop/src/components/pet/PetApp.tsx:549-556`（注释提到 breathing drop-shadow halo，需顺手清理）
- CSS `scale` property 参考：https://developer.mozilla.org/en-US/docs/Web/CSS/scale
- 不需要研究文件——单一 CSS 文件、纯样式调整。
