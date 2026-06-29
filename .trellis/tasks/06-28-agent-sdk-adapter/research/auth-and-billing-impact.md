# Research: Auth & Billing Impact — `claude` CLI vs Claude Agent SDK

- **Query**: Does the Claude Agent SDK reuse the Claude Code subscription OAuth (Pro/Max), or does it require a pay-per-token Anthropic API key? What's the billing implication for a user currently on a Max subscription?
- **Scope**: external (Anthropic docs via claude-api skill)
- **Date**: 2026-06-28

## TL;DR

**The migration can be transparent to the user's billing.** The `claude` CLI authenticates via the user's Claude subscription (Pro/Max) OAuth login, and the **Claude Agent SDK honors the same credential profile resolution** — an explicit statement in the claude-api skill's `anthropic-cli.md` doc. So a Max subscriber logged into the `claude` CLI can use the Agent SDK with **no API key and no billing change**: requests bill against the subscription just like the CLI. The SDK *also* supports an Anthropic API key (pay-per-token) and Bedrock/Vertex, but those are opt-in via env vars — **not the default** when a subscription profile is present. The one foot-gun: a stale exported `ANTHROPIC_API_KEY` (even set to `""`) silently overrides the subscription profile and would flip the user to pay-per-token.

## Findings

### `claude` CLI (Claude Code) auth — subscription OAuth

The `claude` CLI authenticates via the user's Claude Pro/Max subscription through an interactive OAuth login (`claude /login`, or `ant auth login`). The login opens a browser, exchanges for a short-lived token, and stores an **OAuth profile on disk**:

- Linux/macOS: `~/.config/anthropic/credentials/<profile>.json` (default profile name `default`)
- Windows: `%APPDATA%\Anthropic\credentials\<profile>.json`

Subsequent CLI calls pick up the profile automatically — no API key in the environment. Subscription usage counts against the plan's usage limits (Pro/Max weekly limits), **not** pay-per-token API billing. This is the auth model the repo's `ClaudeAdapter` runs under today: it spawns `claude -p ...` with no `ANTHROPIC_API_KEY`, so the CLI uses the on-disk subscription profile.

### Claude Agent SDK auth — same chain, same subscription

The claude-api skill's `shared/anthropic-cli.md` doc states explicitly: **"Claude Code and the Claude Agent SDK honor the same profile resolution."** The SDK resolves credentials in this precedence (first match wins):

1. Explicit API key passed to the SDK / `ANTHROPIC_API_KEY` env var → **Anthropic API key, pay-per-token** (Claude Developer Platform / `api.anthropic.com`).
2. `ANTHROPIC_AUTH_TOKEN` env var → an OAuth bearer token (e.g. from `ant auth print-credentials --access-token`).
3. `ANTHROPIC_PROFILE`-selected (or active) **OAuth profile on disk** → the same subscription credential (Pro/Max) the CLI uses.
4. Workload Identity Federation env vars (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`).
5. The default profile on disk.

**Implication:** when the SDK runs on a machine where the user has done `claude /login` (and `ANTHROPIC_API_KEY` is unset), the SDK **uses the subscription profile** — the same credential, the same billing, as the CLI. There is no forced switch to pay-per-token.

### Does the SDK support reusing the CLI's stored credentials?

**Yes — automatically.** The SDK reads the same `~/.config/anthropic/credentials/<profile>.json` files the CLI writes. There is no flag or env var required to "enable subscription auth"; subscription auth is simply what happens when no API key is set and a profile exists. The only configuration knobs are:

- `ANTHROPIC_PROFILE=<name>` to pick a non-default profile.
- `ant auth login` / `claude /login` to (re)create the profile.
- `ant auth status` to inspect which credential source won (it reports status only — do not script against its exit code).

For raw-HTTP/SDK callers who want to hand the subscription token to a subprocess, `ant auth print-credentials --access-token` prints the bare bearer; with `--env` it emits `ANTHROPIC_AUTH_TOKEN=...` for `eval`-ing into the environment. Note OAuth tokens go on `Authorization: Bearer` **plus** the `anthropic-beta: oauth-2025-04-20` header for raw HTTP; the SDK handles this internally.

### Billing implication for a Max subscriber

| Scenario | What bills the request | User-visible change |
|---|---|---|
| CLI today (current repo) | Max subscription usage limits | — (status quo) |
| Agent SDK, no `ANTHROPIC_API_KEY` set, profile present | **Max subscription usage limits** (same as CLI) | **None — transparent.** The SDK is the same engine (`claudeCodeVersion: 2.1.195`) using the same credential. |
| Agent SDK with `ANTHROPIC_API_KEY` set | Pay-per-token API billing (Claude Developer Platform) at `$5/$25` per 1M input/output (Opus 4.8) or `$3/$15` (Sonnet 4.6) | **Yes — changes billing.** Token usage stops counting against the Max plan and starts metering on the API key's org. A Max user would be paying per token they could have used under their subscription. |
| Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`) | AWS Bedrock billing | Yes — different platform, AWS bill. |
| Vertex (`CLAUDE_CODE_USE_VERTEX=1`) | GCP Vertex billing | Yes — different platform, GCP bill. |

