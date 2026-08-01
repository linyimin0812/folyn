import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { PairSelector, useEnabledPairs, type Pair } from './PairSelector';
import type { AiConfigState } from '@/store/aiConfigStore';

// ── Mock backing store ────────────────────────────────────────────────
// The component reads providerSettings + customerProviders. A mutable
// backing object lets each test seed the catalog snapshot it needs.

let aiState: Pick<
  AiConfigState,
  'providerSettings' | 'customerProviders'
>;

vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: (sel: (s: typeof aiState) => unknown) => sel(aiState),
}));

function setState(next: Partial<typeof aiState>) {
  aiState = { ...aiState, ...next };
}

beforeEach(() => {
  aiState = {
    providerSettings: {},
    customerProviders: {},
  };
});

afterEach(() => cleanup());

// Helper: render the selector with a controlled onChange + remember calls.
function renderSelector(props: React.ComponentProps<typeof PairSelector>) {
  const onChange = vi.fn();
  render(<PairSelector {...props} onChange={onChange} />);
  return { onChange };
}

/** Open the dropdown panel via the trigger button. */
function openPanel() {
  fireEvent.click(screen.getByTestId('pair-selector'));
  return screen.getByTestId('pair-selector-panel');
}

const anthropicSlot = {
  id: 'anthropic',
  baseUrl: '',
  apiKey: '',
  selectedModelIds: ['claude-sonnet-4-6'],
  enabled: true,
  extra: {},
};

