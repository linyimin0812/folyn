/**
 * Editor settings — script runtime config section. Renders one row per
 * RuntimeConfig in the store (default: shell / node / python). Each row has
 * a path input + Detect + Test. Reuses the detect/test pattern from
 * CliSettings.tsx (Tauri `claude-cli` sidecar `/bin/sh -lc`).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore } from '@/store/aiConfigStore';
import type { RuntimeConfig } from '@/services/scriptRunner/scriptRunnerService';
import { buildShellSidecar, isWindowsPlatform } from '@/utils/shellSidecar';

type TestStatus = { testing: boolean; result?: { success: boolean; message: string } };

export function ScriptRuntimesSettings() {
  const { t } = useTranslation();
  const runtimes = useAiConfigStore((s) => s.scriptRuntimes);
  const setRuntimePath = useAiConfigStore((s) => s.setRuntimePath);
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [detecting, setDetecting] = useState<Record<string, boolean>>({});

  return (
    <div className="mb-8 mt-4">
      <div className="pb-4 mb-5 border-b border-brd2 flex flex-wrap items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">
          {t('settings:scriptRuntime.title')}
        </div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3 whitespace-normal">
          {t('settings:scriptRuntime.description')}
        </div>
      </div>
      <div className="flex flex-col">
        {runtimes.map((r) => (
          <RuntimeRow
            key={r.id}
            runtime={r}
            testStatus={testStatus[r.id] ?? { testing: false }}
            detecting={detecting[r.id] ?? false}
            onPathChange={(path) => setRuntimePath(r.id, path)}
            onDetect={async () => {
              setDetecting((s) => ({ ...s, [r.id]: true }));
              try {
                const { Command } = await import('@tauri-apps/plugin-shell');
                const [name, args] = buildShellSidecar(r.detectCommand);
                const cmd = Command.create(name, args, isWindowsPlatform() ? { encoding: 'gbk' } : undefined);
                const output = await cmd.execute();
                const detected = output.stdout.trim().split('\n')[0];
                if (output.code === 0 && detected) {
                  setRuntimePath(r.id, detected);
                  setTestStatus((s) => ({
                    ...s,
                    [r.id]: { testing: false, result: { success: true, message: t('settings:scriptRuntime.detectDetected', { path: detected }) } },
                  }));
                } else {
                  setTestStatus((s) => ({
                    ...s,
                    [r.id]: { testing: false, result: { success: false, message: t('settings:scriptRuntime.detectNotInstalled') } },
                  }));
                }
              } catch (err) {
                setTestStatus((s) => ({
                  ...s,
                  [r.id]: { testing: false, result: { success: false, message: t('settings:scriptRuntime.detectCannotRun', { error: String(err) }) } },
                }));
              } finally {
                setDetecting((s) => ({ ...s, [r.id]: false }));
              }
              setTimeout(() => setTestStatus((s) => ({ ...s, [r.id]: { ...s[r.id], result: undefined } })), 6000);
            }}
            onTest={async () => {
              setTestStatus((s) => ({ ...s, [r.id]: { testing: true } }));
              try {
                const { Command } = await import('@tauri-apps/plugin-shell');
                const runCmd = `${r.binaryPath || r.defaultBinaryPath} ${r.versionArgs.join(' ')}`;
                const [name, args] = buildShellSidecar(runCmd);
                const cmd = Command.create(name, args, isWindowsPlatform() ? { encoding: 'gbk' } : undefined);
                const output = await cmd.execute();
                if (output.code === 0) {
                  const version = output.stdout.trim().split('\n')[0];
                  setTestStatus((s) => ({
                    ...s,
                    [r.id]: { testing: false, result: { success: true, message: version || t('settings:scriptRuntime.test.success') } },
                  }));
                } else {
                  setTestStatus((s) => ({
                    ...s,
                    [r.id]: { testing: false, result: { success: false, message: output.stderr.trim() || t('settings:scriptRuntime.test.exitCode', { code: output.code }) } },
                  }));
                }
              } catch (err) {
                setTestStatus((s) => ({
                  ...s,
                  [r.id]: { testing: false, result: { success: false, message: t('settings:scriptRuntime.test.cannotRun', { error: String(err) }) } },
                }));
              }
              setTimeout(() => setTestStatus((s) => ({ ...s, [r.id]: { ...s[r.id], result: undefined } })), 6000);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function RuntimeRow({
  runtime,
  testStatus,
  detecting,
  onPathChange,
  onDetect,
  onTest,
}: {
  runtime: RuntimeConfig;
  testStatus: TestStatus;
  detecting: boolean;
  onPathChange: (path: string) => void;
  onDetect: () => Promise<void>;
  onTest: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="tr py-3.5 border-b border-brd gap-3 flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{runtime.label}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{runtime.languageAliases.join(' / ')}</p>
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          <input
            className="fi2 py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc w-[220px]"
            value={runtime.binaryPath}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={runtime.defaultBinaryPath}
            autoCapitalize="off"
            spellCheck={false}
          />
          <button className="btn btn-g btn-sm flex items-center justify-center" style={{ minWidth: 56 }} disabled={detecting} title={t('settings:scriptRuntime.detectTitle')} onClick={onDetect}>
            {detecting ? (
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : t('settings:scriptRuntime.detect')}
          </button>
          <button className="btn btn-g btn-sm flex items-center justify-center" style={{ minWidth: 56 }} disabled={testStatus.testing} onClick={onTest}>
            {testStatus.testing ? (
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : t('settings:scriptRuntime.test.label')}
          </button>
        </div>
      </div>
      {testStatus.result && (
        <div
          style={{ fontSize: 11, color: testStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
          className="mt-1"
        >
          {testStatus.result.message}
        </div>
      )}
    </div>
  );
}
