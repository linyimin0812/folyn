import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

describe('PairSelector', () => {
  it('renders the placeholder option when no pair is selected', () => {
    setState({
      providerSettings: {
        anthropic: {
          id: 'anthropic',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['claude-sonnet-4-6'],
          enabled: true,
          customProvider: false,
          extra: {},
        },
      },
    });
    renderSelector({ value: null });
    const select = screen.getByTestId('pair-selector') as HTMLSelectElement;
    expect(select.value).toBe('');
    // placeholder option exists
    expect(screen.getByText('选择模型')).toBeTruthy();
  });

  it('renders all enabled-provider × selectedModelIds options', () => {
    setState({
      providerSettings: {
        anthropic: {
          id: 'anthropic',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['claude-sonnet-4-6', 'claude-opus-4-7'],
          enabled: true,
          customProvider: false,
          extra: {},
        },
        openai: {
          id: 'openai',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['gpt-5.2'],
          enabled: true,
          customProvider: false,
          extra: {},
        },
      },
    });
    renderSelector({ value: null });
    // 2 anthropic + 1 openai = 3 model options, +1 placeholder = 4 options
    const select = screen.getByTestId('pair-selector') as HTMLSelectElement;
    expect(select.options.length).toBe(4);
    expect(screen.getByText(/claude-sonnet-4-6/)).toBeTruthy();
    expect(screen.getByText(/claude-opus-4-7/)).toBeTruthy();
    expect(screen.getByText(/gpt-5\.2/)).toBeTruthy();
  });

  it('does not show disabled providers or providers with empty selectedModelIds', () => {
    setState({
      providerSettings: {
        anthropic: {
          id: 'anthropic',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['claude-sonnet-4-6'],
          enabled: true,
          customProvider: false,
          extra: {},
        },
        // disabled provider with models — must NOT appear
        openai: {
          id: 'openai',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['gpt-5.2'],
          enabled: false,
          customProvider: false,
          extra: {},
        },
        // enabled but no models — must NOT appear
        cohere: {
          id: 'cohere',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: [],
          enabled: true,
          customProvider: false,
          extra: {},
        },
      },
    });
    renderSelector({ value: null });
    const select = screen.getByTestId('pair-selector') as HTMLSelectElement;
    // placeholder + 1 anthropic option
    expect(select.options.length).toBe(2);
    expect(screen.queryByText(/gpt-5\.2/)).toBeNull();
    expect(screen.queryByText(/command-r-plus/)).toBeNull();
  });

  it('calls onChange with the selected pair when an option is picked', () => {
    setState({
      providerSettings: {
        anthropic: {
          id: 'anthropic',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['claude-sonnet-4-6'],
          enabled: true,
          customProvider: false,
          extra: {},
        },
      },
    });
    const { onChange } = renderSelector({ value: null });
    const select = screen.getByTestId('pair-selector') as HTMLSelectElement;
    // pick index 0 (the only model option)
    fireEvent.change(select, { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('fires onChange(null) when the placeholder is re-selected (clear path)', () => {
    setState({
      providerSettings: {
        anthropic: {
          id: 'anthropic',
          baseUrl: '',
          apiKey: '',
          // ponytail: a model id containing '/' — index-based round-trip
          // must NOT split on '/' or treat it as a sub-path.
          selectedModelIds: ['anthropic/claude-3.5-sonnet'],
          enabled: true,
          customProvider: false,
          extra: {},
        },
      },
    });
    // value is set — placeholder is enabled and re-selectable.
    const { onChange } = renderSelector({
      value: { provider: 'anthropic', model: 'anthropic/claude-3.5-sonnet' },
    });
    const select = screen.getByTestId('pair-selector') as HTMLSelectElement;
    // sanity: the slash-bearing model id round-trips via index 0.
    fireEvent.change(select, { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'anthropic/claude-3.5-sonnet',
    });
    onChange.mockClear();
    // re-select the placeholder — must fire onChange(null), NOT pairs[0].
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
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
          customProvider: false,
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
        anthropic: {
          id: 'anthropic',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['claude-sonnet-4-6'],
          enabled: true,
          customProvider: false,
          extra: {},
        },
        'my-custom': {
          id: 'my-custom',
          baseUrl: '',
          apiKey: '',
          selectedModelIds: ['custom-model-a', 'custom-model-b'],
          enabled: true,
          customProvider: true,
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
