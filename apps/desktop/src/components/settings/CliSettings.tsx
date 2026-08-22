/**
 * CLI 工具 settings tab — one card per CLI adapter (Claude Code / Pi / …),
 * each owning its binary path + detect + test. There is NO "active adapter"
 * selection here: which adapter a chat session runs is chosen inline in the
 * AI Panel / pet Chat (see AdapterSelector). This tab only configures paths.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb, Loader2 } from 'lucide-react';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useNavStore } from '@/store/navStore';
import { listAdapters, buildAdapterVersionCommand, buildAdapterDetectCommand } from '@quill/cli-adapter';
import { externalFileProvider } from '@/services/externalFileProvider';
import { openFile } from '@/services/editorIoService';
import { buildShellSidecar, isWindowsPlatform } from '@/utils/shellSidecar';
import claudeIcon from '@/assets/agents/claude_code.svg';
import codexIcon from '@/assets/agents/codex.svg';
import geminiIcon from '@/assets/agents/gemini.svg';
import opencodeIcon from '@/assets/agents/opencode.svg';
import piIcon from '@/assets/agents/pi.svg';
import qoderIcon from '@/assets/agents/qoder.svg';

// ponytail: same ADAPTER_ICON map exists in AdapterSelector.tsx and
// AgentCliTag.tsx — third copy here. Extract to shared module when a fourth
// caller shows up.
const ADAPTER_ICON: Record<string, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  gemini: geminiIcon,
  opencode: opencodeIcon,
  pi: piIcon,
  qoder: qoderIcon,
  'qoder-cn': qoderIcon,
};

type TestStatus = { testing: boolean; result?: { success: boolean; message: string } };
type SettingsFileState =
  | { kind: 'idle' }
  | { kind: 'missing' }
  | { kind: 'creating' }
  | { kind: 'error'; message: string };

function basename(p: string): string {
  return p.includes('/') ? p.substring(p.lastIndexOf('/') + 1) : p;
}

export function CliSettings() {
  const { t } = useTranslation();
  const cliPaths = useAiConfigStore((s) => s.cliPaths);
  const setCliPathFor = useAiConfigStore((s) => s.setCliPathFor);
  // Per-adapter test result state, keyed by adapter id.
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  // Per-adapter "open settings file" state, keyed by adapter id.
  const [settingsFileState, setSettingsFileState] = useState<Record<string, SettingsFileState>>({});
  // Per-adapter detect-in-flight flag, keyed by adapter id.
  const [detectingState, setDetectingState] = useState<Record<string, boolean>>({});

  async function openAdapterSettings(adapterId: string, path: string) {
    const st = settingsFileState[adapterId];
    if (st?.kind === 'creating') return;
    try {
      const exists = await externalFileProvider.exists(path);
      if (!exists) {
        setSettingsFileState((s) => ({ ...s, [adapterId]: { kind: 'missing' } }));
        return;
      }
      await openFile(path, basename(path));
      useNavStore.getState().setCurrentPage('editor');
      setSettingsFileState((s) => ({ ...s, [adapterId]: { kind: 'idle' } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSettingsFileState((s) => ({ ...s, [adapterId]: { kind: 'error', message } }));
    }
  }

  async function createAdapterSettings(adapterId: string, path: string, template: string) {
    setSettingsFileState((s) => ({ ...s, [adapterId]: { kind: 'creating' } }));
    try {
      await externalFileProvider.writeFile(path, template);
      await openFile(path, basename(path));
      useNavStore.getState().setCurrentPage('editor');
      setSettingsFileState((s) => ({ ...s, [adapterId]: { kind: 'idle' } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSettingsFileState((s) => ({ ...s, [adapterId]: { kind: 'error', message } }));
    }
  }

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:cli.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:cli.description')}</div>
      </div>
      <div className="text-[10.5px] text-t3 mb-3">
        {t('settings:cli.adapterHint')}
      </div>
      <div className="flex flex-col gap-3">
        {listAdapters().map((a) => {
          const path = cliPaths[a.id] ?? '';
          const st = testStatus[a.id] ?? { testing: false };
          const sf = settingsFileState[a.id] ?? { kind: 'idle' };
          const detecting = detectingState[a.id] ?? false;
          return (
            <div
              key={a.id}
              className="rounded-lg border border-brd bg-surf px-3.5 py-3"
            >
              <div className="flex items-baseline gap-2 mb-2">
                <img src={ADAPTER_ICON[a.id]} alt="" className="w-4 h-4 self-center" aria-hidden />
                <div className="text-[length:calc(var(--ui-font-size))] font-bold text-t1 font-mono">{a.displayName}</div>
              </div>
              <div className="text-[10.5px] text-t3 mb-2">{t(`settings:cli.adapters.${a.id}.description`, { defaultValue: a.description })}</div>
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">
                {t('settings:cli.cliPath.label')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  className="fi2 w-full flex-1 min-w-0 h-[30px] py-[5px] px-2.5 rounded-l-md border border-r-0 border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
                  value={path}
                  onChange={(e) => setCliPathFor(a.id, e.target.value)}
                  placeholder={a.id}
                  autoCapitalize="off"
                />
                <button
                  className="shrink-0 h-[30px] px-3 inline-flex items-center rounded-r-md border border-l-0 border-brd bg-accdim hover:bg-hov text-acc text-[length:calc(var(--ui-font-size)-2px)] font-ui transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('settings:cli.cliPath.detectTitle')}
                  disabled={detecting}
                  onClick={async () => {
                    setDetectingState((s) => ({ ...s, [a.id]: true }));
                    try {
                      const { Command } = await import('@tauri-apps/plugin-shell');
                      const adapterCmd = a.id === 'claude' ? 'claude' : a.id;
                      const platform = isWindowsPlatform() ? 'win32' : /Mac/i.test(navigator.platform) ? 'darwin' : 'linux';
                      const detectCmd = buildAdapterDetectCommand(adapterCmd, platform);
                      const [sidecarName, sidecarArgs] = buildShellSidecar(detectCmd);
                      const cmd = Command.create(sidecarName, sidecarArgs, isWindowsPlatform() ? { encoding: 'gbk' } : undefined);
                      const output = await cmd.execute();
                      const detected = output.stdout.trim().split('\n')[0];
                      if (output.code === 0 && detected) {
                        setCliPathFor(a.id, detected);
                        setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: true, message: t('settings:cli.cliPath.detected', { path: detected }) } } }));
                      } else {
                        setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: false, message: t('settings:cli.cliPath.notInstalled') } } }));
                      }
                    } catch (err) {
                      setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: false, message: t('settings:cli.cliPath.cannotRun', { error: String(err) }) } } }));
                    } finally {
                      setDetectingState((s) => ({ ...s, [a.id]: false }));
                    }
                    setTimeout(() => setTestStatus((s) => ({ ...s, [a.id]: { ...s[a.id], result: undefined } })), 6000);
                  }}
                >{detecting ? <Loader2 size={13} className="animate-spin" /> : t('settings:cli.cliPath.detect')}</button>
                <button
                  className="shrink-0 h-[30px] px-3 ml-1.5 inline-flex items-center rounded-md border border-brd bg-accdim hover:bg-hov text-acc text-[length:calc(var(--ui-font-size)-2px)] font-ui transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={st.testing}
                  onClick={async () => {
                    setTestStatus((s) => ({ ...s, [a.id]: { testing: true } }));
                    try {
                      const { Command } = await import('@tauri-apps/plugin-shell');
                      const p = useAiConfigStore.getState().cliPaths[a.id] ?? a.id;
                      const platform = isWindowsPlatform() ? 'win32' : /Mac/i.test(navigator.platform) ? 'darwin' : 'linux';
                      const versionCmd = buildAdapterVersionCommand(a.id, p, platform);
                      const [sidecarName, sidecarArgs] = buildShellSidecar(versionCmd);
                      const cmd = Command.create(sidecarName, sidecarArgs, isWindowsPlatform() ? { encoding: 'gbk' } : undefined);
                      const output = await cmd.execute();
                      if (output.code === 0) {
                        const version = output.stdout.trim().split('\n')[0];
                        setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: true, message: version || t('settings:cli.test.success') } } }));
                      } else {
                        setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: false, message: output.stderr.trim() || t('settings:cli.test.exitCode', { code: output.code }) } } }));
                      }
                    } catch (err) {
                      setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: false, message: t('settings:cli.test.cannotRun', { error: String(err) }) } } }));
                    }
                    setTimeout(() => setTestStatus((s) => ({ ...s, [a.id]: { ...s[a.id], result: undefined } })), 6000);
                  }}
                >{st.testing ? t('settings:cli.test.testing') : t('settings:cli.test.label')}</button>
              </div>
              {st.result && (
                <span style={{ fontSize: 11, color: st.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }} className="mt-1 inline-block">
                  {st.result.message}
                </span>
              )}
              {sf.kind === 'missing' && (
                <div className="mt-2 rounded-md border border-brd2 bg-surf2 px-2.5 py-1.5 flex items-center gap-2">
                  <span style={{ fontSize: 11, color: 'var(--red, #f06a6a)' }}>
                    {t('settings:cli.settingsFile.missing', { path: a.settingsFilePath })}
                  </span>
                  <span style={{ fontSize: 10.5 }} className="text-t3">{t('settings:cli.settingsFile.missingHint')}</span>
                  <button
                    className="btn btn-g btn-sm"
                    style={{ marginLeft: 'auto' }}
                    title={t('settings:cli.settingsFile.createTitle')}
                    onClick={() => createAdapterSettings(a.id, a.settingsFilePath, a.settingsFileTemplate)}
                  >{t('settings:cli.settingsFile.create')}</button>
                </div>
              )}
              {sf.kind === 'error' && (
                <div className="mt-2" style={{ fontSize: 11, color: 'var(--red, #f06a6a)' }}>
                  {sf.message}
                </div>
              )}
              <div className="text-[10.5px] text-t3 mt-1">{t('settings:cli.cliPath.hint')}</div>
              <div className="text-[10.5px] mt-0.5">
                <button
                  type="button"
                  className="font-mono text-acc hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  title={t('settings:cli.settingsFile.title')}
                  disabled={sf.kind === 'creating'}
                  onClick={() => openAdapterSettings(a.id, a.settingsFilePath)}
                >{a.settingsFilePath}</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5 mt-4">
        <Lightbulb size={17} className="shrink-0 mt-px text-acc" />
        <div>
          <h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">{t('settings:cli.usage.title')}</h4>
          <p className="text-[11px] text-t3 leading-normal m-0">{t('settings:cli.usage.description')}</p>
        </div>
      </div>
    </div>
  );
}
