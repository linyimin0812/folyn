/**
 * Test for the trusted-extension render-isolation chokepoint.
 *
 * The hard contract: a extension-contributed component that throws during render
 * must NOT crash the host — the throw is isolated to the surface (inline
 * fallback), the host tree around it stays intact, and the error is recorded
 * to `extensionStore` so Settings can surface it. This is the one runnable check
 * for that non-trivial boundary logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { withExtensionBoundary } from './extensionBoundary';
import { useExtensionStore } from '@/store/extensionStore';

function ThrowingComponent(): ReactElement {
  // ponytail: throws intentionally to verify the boundary isolates a extension
  // render throw instead of white-screening the host.
  throw new Error('boom-from-extension');
}

function OkComponent(): ReactElement {
  return createElement('div', { 'data-testid': 'ok' }, 'ok');
}

describe('withExtensionBoundary', () => {
  // React logs caught errors to console.error; silence so test output stays clean.
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useExtensionStore.getState().clearRenderErrors('test-extension');
  });
  afterEach(() => {
    useExtensionStore.getState().clearRenderErrors('test-extension');
    spy.mockRestore();
  });

  it('isolates a render throw: fallback shown, host sibling intact, error recorded', () => {
    const Wrapped = withExtensionBoundary(ThrowingComponent, 'test-extension', 'file-type:demo:editor');
    // Render the wrapped extension component alongside a host sibling — the sibling
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
    expect(screen.getByText(/boom-from-extension/)).toBeTruthy();
    // Error recorded to extensionStore for Settings visibility.
    const errs = useExtensionStore.getState().renderErrors['test-extension'];
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toBe('boom-from-extension');
    expect(errs[0].label).toBe('file-type:demo:editor');
  });

  it('renders children normally when no throw', () => {
    const Wrapped = withExtensionBoundary(OkComponent, 'test-extension', 'ok-surface');
    render(createElement(Wrapped));
    expect(screen.getByTestId('ok').textContent).toBe('ok');
    // No throw → no render error recorded.
    expect(useExtensionStore.getState().renderErrors['test-extension']).toBeUndefined();
  });
});
