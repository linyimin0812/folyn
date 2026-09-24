/**
 * Activity collector host runtime (design §2.1/§4.3).
 *
 * Poll scheduling per collector: effective interval = user override or the
 * declared default, floored at 60s; per-collector poll toggle; global
 * kill-switch; manual「立即采集」shares the exact same collect→push→cursor
 * path so the cursor never double-advances. Runs while the app is open,
 * focused or not — the scheduler lives in the main window's JS realm (same
 * lifecycle as the pet, no extra process).
 *
 * Privacy (design §4.3 step 2, host-side by design — see activity/ingest.rs
 * header): `applyPrivacy` strips `raw` unless keepRaw and applies the user's
 * redact regexes to title/summary before every push.
 *
 * Part B wiring (webhook server + sample collectors): the Rust
 * `activity_webhook.rs` server emits `activity://webhook` → the listener
 * registered in `ensureCollectorRuntimeStarted` routes it to
 * `dispatchWebhook(collectorId, payload)`.
 */

import type { CollectorEvent } from '@folyn/extension-host';
import { useCollectorRegistryStore } from './registry';
import { getCollectorSettings, useActivityCollectorStore, type CollectRunRecord } from '@/store/activityCollectorStore';

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** Poll interval floor (design §2.1): no collector can poll faster than 60s. */
export const MIN_POLL_INTERVAL_MS = 60_000;

/** Effective interval: user override wins over the declared default, floored
 *  at 60s either way. Missing both → the floor itself. */
export function effectiveIntervalMs(
  declaredMs: number | undefined,
  overrideMs: number | undefined,
): number {
  const chosen = overrideMs ?? declaredMs ?? MIN_POLL_INTERVAL_MS;
  return Math.max(MIN_POLL_INTERVAL_MS, Math.ceil(chosen));
}

export interface ActivityPrivacyOptions {
  /** Keep the events' `raw` payload (design §8 switch, default false). */
  keepRaw: boolean;
  /** User redact regexes applied to title/summary (design §4.3 step 2).
   *  Invalid patterns are skipped, not fatal. */
  redactPatterns: string[];
}

/** Compile the redact patterns once; invalid ones are dropped. */
function compileRedactions(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p, 'g'));
    } catch {
      console.warn('[activity] invalid redact pattern skipped:', p);
    }
  }
  return out;
}

/** Host-side privacy transform (design §4.3 step 2). Pure: returns new events. */
export function applyPrivacy<T extends { title?: string; summary?: string; raw?: unknown }>(
  events: T[],
  opts: ActivityPrivacyOptions,
): T[] {
  const regexes = compileRedactions(opts.redactPatterns);
  const redact = (s: string | undefined): string | undefined =>
    regexes.length === 0 || s === undefined
      ? s
      : regexes.reduce((acc, re) => acc.replace(re, '***'), s);
  return events.map((e) => {
    const next: T = { ...e };
    const writable = next as { title?: string; summary?: string; raw?: unknown };
    writable.title = redact(writable.title);
    writable.summary = redact(writable.summary);
    if (!opts.keepRaw) writable.raw = undefined;
    return next;
  });
}

// ── Push path (shared by poll, manual collect, webhook) ─────────────────────

/** Mirrors the Rust `PushOutcome` (activity/ingest.rs). */
export interface ActivityPushOutcome {
  accepted: number;
  deduped: number;
  rejected: { id: string; reason: string }[];
}

/** Serialize a CollectorEvent into the Rust `ActivityEventIn` shape, stamping
 *  `source` (the Rust ingest validates it equals the collector id). */
function toEventIn(collectorId: string, e: CollectorEvent) {
  return { ...e, source: collectorId };
}

/** Resolve the current vault root for the activity db (empty string when no
 *  vault is open — callers skip the run). Lazy imports keep the pure helpers
 *  above testable without dragging vaultStore's module graph in. Exported for
 *  the activity query API (`services/activity/api.ts`), which resolves the
 *  same root for every read command. */
