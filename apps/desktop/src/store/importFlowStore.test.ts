import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImportFlowStore } from './importFlowStore';

// ── Mock layout ──
// importFlowStore pulls: vaultStore (import engine + fileTree/currentVault),
// toastStore, i18n (t passthrough), platform (isTauri true), plugin-fs (stat
// routing file vs dir), api/core invoke + plugin-dialog (native pick).
// vaultStore's mock keeps a fresh state object per test via getState().

const toastMock = vi.hoisted(() => ({ pushes: [] as string[] }));

vi.mock('@/store/toastStore', () => ({
  useToastStore: { getState: () => ({ push: (m: string) => toastMock.pushes.push(m) }) },
}));

vi.mock('@/i18n', () => ({
  // t passthrough: assertions read the pushed key, not the translated text.
  default: { t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k) },
}));

vi.mock('@/utils/platform', () => ({ isTauri: () => true }));

vi.mock('@/utils/storageClient', () => ({
  storageClient: { get: vi.fn(async () => null), set: vi.fn(async () => {}), remove: vi.fn(async () => {}), getFresh: vi.fn(async () => null), flushNow: vi.fn(async () => {}) },
}));

const vaultState = vi.hoisted(() => ({
  currentVault: { basePath: '/Users/t/vault' },
  fileTree: [],
  externalFileExistsAt: vi.fn(async () => false),
  copyExternalFileToVault: vi.fn(async (_p: string, _d: string) => 'ok'),
  overwriteExternalFileToVault: vi.fn(async (_p: string, _d: string) => 'ok'),
  copyExternalDirToVault: vi.fn(async (_p: string, _d: string) => 'ok'),
}));

vi.mock('./vaultStore', () => ({
  useVaultStore: { getState: () => vaultState, setState: vi.fn(), subscribe: vi.fn() },
}));

const statImpl = vi.hoisted(() => ({ impl: vi.fn(async () => ({ isDirectory: false, isFile: true })) }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: (p: string) => statImpl.impl(p),
  readDir: vi.fn(async () => []),
}));

const invokeMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const dialogOpenMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialogOpenMock }));

/** Drive the in-app folder picker that startImport shows: confirm `dir` or cancel. */
function resolvePicker(dir: string | null) {
  const s = useImportFlowStore.getState();
  if (dir === null) s.onPickerCancel();
  else void s.onPickerConfirm(dir);
}

/** Drive the conflict dialog: resolve with a choice (+applyToAll). */
function resolveConflict(choice: 'overwrite' | 'skip' | 'rename', applyToAll = false) {
  useImportFlowStore.getState().onConflictResolve({ choice, applyToAll });
}

/** The flow awaits several dynamic imports (mocked — but each import()
 *  resolves on its own microtask), so driving it needs more than one tick:
 *  flush N microtasks before asserting/dialog-driving. */
