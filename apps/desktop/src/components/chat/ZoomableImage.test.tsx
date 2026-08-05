import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZoomableImage } from './ZoomableImage';

afterEach(() => cleanup());

describe('ZoomableImage', () => {
  it('opens a fullscreen lightbox when the thumbnail is clicked', () => {
    render(<ZoomableImage src="data:image/png;base64,AAAA" alt="pic" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByAltText('pic'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Thumbnail + enlarged copy both render.
    expect(screen.getAllByAltText('pic')).toHaveLength(2);
  });

  it('closes the lightbox on Escape', () => {
    render(<ZoomableImage src="data:image/png;base64,AAAA" alt="pic" />);
    fireEvent.click(screen.getByAltText('pic'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the lightbox when the overlay is clicked', () => {
    render(<ZoomableImage src="data:image/png;base64,AAAA" alt="pic" />);
    fireEvent.click(screen.getByAltText('pic'));
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