describe('PairSelector', () => {
  it('renders the placeholder on the trigger when no pair is selected', () => {
    setState({
      providerSettings: { anthropic: { ...anthropicSlot } },
    });
    renderSelector({ value: null });
    expect(screen.getByText('选择模型')).toBeTruthy();
  });

  it('renders all enabled-provider × selectedModelIds rows when opened', () => {
    setState({
      providerSettings: {
        anthropic: {
          ...anthropicSlot,
          selectedModelIds: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        },
        openai: {
          id: 'openai',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['gpt-5.2'],
          enabled: true,
          extra: {},
        },
      },
    });
    renderSelector({ value: null });
    const panel = openPanel();
    // 2 anthropic + 1 openai = 3 option rows (placeholder row is separate)
    expect(panel.querySelectorAll('[role="option"]').length).toBe(3);
    expect(screen.getByText(/claude-sonnet-4-6/)).toBeTruthy();
    expect(screen.getByText(/claude-opus-4-7/)).toBeTruthy();
    expect(screen.getByText(/gpt-5\.2/)).toBeTruthy();
  });

  it('does not show disabled providers or providers with empty selectedModelIds', () => {
    setState({
      providerSettings: {
        anthropic: { ...anthropicSlot },
        // disabled provider with models — must NOT appear
        openai: {
          id: 'openai',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['gpt-5.2'],
          enabled: false,
          extra: {},
        },
        // enabled but no models — must NOT appear
        cohere: {
          id: 'cohere',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: [],
          enabled: true,
          extra: {},
        },
      },
    });
    renderSelector({ value: null });
    const panel = openPanel();
    expect(panel.querySelectorAll('[role="option"]').length).toBe(1);
    expect(screen.queryByText(/gpt-5\.2/)).toBeNull();
    expect(screen.queryByText(/command-r-plus/)).toBeNull();
  });

  it('calls onChange with the selected pair and closes when a row is picked', () => {
    setState({
      providerSettings: { anthropic: { ...anthropicSlot } },
    });
    const { onChange } = renderSelector({ value: null });
    const panel = openPanel();
    fireEvent.mouseDown(screen.getByText(/claude-sonnet-4-6/));
    expect(onChange).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    expect(screen.queryByTestId('pair-selector-panel')).toBeNull();
    expect(panel.isConnected).toBe(false);
  });

  it('shows the current pair on the trigger (bold provider name | model)', () => {
    setState({
      providerSettings: { anthropic: { ...anthropicSlot } },
    });
    renderSelector({ value: { provider: 'anthropic', model: 'claude-sonnet-4-6' } });
    const trigger = screen.getByTestId('pair-selector');
    expect(trigger.textContent).toContain('claude-sonnet-4-6');
    // provider name renders in the bold span before the | separator
    expect(trigger.querySelector('span.font-semibold')?.textContent).toBeTruthy();
    expect(trigger.textContent).toContain('|');
  });

  it('fires onChange(null) when the placeholder row is re-picked (clear path)', () => {
    setState({
      providerSettings: {
        anthropic: {
          ...anthropicSlot,
          // ponytail: a model id containing '/' — the row key must NOT
          // split on '/' or treat it as a sub-path.
          selectedModelIds: ['anthropic/claude-3.5-sonnet'],
        },
      },
    });
    // value is set — placeholder row is active and re-selectable.
    const { onChange } = renderSelector({
      value: { provider: 'anthropic', model: 'anthropic/claude-3.5-sonnet' },
    });
    const panel0 = openPanel();
    // sanity: the slash-bearing model id row selects cleanly (scoped to the
    // panel — the trigger shows the same model text).
    fireEvent.mouseDown(within(panel0).getByText('anthropic/claude-3.5-sonnet'));
    expect(onChange).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'anthropic/claude-3.5-sonnet',
    });
    onChange.mockClear();
    // re-open and pick the placeholder row — must fire onChange(null).
    const panel = openPanel();
    fireEvent.mouseDown(within(panel).getByText('选择模型'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('placeholder row is inert when no value is set', () => {
    setState({
      providerSettings: { anthropic: { ...anthropicSlot } },
    });
    const { onChange } = renderSelector({ value: null });
    const panel = openPanel();
    fireEvent.mouseDown(within(panel).getByText('选择模型'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the empty-state hint when no provider is enabled', () => {
    setState({
      providerSettings: {
        openai: {
          id: 'openai',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['gpt-5.2'],
          enabled: false,
          extra: {},
        },
      },
    });
    const onOpenSettings = vi.fn();
    renderSelector({ value: null, onOpenSettings });
    expect(screen.getByTestId('pair-selector-empty')).toBeTruthy();
    expect(screen.getByText('未配置可用模型')).toBeTruthy();
    expect(screen.getByText('前往模型设置')).toBeTruthy();
  });

  it('icon trigger: opens upward panel with the empty state when no pair exists', () => {
    setState({ providerSettings: {} });
    const onOpenSettings = vi.fn();
    renderSelector({ value: null, trigger: 'icon', dropDirection: 'up', onOpenSettings });
    const root = screen.getByTestId('pair-selector-empty');
    // empty hint hidden until the icon button is clicked
    expect(screen.queryByText('未配置可用模型')).toBeNull();
    fireEvent.click(root.querySelector('button')!);
    expect(screen.getByText('未配置可用模型')).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('前往模型设置'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('icon trigger: shows the current provider icon and opens the pair panel', () => {
    setState({
      providerSettings: { anthropic: { ...anthropicSlot } },
    });
    const { onChange } = renderSelector({
      value: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      trigger: 'icon',
      dropDirection: 'up',
    });
    const trigger = screen.getByTestId('pair-selector');
    expect(trigger.title).toContain('claude-sonnet-4-6');
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByText(/claude-sonnet-4-6/));
    expect(onChange).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('useEnabledPairs returns the right list shape', () => {
    setState({
      customerProviders: {
        'my-custom': {
          id: 'my-custom',
          name: 'My Custom',
          adapterFamily: 'openai-completions',
        },
      },
      providerSettings: {
        anthropic: { ...anthropicSlot },
        'my-custom': {
          id: 'my-custom',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['custom-model-a', 'custom-model-b'],
          enabled: true,
          extra: {},
        },
      },
    });
    function Capture() {
      const { pairs, hasAny } = useEnabledPairs();
      return (
        <div data-testid="capture">
          {hasAny ? 'yes' : 'no'}|{pairs.map((p: Pair) => `${p.provider}=${p.model}`).join(',')}
        </div>
      );
    }
    render(<Capture />);
    const cap = screen.getByTestId('capture');
    expect(cap.textContent).toContain('yes');
    expect(cap.textContent).toContain('anthropic=claude-sonnet-4-6');
    expect(cap.textContent).toContain('my-custom=custom-model-a');
    expect(cap.textContent).toContain('my-custom=custom-model-b');
  });
});