export async function currentVaultRoot(): Promise<string> {
  const { useVaultStore } = await import('@/store/vaultStore');
  const basePath = useVaultStore.getState().currentVault?.basePath;
  if (!basePath) return '';
  const { resolveBasePath } = await import('@/utils/pathResolver');
  return resolveBasePath(basePath);
}

/**
 * Privacy-transform + push a batch for one collector. Returns null when the
 * collector is unknown/disabled or no vault is open; otherwise the Rust
 * push outcome. This is the single ingest entry every collector path uses.
 */
export async function pushCollectorEvents(
  collectorId: string,
  events: CollectorEvent[],
): Promise<ActivityPushOutcome | null> {
  const reg = useCollectorRegistryStore
    .getState()
    .collectors.find((c) => c.collectorId === collectorId);
  if (!reg) return null;
  if (!getCollectorSettings(useActivityCollectorStore.getState(), collectorId).enabled) {
    return null;
  }
  const vaultRoot = await currentVaultRoot();
  if (!vaultRoot) return null;

  const { keepRaw, redactPatterns } = useActivityCollectorStore.getState();
  const transformed = applyPrivacy(events, { keepRaw, redactPatterns }).map((e) =>
    toEventIn(collectorId, e),
  );
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ActivityPushOutcome>('activity_push_events', {
    vaultRoot,
    collectorId,
    declaredTypes: reg.activityTypes,
    events: transformed,
  });
}

// ── Poll / manual collect ───────────────────────────────────────────────────

/**
 * One collect cycle: cursor → `collect({cursor, config})` → push → advance
 * cursor. The cursor only advances after a successful push, so a failed cycle
 * re-reads the same window next time (no gaps). Shared by the scheduler and
 * manual「立即采集」.
 */
