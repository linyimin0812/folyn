/**
 * Test for the trusted-plugin render-isolation chokepoint.
 *
 * The hard contract: a plugin-contributed component that throws during render
 * must NOT crash the host — the throw is isolated to the surface (inline
 * fallback), the host tree around it stays intact, and the error is recorded
 * to `pluginStore` so Settings can surface it. This is the one runnable check
 * for that non-trivial boundary logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { withPluginBoundary } from './pluginBoundary';
import { usePluginStore } from '@/store/pluginStore';

function ThrowingComponent(): ReactElement {
  // ponytail: throws intentionally to verify the boundary isolates a plugin
  // render throw instead of white-screening the host.
  throw new Error('boom-from-plugin');
}

function OkComponent(): ReactElement {
  return createElement('div', { 'data-testid': 'ok' }, 'ok');
}

describe('withPluginBoundary', () => {
  // React logs caught errors to console.error; silence so test output stays clean.
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    usePluginStore.getState().clearRenderErrors('test-plugin');
  });
  afterEach(() => {
    usePluginStore.getState().clearRenderErrors('test-plugin');
    spy.mockRestore();
  });

  it('isolates a render throw: fallback shown, host sibling intact, error recorded', () => {
    const Wrapped = withPluginBoundary(ThrowingComponent, 'test-plugin', 'file-type:demo:editor');
    // Render the wrapped plugin component alongside a host sibling — the sibling
    // must still render, proving the throw did not escape the boundary.
    render(
      createElement('div', null,
        createElement('div', { 'data-testid': 'sibling' }, 'sibling-ok'),
        createElement(Wrapped),
      ),
    );
    // Host tree around the throw survived.
    expect(screen.getByTestId('sibling').textContent).toBe('sibling-ok');
    // Boundary fallback surfaced (match on the error message — i18n-stable).
    expect(screen.getByText(/boom-from-plugin/)).toBeTruthy();
    // Error recorded to pluginStore for Settings visibility.
    const errs = usePluginStore.getState().renderErrors['test-plugin'];
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toBe('boom-from-plugin');
    expect(errs[0].label).toBe('file-type:demo:editor');
  });

  it('renders children normally when no throw', () => {
    const Wrapped = withPluginBoundary(OkComponent, 'test-plugin', 'ok-surface');
    render(createElement(Wrapped));
    expect(screen.getByTestId('ok').textContent).toBe('ok');
    // No throw → no render error recorded.
    expect(usePluginStore.getState().renderErrors['test-plugin']).toBeUndefined();
  });
});
