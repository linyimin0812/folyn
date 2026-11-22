/**
 * Settings form of the email collector: the mailboxes to poll, kept in
 * `config.accounts`. Every edit is saved at once.
 *
 * ponytail: field labels hardcoded zh like the manifest's authSchema titles
 * — move to a locale table (`api.env.locale`) if another locale matters here.
 */
import type { ReactNode } from 'react';
import type { CollectorConfigFormProps } from 'folyn-extension-sdk';
import { authHelpUrl, showsServerFields } from './accountForm';

type Account = Record<string, unknown>;

export function EmailConfigForm({ config, update }: CollectorConfigFormProps) {
  const accounts = Array.isArray(config.accounts) ? (config.accounts as Account[]) : [];
  const write = (next: Account[]) => update({ accounts: next });
  const patch = (i: number, change: Account) =>
    write(accounts.map((a, j) => (j === i ? { ...a, ...change } : a)));

  const field = (
    i: number,
    key: string,
    label: string,
    placeholder: string,
    kind: 'text' | 'number' = 'text',
    hint?: ReactNode,
  ) => (
    <label className="block">
      <span className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-t2">{label}</span>
        {hint}
      </span>
      <input
        className="w-full text-[length:calc(var(--ui-font-size)-1px)] bg-panel border border-brd2 rounded-md px-2 py-1 text-t1 outline-none transition-[border-color] duration-100 focus:border-acc"
        type={kind}
        placeholder={placeholder}
        value={String(accounts[i]?.[key] ?? '')}
        onChange={(e) =>
          patch(i, {
            [key]: kind === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value,
          })
        }
      />
    </label>
  );

  return (
    <div className="mb-3">
      {accounts.map((acc, i) => {
        const helpUrl = authHelpUrl(acc.username);
        return (
          <div key={i} className="border border-brd2 rounded-md p-2.5 mb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-t2 truncate">
                {String(acc.username || `账户 ${i + 1}`)}
              </span>
              <button
                className="text-[11px] text-t3 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                onClick={() => write(accounts.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
              {field(i, 'username', '邮箱账号', 'you@example.com')}
              {field(
                i,
                'password',
                '密码 / 授权码',
                '',
                'text',
                // A plain external link: the host opens `target="_blank"`
                // http(s) links in the system browser.
                helpUrl && (
                  <a
                    className="text-[10px] text-acc hover:underline cursor-pointer"
                    href={helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    如何获取授权码？
                  </a>
                ),
              )}
              {showsServerFields(acc) && (
                <>
                  {field(i, 'host', 'IMAP 服务器（留空自动推断）', 'imap.example.com')}
                </>
              )}
            </div>
          </div>
        );
      })}
      <button
        className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-ui cursor-pointer border border-dashed border-brd2 text-t3 hover:border-acc hover:text-acc transition-all duration-100 bg-transparent"
        onClick={() => write([...accounts, { username: '', password: '', host: '' }])}
      >
        + 添加邮箱
      </button>
    </div>
  );
}