export async function runCollect(collectorId: string): Promise<ActivityPushOutcome | null> {
  const reg = useCollectorRegistryStore
    .getState()
    .collectors.find((c) => c.collectorId === collectorId);
  if (!reg) return null;
  if (!reg.impl?.collect) {
    console.warn(`[activity] collector "${collectorId}" has no collect() implementation — skipped`);
    return null;
  }
  if (!getCollectorSettings(useActivityCollectorStore.getState(), collectorId).enabled) {
    return null;
  }
  const vaultRoot = await currentVaultRoot();
  if (!vaultRoot) return null;

  const { invoke } = await import('@tauri-apps/api/core');
  const cursor = await invoke<string | null>('activity_get_cursor', { vaultRoot, collectorId });
  const config = useActivityCollectorStore.getState().configs[collectorId] ?? {};
  const store = useActivityCollectorStore;
  // Per-run history record (采集记录 view): logs accumulate alongside the
  // transient progress; the record is appended in the finally on both paths.
  const startedAt = Date.now();
  const logs: string[] = [];
  let pushed: ActivityPushOutcome | null = null;
  try {
    const { events, nextCursor } = await reg.impl.collect({
      cursor,
      config,
      exec: collectorExec,
      http: collectorHttp(reg.hostAllowlist),
      // Frontmost-window sampler (Rust `activity_front_window` — fixed
      // scripts, no collector-controlled args; see activity/mod.rs).
      frontWindow: async () => {
        return invoke<{ app: string; title: string | null } | null>('activity_front_window');
      },
      // Vault scanner (Rust `activity_scan_vault` — fixed recursive walk, .git
      // always skipped; excludes are dir names / vault-relative paths only,
      // see activity/mod.rs). Exclusion patterns come from the collector's
      // OWN config snapshot (`excludePatterns`, seeded once from appearance,
      // then independent) — host-applied, invisible to the collector.
      scanVault: async (opts: { excludeDirs?: string[] }) => {
        const cfg = useActivityCollectorStore.getState().configs[collectorId] ?? {};
        const excludePatterns = String(cfg.excludePatterns ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('#'));
        return invoke<Array<{ path: string; mtimeMs: number; size: number }>>(
          'activity_scan_vault',
          { vaultRoot, excludeDirs: opts?.excludeDirs ?? [], excludePatterns },
        );
      },
      // Vault text-file reader (Rust `activity_read_text_file` — traversal /
      // absolute rejected, binary + >1MB skipped, truncated to maxBytes;
      // see activity/mod.rs). Same trust model as scanVault: fixed command,
      // vault-relative paths only, invisible to manifest permissions.
      readVaultFile: async (path: string, maxBytes?: number) => {
        return invoke<string | null>('activity_read_text_file', {
          vaultRoot,
          path,
          maxBytes: maxBytes ?? null,
        });
      },
      // Transient progress → store (runtime-only, never persisted). Cleared
      // in the finally below on both success and failure paths.
      onProgress: (message) => {
        // ponytail: 50-log cap per run — enough to debug, bounded storage
        if (logs.length < 50) logs.push(message);
        store.getState().setCollectProgress(collectorId, message);
      },
    });
    const outcome = await pushCollectorEvents(collectorId, events);
    if (!outcome) return null;
    pushed = outcome;
    await invoke('activity_set_cursor', { vaultRoot, collectorId, cursor: nextCursor });
    useActivityCollectorStore.getState().setLastSync(collectorId, Date.now(), outcome.accepted);
    return outcome;
  } catch (err) {
    console.warn(`[activity] collector "${collectorId}" collect failed:`, err);
    return null;
  } finally {
    store.getState().setCollectProgress(collectorId, null);
    // null outcome = skipped OR failed — recorded as 无结果. Fire-and-forget:
    // the record goes to the activity db (Rust caps), then the store's
    // transient list refreshes from the db so CollectLogView stays reactive.
    const record: CollectRunRecord = {
      collectorId,
      collectorName: reg.extensionName ?? collectorId,
      startedAt,
      finishedAt: Date.now(),
      accepted: pushed?.accepted ?? 0,
      deduped: pushed?.deduped ?? 0,
      outcome: pushed ? 'ok' : 'no-result',
      logs,
    };
    void (async () => {
      try {
        // Lazy import: api.ts imports this module (currentVaultRoot).
        const { insertActivityCollectRun, listActivityCollectRuns } = await import('./api');
        await insertActivityCollectRun(record);
        useActivityCollectorStore.getState().setCollectHistory(await listActivityCollectRuns());
      } catch (err) {
        console.error('[activity] collect run history write failed:', err);
      }
    })();
  }
}

/** Manual trigger (「立即采集」) — same path as a poll tick. */
export function collectNow(collectorId: string): Promise<ActivityPushOutcome | null> {
  return runCollect(collectorId);
}

// ── Webhook hook point (part B wires the local server here) ─────────────────

/**
 * Host-provided exec injected into `CollectorContext` (design §2.2). Backed by
 * the Rust `activity_exec` command, which allowlists the program — see the
 * `EXEC_ALLOWED_PROGRAMS` note in `activity/mod.rs`.
 */
async function collectorExec(
  program: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('activity_exec', { program, args, cwd });
}

/**
 * Host-provided HTTP fetch injected into `CollectorContext`. Enforces the
 * collector's manifest `hostAllowlist` (exact origin match) before the request
 * leaves — the runtime counterpart of the install-time permission confirm.
 * Exported for tests (origin denial / parse failure).
 */
export function collectorHttp(hostAllowlist: string[]) {
  return async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ): Promise<{ status: number; body: string }> => {
    const origin = new URL(url).origin;
    if (!hostAllowlist.includes(origin)) {
      throw new Error(`collector http denied: ${origin} not in hostAllowlist`);
    }
    const res = await fetch(url, init);
    return { status: res.status, body: await res.text() };
  };
}

/**
 * Register the `activity://webhook` listener (emitted by the Rust tiny_http
 * server, `activity_webhook.rs`). Each inbound payload routes to the
 * collector's `onWebhook` via `dispatchWebhook`; unknown/disabled collectors
 * log + drop. No-op outside Tauri (tests / web build).
 */
