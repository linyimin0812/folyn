import { describe, it, expect, vi } from 'vitest';
import { ExtensionHost } from './ExtensionHost';
import { ExtensionRuntime, consoleLogger } from './ExtensionRuntime';
import { OwnedRegistry, combineSignals, FOLYN_CORE_OWNER } from 'folyn-extension-sdk';
import type {
  Disposable,
  Extension,
  ExtensionApi,
  ExtensionContext,
  ExtensionManifest,
  ExtensionTier,
} from 'folyn-extension-sdk';

// ── fixtures ────────────────────────────────────────────────────────────────

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'demo-extension',
    name: 'Demo',
    version: '0.1.0',
    tier: 'trusted',
    main: 'index.js',
    ...overrides,
  };
}

/** A fake loader returning `ext` for tier `tier` (extensions carry no manifest). */
function fakeLoader(ext: Extension, tier: ExtensionTier = 'trusted') {
  return { tier, load: async () => ext };
}

/** A minimal ExtensionApi stub passed to activate(). */
const noopApi = {} as ExtensionApi;

function makeRuntime(extension: Extension): ExtensionRuntime {
  const baseCtx: Omit<ExtensionContext, 'signal' | 'addDisposable'> = {
    extensionId: 'demo-extension',
    extensionPath: 'index.js',
    vault: { name: 'default', path: 'default' },
    ui: { dialogs: { async info() {}, async confirm() { return false; } }, notifications: { show() {} } },
    logger: consoleLogger,
  };
  return new ExtensionRuntime({ extension, api: noopApi, context: baseCtx });
}

// ── manifest validation ──────────────────────────────────────────────────────

describe('ExtensionHost / manifest validation', () => {
  it('rejects non-kebab id', async () => {
    const host = new ExtensionHost();
    await expect(host.install(manifest({ id: 'BadId' }))).rejects.toThrow(/kebab/);
  });

  it('rejects sandbox extension without html', async () => {
    const host = new ExtensionHost();
    await expect(host.install(manifest({ tier: 'sandbox' }))).rejects.toThrow(/html/);
  });

  it('rejects unknown tier', async () => {
    const host = new ExtensionHost();
    await expect(host.install(manifest({ tier: 'wat' as never }))).rejects.toThrow(/tier/);
  });
});

describe('ExtensionHost / permissions.ai validation', () => {
  it('accepts chat boolean + agents string[]', async () => {
    const host = new ExtensionHost();
    await expect(
      host.install(manifest({ permissions: { ai: { chat: true, agents: ['wiki', 'clips'] } } })),
    ).resolves.toBe('demo-extension');
  });

  it('rejects non-boolean chat', async () => {
    const host = new ExtensionHost();
    await expect(
      host.install(manifest({ permissions: { ai: { chat: 'yes' as unknown as boolean } } })),
    ).rejects.toThrow(/chat must be a boolean/);
  });

  it('rejects non-array agents', async () => {
    const host = new ExtensionHost();
    await expect(
      host.install(manifest({ permissions: { ai: { agents: 'wiki' as unknown as string[] } } })),
    ).rejects.toThrow(/agents must be a string\[\]/);
  });

  it('rejects empty-string feature names', async () => {
    const host = new ExtensionHost();
    await expect(
      host.install(manifest({ permissions: { ai: { agents: ['wiki', ''] } } })),
    ).rejects.toThrow(/agents must be a string\[\]/);
  });
});

// ── lifecycle ─────────────────────────────────────────────────────────────────

