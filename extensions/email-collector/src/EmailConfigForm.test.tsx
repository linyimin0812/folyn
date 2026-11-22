// @vitest-environment jsdom
/**
 * The settings form against a fake host: `update` merges into the config the
 * form is re-rendered with, as the collectors settings card does.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ExtensionApi } from 'folyn-extension-sdk';
import { EmailConfigForm } from './EmailConfigForm';

let saved: Record<string, unknown> = {};

function Host({ initial }: { initial: Record<string, unknown> }) {
  const [config, setConfig] = useState(initial);
  saved = config;
  return (
    <EmailConfigForm
      config={config}
      update={(patch) => setConfig((c) => ({ ...c, ...patch }))}
      api={{} as ExtensionApi}
    />
  );
}

afterEach(cleanup);

describe('EmailConfigForm', () => {
  it('adds a mailbox and saves each field as it is typed', () => {
    render(<Host initial={{ allowAiSummary: true }} />);
    fireEvent.click(screen.getByText('+ 添加邮箱'));
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'me@example.com' } });

    expect(saved).toEqual({
      allowAiSummary: true,
      accounts: [{ username: 'me@example.com', password: '', host: '' }],
    });
  });

  it('asks for the server only when the provider is not a known one', () => {
    render(<Host initial={{ accounts: [{ username: 'me@example.com', password: 'p' }] }} />);
    expect(screen.queryByPlaceholderText('imap.example.com')).not.toBeNull();
    expect(screen.queryByText('如何获取授权码？')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'me@gmail.com' } });
    expect(screen.queryByPlaceholderText('imap.example.com')).toBeNull();
    const help = screen.getByText('如何获取授权码？') as HTMLAnchorElement;
    expect(help.href).toBe('https://support.google.com/mail/answer/185833');
    // The host opens only `target="_blank"` links in the system browser.
    expect(help.target).toBe('_blank');
  });

  it('removes one mailbox and keeps the others', () => {
    render(
      <Host
        initial={{
          accounts: [
            { username: 'a@gmail.com', password: 'p1' },
            { username: 'b@gmail.com', password: 'p2' },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getAllByText('删除')[0]!);

    expect(saved.accounts).toEqual([{ username: 'b@gmail.com', password: 'p2' }]);
  });
});
