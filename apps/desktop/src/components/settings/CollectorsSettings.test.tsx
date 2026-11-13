/**
 * The collector settings card with a collector that brings its own form: the
 * form's changes are saved at once and survive a later 保存 of the schema
 * fields (the draft must not clobber them).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CollectorConfigFormProps, ExtensionApi } from '@folyn/extension-host';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { useActivityCollectorStore } from '@/store/activityCollectorStore';
import i18n from '@/i18n';
import { CollectorsSettings } from './CollectorsSettings';

const api = { marker: 'the-extension-api' } as unknown as ExtensionApi;
let seenApi: ExtensionApi | null = null;

function OwnForm({ config, update, api: given }: CollectorConfigFormProps) {
  seenApi = given;
  return (
    <div>
      <span data-testid="own-accounts">{JSON.stringify(config.accounts ?? null)}</span>
      <button onClick={() => update({ accounts: ['a@example.com'] })}>own:add-account</button>
      <button onClick={() => { update({ one: 1 }); update({ two: 2 }); }}>own:two-updates</button>
    </div>
  );
}

function register(withSchema: boolean) {
  useCollectorRegistryStore.getState().register({
    extensionId: 'ext.mail',
    extensionName: 'Mail',
    collectors: [{
      id: 'mail',
      activityTypes: ['mail'],
      mode: 'poll',
      ...(withSchema && {
        authSchema: { type: 'object' as const, properties: { token: { type: 'string' as const, title: 'Token' } } },
      }),
    }],
    activityDisplay: [],
    entityTypes: [],
    configForms: { mail: OwnForm },
    api,
  });
}

const savedConfig = () => useActivityCollectorStore.getState().configs['mail'];
const saveLabel = () => i18n.t('activity:collectors.save');

beforeEach(() => {
  seenApi = null;
  useActivityCollectorStore.setState({ configs: { mail: { token: 'old' } } });
});

afterEach(() => {
  cleanup();
  useCollectorRegistryStore.getState().unregister('ext.mail');
});

describe('CollectorsSettings with a collector-owned form', () => {
  it('mounts the form with the saved config and the extension api', () => {
    useActivityCollectorStore.setState({ configs: { mail: { accounts: ['x@example.com'] } } });
    register(true);
    render(<CollectorsSettings />);

    expect(screen.getByTestId('own-accounts').textContent).toBe('["x@example.com"]');
    expect(seenApi).toBe(api);
  });

  it('saves a change from the form at once, merged into the saved config', () => {
    register(true);
    render(<CollectorsSettings />);
    fireEvent.click(screen.getByText('own:add-account'));

    expect(savedConfig()).toEqual({ token: 'old', accounts: ['a@example.com'] });
    expect(screen.getByTestId('own-accounts').textContent).toBe('["a@example.com"]');
  });

  it('merges two updates made in a row', () => {
    register(true);
    render(<CollectorsSettings />);
    fireEvent.click(screen.getByText('own:two-updates'));

    expect(savedConfig()).toEqual({ token: 'old', one: 1, two: 2 });
  });

  it('keeps the form\'s change when the schema fields are saved afterwards', () => {
    register(true);
    render(<CollectorsSettings />);
    fireEvent.click(screen.getByText('own:add-account'));
    fireEvent.change(screen.getByDisplayValue('old'), { target: { value: 'new' } });
    // The schema field is a draft until saved.
    expect(savedConfig()).toEqual({ token: 'old', accounts: ['a@example.com'] });

    fireEvent.click(screen.getByText(saveLabel()));
    expect(savedConfig()).toEqual({ token: 'new', accounts: ['a@example.com'] });
  });

  it('shows the form for a collector with no schema fields, without a save button', () => {
    register(false);
    render(<CollectorsSettings />);

    expect(screen.queryByText('own:add-account')).not.toBeNull();
    expect(saveLabel()).not.toBe('activity:collectors.save');
    expect(screen.queryByText(saveLabel())).toBeNull();
  });
});
