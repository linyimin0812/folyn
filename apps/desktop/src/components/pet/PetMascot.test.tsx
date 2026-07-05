import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PetMascot } from './PetMascot';

afterEach(() => {
  cleanup();
});

describe('PetMascot', () => {
  const STATES = ['idle', 'hover', 'drag', 'click'] as const;

  it('renders an SVG mascot rooted at .pet-mascot', () => {
    const { container } = render(<PetMascot state="idle" />);
    const svg = container.querySelector('.pet-mascot');
    expect(svg).toBeTruthy();
    expect(svg?.tagName.toLowerCase()).toBe('svg');
  });

  it.each(STATES)('applies the is-%s state class to the mascot root', (state) => {
    const { container } = render(<PetMascot state={state} />);
    const svg = container.querySelector('.pet-mascot');
    // SVG className is an SVGAnimatedString in the DOM; read via attribute.
    expect(svg?.getAttribute('class')).toContain(`is-${state}`);
  });

  it('renders the ink-drop body and quill tip paths', () => {
    const { container } = render(<PetMascot state="idle" />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
});