describe('ExtensionHost / lifecycle', () => {
  it('install → validated; activate → active; deactivate → validated; uninstall removes', async () => {
    const host = new ExtensionHost();
    const activate = vi.fn();
    const deactivate = vi.fn();
    const extension: Extension = { activate, deactivate };
    host.registerLoader(fakeLoader(extension));

    await host.install(manifest());
    expect(host.get('demo-extension')?.state).toBe('validated');

    await host.activate('demo-extension');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(host.get('demo-extension')?.state).toBe('active');

    await host.deactivate('demo-extension');
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(host.get('demo-extension')?.state).toBe('validated');

    await host.uninstall('demo-extension');
    expect(host.get('demo-extension')).toBeUndefined();
  });

  it('activate is idempotent', async () => {
    const host = new ExtensionHost();
    const activate = vi.fn();
    const extension: Extension = { activate };
    host.registerLoader(fakeLoader(extension));
    await host.install(manifest());
    await host.activate('demo-extension');
    await host.activate('demo-extension');
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('deactivate is a no-op when not active', async () => {
    const host = new ExtensionHost();
    const deactivate = vi.fn();
    const extension: Extension = { deactivate };
    host.registerLoader(fakeLoader(extension));
    await host.install(manifest());
    await host.deactivate('demo-extension');
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('reaps disposables on deactivate (LIFO)', async () => {
    const host = new ExtensionHost();
    const disposed: string[] = [];
    const extension: Extension = {
      activate: (_api, ctx) => {
        ctx.addDisposable({ dispose: () => { disposed.push('a'); } });
        ctx.addDisposable({ dispose: () => { disposed.push('b'); } });
      },
    };
    host.registerLoader(fakeLoader(extension));
    await host.install(manifest());
    await host.activate('demo-extension');
    await host.deactivate('demo-extension');
    // LIFO: last-registered disposed first.
    expect(disposed).toEqual(['b', 'a']);
  });

  it('activate throws when no loader for tier', async () => {
    const host = new ExtensionHost();
    await host.install(manifest());
    await expect(host.activate('demo-extension')).rejects.toThrow(/loader/);
    expect(host.get('demo-extension')?.state).toBe('failed');
  });

  it('install duplicate id throws', async () => {
    const host = new ExtensionHost();
    await host.install(manifest());
    await expect(host.install(manifest())).rejects.toThrow(/already installed/);
  });

  it('deactivate still reaps disposables when extension.deactivate throws', async () => {
    const host = new ExtensionHost();
    const disposed: string[] = [];
    const extension: Extension = {
      activate: (_api, ctx) => { ctx.addDisposable({ dispose: () => { disposed.push('x'); } }); },
      deactivate: () => { throw new Error('boom'); },
    };
    host.registerLoader(fakeLoader(extension));
    await host.install(manifest());
    await host.activate('demo-extension');
    await expect(host.deactivate('demo-extension')).resolves.toBeUndefined();
    expect(disposed).toEqual(['x']);
    expect(host.get('demo-extension')?.state).toBe('failed');
  });

  it('failed activate reaps staged disposables (transactional rollback) + marks failed', async () => {
    // Regression (doc §59): disposables pushed during activate() must be
    // rolled back so a half-wired extension is fully inert.
    const host = new ExtensionHost();
    const disposed: string[] = [];
    const extension: Extension = {
      activate: (_api, ctx) => {
        ctx.addDisposable({ dispose: () => { disposed.push('a'); } });
        ctx.addDisposable({ dispose: () => { disposed.push('b'); } });
        throw new Error('boom');
      },
    };
    host.registerLoader(fakeLoader(extension));
    await host.install(manifest());
    await expect(host.activate('demo-extension')).rejects.toThrow('boom');
    expect(host.get('demo-extension')?.state).toBe('failed');
    expect(host.get('demo-extension')?.extension).toBeUndefined();
    // LIFO rollback: 'b' disposed before 'a'.
    expect(disposed).toEqual(['b', 'a']);
  });

  it('reload destroys the runtime and re-activates', async () => {
    const host = new ExtensionHost();
    let count = 0;
    const extension: Extension = { activate: () => { count++; } };
    host.registerLoader(fakeLoader(extension));
    await host.install(manifest());
    await host.activate('demo-extension');
    await host.reload('demo-extension');
    expect(count).toBe(2);
    expect(host.get('demo-extension')?.state).toBe('active');
  });
});

// ── ExtensionRuntime unit tests (abort + dispose order) ────────────────────

describe('ExtensionRuntime', () => {
  it('aborts its signal on dispose', async () => {
    let aborted = false;
    const ext: Extension = {
      activate: (_api, ctx) => { ctx.signal.addEventListener('abort', () => { aborted = true; }); },
    };
    const runtime = makeRuntime(ext);
    await runtime.activate();
    expect(runtime.signal.aborted).toBe(false);
    await runtime.dispose();
    expect(aborted).toBe(true);
    expect(runtime.signal.aborted).toBe(true);
  });

  it('rolls back staged disposables when activate throws (LIFO)', async () => {
    const disposed: string[] = [];
    const ext: Extension = {
      activate: (_api, ctx) => {
        ctx.addDisposable({ dispose: () => { disposed.push('a'); } });
        ctx.addDisposable({ dispose: () => { disposed.push('b'); } });
        throw new Error('boom');
      },
    };
    const runtime = makeRuntime(ext);
    await expect(runtime.activate()).rejects.toThrow('boom');
    expect(disposed).toEqual(['b', 'a']);
  });

  it('commits staged disposables after a successful activate', async () => {
    const disposed: string[] = [];
    const ext: Extension = {
      activate: (_api, ctx) => {
        ctx.addDisposable({ dispose: () => { disposed.push('a'); } });
      },
    };
    const runtime = makeRuntime(ext);
    await runtime.activate();
    expect(disposed).toEqual([]);
    await runtime.dispose();
    expect(disposed).toEqual(['a']);
  });

  it('deactivate hook runs before disposables are reaped', async () => {
    const order: string[] = [];
    const ext: Extension = {
      activate: (_api, ctx) => { ctx.addDisposable({ dispose: () => { order.push('dispose'); } }); },
      deactivate: () => { order.push('deactivate'); },
    };
    const runtime = makeRuntime(ext);
    await runtime.activate();
    await runtime.dispose();
    expect(order).toEqual(['deactivate', 'dispose']);
  });
});


// ── OwnedRegistry + combineSignals ────────────────────────────────────────────

describe('OwnedRegistry', () => {
  interface Cmd { id: string }
  const idFor = (c: Cmd) => c.id;

  it('tracks owner and removes by owner', () => {
    const r = new OwnedRegistry<Cmd>(idFor);
    const d1 = r.register({ id: 'a' }, 'ext.one');
    const d2 = r.register({ id: 'b' }, 'ext.two');
    expect(r.list().map((c) => c.id).sort()).toEqual(['a', 'b']);
    r.removeByOwner('ext.one');
    expect(r.get('a')).toBeUndefined();
    expect(r.get('b')).toBeDefined();
    d2.dispose();
    expect(r.list()).toHaveLength(0);
  });

  it('dispose only removes if still the same instance (re-register safe)', () => {
    const r = new OwnedRegistry<Cmd>(idFor);
    const first = r.register({ id: 'a' }, 'ext');
    r.register({ id: 'a' }, 'ext'); // re-register replaces
    first.dispose(); // late dispose of the OLD handle must NOT evict the new one
    expect(r.get('a')).toBeDefined();
  });

  it('builtin owner constant is exported', () => {
    expect(FOLYN_CORE_OWNER).toBe('folyn.core');
  });
});

describe('combineSignals', () => {
  it('aborts when any input aborts', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals(a.signal, b.signal);
    expect(combined.aborted).toBe(false);
    b.abort();
    expect(combined.aborted).toBe(true);
  });

  it('is already aborted if an input is aborted at combine time', () => {
    const a = new AbortController();
    a.abort();
    const combined = combineSignals(a.signal);
    expect(combined.aborted).toBe(true);
  });

  it('ignores undefined inputs', () => {
    const combined = combineSignals(undefined, undefined);
    expect(combined.aborted).toBe(false);
  });
});

// Re-export Disposable type so the import above is used in a type position
// (keeps `Disposable` in the test's import set without a runtime import).
type _UsesDisposable = Disposable;
