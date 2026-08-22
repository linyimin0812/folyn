import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PetMascot } from './PetMascot';

afterEach(() => {
  cleanup();
});

describe('PetMascot', () => {
  const STATES = ['idle', 'hover', 'drag', 'click'] as const;

  it('renders an img mascot rooted at .pet-mascot', () => {
    const { container } = render(<PetMascot state="idle" />);
    const img = container.querySelector('.pet-mascot');
    expect(img).toBeTruthy();
    expect(img?.tagName.toLowerCase()).toBe('img');
  });

  it.each(STATES)('applies the is-%s state class to the mascot root', (state) => {
    const { container } = render(<PetMascot state={state} />);
    const img = container.querySelector('.pet-mascot');
    expect(img?.getAttribute('class')).toContain(`is-${state}`);
  });

  it('renders the builtin pet.gif src by default', () => {
    const { container } = render(<PetMascot state="idle" />);
    const img = container.querySelector('.pet-mascot') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBeTruthy();
  });
});
