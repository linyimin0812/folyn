// @vitest-environment jsdom
/**
 * The settings form against a fake host: `update` merges into the config the
 * form is re-rendered with, as the collectors settings card does.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ExtensionApi } from 'folyn-extension-sdk';
import { FileConfigForm } from './FileConfigForm';

let saved: Record<string, unknown> = {};

function api(locale: string, filePanelFilters: string[]): ExtensionApi {
  return {
    env: { locale },
    vaultConfig: { getExcludePatterns: () => filePanelFilters },
  } as unknown as ExtensionApi;
}

function Host({ initial, host }: { initial: Record<string, unknown>; host: ExtensionApi }) {
  const [config, setConfig] = useState(initial);
  saved = config;
  return (
    <FileConfigForm
      config={config}
      update={(patch) => setConfig((c) => ({ ...c, ...patch }))}
      api={host}
    />
  );
}

afterEach(cleanup);

describe('FileConfigForm', () => {
  it('starts from the file-panel filters when the collector has none of its own', () => {
    render(<Host initial={{ allowAiSummary: true }} host={api('en', ['node_modules', '*.tmp'])} />);

    expect(saved).toEqual({ allowAiSummary: true, excludePatterns: 'node_modules\n*.tmp' });
    expect(screen.queryByText('node_modules')).not.toBeNull();
    expect(screen.queryByText('*.tmp')).not.toBeNull();
  });

  it('never re-seeds once the collector has its own list, even an empty one', () => {
    render(<Host initial={{ excludePatterns: '' }} host={api('en', ['node_modules'])} />);

    expect(saved).toEqual({ excludePatterns: '' });
    expect(screen.queryByText('No filter rules')).not.toBeNull();
  });

  it('adds a pattern on Enter and removes one from its chip', () => {
    render(<Host initial={{ excludePatterns: 'node_modules' }} host={api('en', [])} />);

    fireEvent.click(screen.getByText('+ Add'));
    const input = screen.getByPlaceholderText('Enter a filter pattern (supports * and ? wildcards)');
    fireEvent.change(input, { target: { value: ' *.tmp ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(saved.excludePatterns).toBe('node_modules\n*.tmp');

    fireEvent.click(screen.getByLabelText('× node_modules'));
    expect(saved.excludePatterns).toBe('*.tmp');
  });

  it('Escape drops the pattern being typed', () => {
    render(<Host initial={{ excludePatterns: '' }} host={api('en', [])} />);

    fireEvent.click(screen.getByText('+ Add'));
    const input = screen.getByPlaceholderText('Enter a filter pattern (supports * and ? wildcards)');
    fireEvent.change(input, { target: { value: '*.tmp' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(saved.excludePatterns).toBe('');
  });

  it('follows the host locale, falling back to English', () => {
    render(<Host initial={{ excludePatterns: '' }} host={api('zh', [])} />);
    expect(screen.queryByText('暂无过滤规则')).not.toBeNull();
    cleanup();

    render(<Host initial={{ excludePatterns: '' }} host={api('pt', [])} />);
    expect(screen.queryByText('No filter rules')).not.toBeNull();
  });
});