async function flush(n = 25): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('importFlowStore.startImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastMock.pushes.length = 0;
    vaultState.currentVault = { basePath: '/Users/t/vault' };
    vaultState.externalFileExistsAt.mockResolvedValue(false);
    statImpl.impl.mockResolvedValue({ isDirectory: false, isFile: true });
    // Reset store state without recreating the module (dialog resolvers are
    // module-level and cleared by the actions themselves).
    useImportFlowStore.setState({ pickerVisible: false, pickerFileTree: [], conflictFile: null, conflictRemaining: 0 });
  });

  it('imports files: no conflict → copyExternalFileToVault, imported toast', async () => {
    const p = useImportFlowStore.getState().startImport(['/Users/x/a.md', '/Users/x/b.md']);
    await Promise.resolve(); // let startImport set pickerVisible + park on the promise
    expect(useImportFlowStore.getState().pickerVisible).toBe(true);
    resolvePicker('docs');
    await p;

    expect(vaultState.copyExternalFileToVault).toHaveBeenCalledWith('/Users/x/a.md', 'docs');
    expect(vaultState.copyExternalFileToVault).toHaveBeenCalledWith('/Users/x/b.md', 'docs');
    expect(toastMock.pushes).toEqual(['editor:filePaste.imported:{"count":2,"where":"docs"}']);
  });

  it('routes directories to copyExternalDirToVault with no conflict dialog', async () => {
    statImpl.impl.mockResolvedValue({ isDirectory: true, isFile: false });
    const p = useImportFlowStore.getState().startImport(['/Users/x/proj']);
    await flush();
    resolvePicker('');
    await p;

    expect(vaultState.copyExternalDirToVault).toHaveBeenCalledWith('/Users/x/proj', '');
    expect(vaultState.copyExternalFileToVault).not.toHaveBeenCalled();
    expect(useImportFlowStore.getState().conflictFile).toBeNull();
    expect(toastMock.pushes).toEqual(['editor:filePaste.imported:{"count":1,"where":"editor:filePaste.vaultRoot"}']);
  });

  it('picker cancel imports nothing', async () => {
    const p = useImportFlowStore.getState().startImport(['/Users/x/a.md']);
    await flush();
    resolvePicker(null);
    await p;

    expect(vaultState.copyExternalFileToVault).not.toHaveBeenCalled();
    expect(toastMock.pushes).toEqual([]);
    expect(useImportFlowStore.getState().pickerVisible).toBe(false);
  });

  it('conflict → skip counts and allSkipped toast', async () => {
    vaultState.externalFileExistsAt.mockResolvedValue(true);
    const p = useImportFlowStore.getState().startImport(['/Users/x/a.md']);
    await flush();
    resolvePicker('');
    await flush();
    expect(useImportFlowStore.getState().conflictFile).toBe('a.md');
    resolveConflict('skip');
    await p;

    expect(vaultState.copyExternalFileToVault).not.toHaveBeenCalled();
    expect(toastMock.pushes).toEqual(['editor:filePaste.allSkipped:{"count":1}']);
  });

  it('conflict → overwrite calls overwriteExternalFileToVault', async () => {
    vaultState.externalFileExistsAt.mockResolvedValue(true);
    const p = useImportFlowStore.getState().startImport(['/Users/x/a.md']);
    await flush();
    resolvePicker('docs');
    await flush();
    resolveConflict('overwrite');
    await p;

    expect(vaultState.overwriteExternalFileToVault).toHaveBeenCalledWith('/Users/x/a.md', 'docs');
    expect(vaultState.copyExternalFileToVault).not.toHaveBeenCalled();
  });

  it('applyToAll reuses the batch choice for later conflicts', async () => {
    vaultState.externalFileExistsAt.mockResolvedValue(true);
    const p = useImportFlowStore.getState().startImport(['/Users/x/a.md', '/Users/x/b.md']);
    await flush();
    resolvePicker('');
    await flush();
    resolveConflict('overwrite', true);
    await flush();
    expect(useImportFlowStore.getState().conflictFile).toBeNull(); // batch applied — no second dialog for b.md
    await p;

    expect(vaultState.overwriteExternalFileToVault).toHaveBeenCalledTimes(2);
  });

  it('no vault open → openVaultFirst toast, no picker', async () => {
    vaultState.currentVault = { basePath: '' };
    await useImportFlowStore.getState().startImport(['/Users/x/a.md']);

    expect(useImportFlowStore.getState().pickerVisible).toBe(false);
    expect(toastMock.pushes).toEqual(['editor:filePaste.openVaultFirst']);
  });
});

describe('importFlowStore.startImportFromDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastMock.pushes.length = 0;
    vaultState.currentVault = { basePath: '/Users/t/vault' };
    vaultState.externalFileExistsAt.mockResolvedValue(false);
    statImpl.impl.mockResolvedValue({ isDirectory: false, isFile: true });
    useImportFlowStore.setState({ pickerVisible: false, pickerFileTree: [], conflictFile: null, conflictRemaining: 0 });
  });

  it('native mixed pick (macOS command) → imports picked paths', async () => {
    invokeMock.mockResolvedValue(['/Users/x/a.md']);
    const p = useImportFlowStore.getState().startImportFromDialog();
    await flush();
    resolvePicker('docs');
    await p;

    expect(invokeMock).toHaveBeenCalledWith('pick_external_paths');
    expect(vaultState.copyExternalFileToVault).toHaveBeenCalledWith('/Users/x/a.md', 'docs');
  });

  it('cancelled native pick (null) → no picker, no import', async () => {
    invokeMock.mockResolvedValue(null);
    await useImportFlowStore.getState().startImportFromDialog();

    expect(useImportFlowStore.getState().pickerVisible).toBe(false);
    expect(vaultState.copyExternalFileToVault).not.toHaveBeenCalled();
  });

  it('command unsupported → falls back to the plugin files-only dialog', async () => {
    invokeMock.mockRejectedValue(new Error('macos-only'));
    dialogOpenMock.mockResolvedValue(['/Users/x/f.txt']);
    const p = useImportFlowStore.getState().startImportFromDialog();
    await flush();
    resolvePicker('');
    await p;

    expect(dialogOpenMock).toHaveBeenCalledWith({ multiple: true });
    expect(vaultState.copyExternalFileToVault).toHaveBeenCalledWith('/Users/x/f.txt', '');
  });
});