**Critical caveat — the silent override.** The claude-api skill flags this as "the #1 auth trap": a stale exported `ANTHROPIC_API_KEY` **silently overrides every profile**, including an empty `ANTHROPIC_API_KEY=""` (which still wins its precedence slot and authenticates with an empty key). If the user (or the app's launched environment) has `ANTHROPIC_API_KEY` set, the SDK will use it instead of the subscription — flipping billing to pay-per-token. Before relying on subscription auth, the SDK driver process must ensure `ANTHROPIC_API_KEY` is **truly unset** (not blanked). `ant auth status` shows which source won.

### What this means for the migration

- **The migration is billing-transparent** as long as the SDK driver process inherits an environment with **no `ANTHROPIC_API_KEY`** and the user has completed `claude /login`. No API key needs to be provisioned; the Max subscription covers it.
- **Action item for the adapter:** when spawning the Node SDK driver, the adapter must **not** inject an `ANTHROPIC_API_KEY` env var, and should consider scrubbing one if present in the Tauri app's environment (or at minimum warn the user via `ant auth status`-style check). This preserves the "subscription just works" UX the CLI currently gives.
- **If the user has no subscription** (only an API key), the SDK works fine on pay-per-token — same as if they pointed the CLI at an API key. Billing is then identical to calling the Messages API directly.
- **The Managed Agents surface** (separate from the Agent SDK; `client.beta.sessions.*`) is **always** pay-per-token API billing with an API key — it does not use the subscription profile. If the project ever considers Managed Agents, that *would* change billing. (Out of scope for the current SDK-adapter task.)

## Related Specs / Repo Files

- `packages/cli-adapter/src/claudeAdapter.ts` — spawns `claude -p` with no API key; rides on the subscription profile. A SDK adapter must preserve this property (do not set `ANTHROPIC_API_KEY`).
- `apps/desktop/src-tauri/capabilities/default.json` — shell spawn capability; the spawned process inherits the Tauri app's environment, so any `ANTHROPIC_API_KEY` in the app env would leak into the SDK driver.

## External References

- claude-api skill → `shared/anthropic-cli.md` — the authoritative statement that "Claude Code and the Claude Agent SDK honor the same profile resolution"; the #1 auth trap about `ANTHROPIC_API_KEY` override; profile storage paths; `ant auth print-credentials`.
- claude-api skill → SKILL.md §Workload Identity Federation — credential precedence chain.
- claude-api skill → `shared/claude-platform-on-aws.md` / `shared/live-sources.md` — Bedrock/Vertex client setup (not the default path for the Agent SDK).
- Current Opus 4.8 pay-per-token pricing (`$5/$25` per 1M) and Sonnet 4.6 (`$3/$15`) from the claude-api skill model table — the rate the user would pay if `ANTHROPIC_API_KEY` is set.

## Caveats / Not Found

- The exact OAuth profile JSON schema on disk (`access_token`, `refresh_token`, `expires_at`, `scopes`) was not read from a file; described from the claude-api skill's `mcp_oauth` vault shape and the `ant` CLI behavior. The SDK auto-refreshes tokens internally; callers do not need to manage refresh.
- Whether the SDK's subscription path requires the `anthropic-beta: oauth-2025-04-20` header for its own API calls (as raw HTTP does) is handled internally by the SDK — not something the adapter needs to set. Confirmed only for raw-HTTP callers in the skill docs.
- Rate-limit/usage-limit semantics under a Max plan when driving the SDK programmatically (vs. interactively) may differ from CLI usage — Anthropic's subscription terms for programmatic/automated use via the Agent SDK were not located in the available docs. If the app drives heavy automated traffic, the user should confirm their plan permits it; some subscription tiers restrict non-interactive usage.