async function startWebhookListener(): Promise<void> {
  const { isTauri } = await import('@/utils/platform');
  if (!isTauri()) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<{ collectorId: string; payload: unknown }>('activity://webhook', (e) => {
    const { collectorId, payload } = e.payload ?? {};
    if (!collectorId) return;
    void dispatchWebhook(collectorId, payload).then((outcome) => {
      if (!outcome) {
        console.warn(
          `[activity] webhook for "${collectorId}" dropped (unknown/disabled collector or no vault open)`,
        );
      }
    });
  });
}

/**
 * Route one inbound webhook payload to the collector's `onWebhook` and push
 * the produced events. Returns null when the collector has no webhook impl /
 * is disabled / no vault; otherwise the push outcome. The part-B tiny_http
 * server resolves the route → collectorId and calls exactly this.
 */
export async function dispatchWebhook(
  collectorId: string,
  payload: unknown,
): Promise<ActivityPushOutcome | null> {
  const reg = useCollectorRegistryStore
    .getState()
    .collectors.find((c) => c.collectorId === collectorId);
  if (!reg?.impl?.onWebhook) return null;
  const config = useActivityCollectorStore.getState().configs[collectorId] ?? {};
  try {
    const events = await reg.impl.onWebhook(payload, config);
    return pushCollectorEvents(collectorId, events);
  } catch (err) {
    console.warn(`[activity] collector "${collectorId}" onWebhook failed:`, err);
    return null;
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
let runtimeStarted = false;

/** Is this collector currently wanted on the poll schedule? */
function isScheduled(collectorId: string): boolean {
  const { collectors } = useActivityCollectorStore.getState();
  const reg = useCollectorRegistryStore.getState().collectors.find((c) => c.collectorId === collectorId);
  if (!reg || reg.mode !== 'poll' || !reg.impl?.collect) return false;
  return getCollectorSettings({ collectors }, collectorId).pollOn;
}

function scheduleNext(collectorId: string, delayMs: number): void {
  const t = setTimeout(() => {
    timers.delete(collectorId);
    if (!isScheduled(collectorId)) return;
    inFlight.add(collectorId);
    void runCollect(collectorId).finally(() => {
      inFlight.delete(collectorId);
      // Re-arm from the completion time so a slow collect never stacks runs.
      if (isScheduled(collectorId)) {
        scheduleNext(collectorId, intervalFor(collectorId));
      }
    });
  }, delayMs);
  timers.set(collectorId, t);
}

function intervalFor(collectorId: string): number {
  const reg = useCollectorRegistryStore
    .getState()
    .collectors.find((c) => c.collectorId === collectorId);
  const { collectors } = useActivityCollectorStore.getState();
  return effectiveIntervalMs(
    reg?.pollIntervalMs,
    getCollectorSettings({ collectors }, collectorId).intervalOverrideMs,
  );
}

/** Rebuild the timer set from current registry + settings. Idempotent; a
 *  collector already scheduled (or mid-run) keeps its timer. */
export function rescheduleAll(): void {
  const wanted = useCollectorRegistryStore
    .getState()
    .collectors.filter((c) => isScheduled(c.collectorId))
    .map((c) => c.collectorId);
  for (const id of [...timers.keys()]) {
    if (!wanted.includes(id)) {
      clearTimeout(timers.get(id)!);
      timers.delete(id);
    }
  }
  for (const id of wanted) {
    if (!timers.has(id) && !inFlight.has(id)) scheduleNext(id, intervalFor(id));
  }
}

/**
 * Start the runtime once (registry/settings subscriptions + initial schedule).
 * Called lazily by the collector adapter on the first collector registration —
 * the scheduler then tracks activate/deactivate and settings changes by itself.
 */
export function ensureCollectorRuntimeStarted(): void {
  if (runtimeStarted) return;
  runtimeStarted = true;
  useCollectorRegistryStore.subscribe(() => rescheduleAll());
  useActivityCollectorStore.subscribe(() => rescheduleAll());
  void startWebhookListener();
  rescheduleAll();
}
