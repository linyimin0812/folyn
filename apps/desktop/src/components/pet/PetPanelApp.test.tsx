import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Mock @tauri-apps/api/core invoke — provided via vitest.workspace.ts alias.
import { invoke } from '@tauri-apps/api/core';

// Mock the heavy child components so this test focuses on tab host behavior.
// Each renders a div tagged with its root class name (matches real root).
vi.mock('./PetLauncher', () => ({
  PetLauncher: () => <div className="pet-launcher">launcher</div>,
}));
vi.mock('./PetChat', () => ({
  PetChat: () => <div className="pet-chat">chat</div>,
}));

import { PetPanelApp } from './PetPanelApp';

const invokeMock = invoke as unknown as import('vitest').Mock;

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('PetPanelApp', () => {
  it('defaults to the Actions tab and shows the launcher (not chat)', () => {
    const { container } = render(<PetPanelApp />);
    expect(container.querySelector('.pet-launcher')).toBeTruthy();
    expect(container.querySelector('.pet-chat')).toBeNull();
    const actionsTab = screen.getByRole('tab', { name: 'Actions' });
    expect(actionsTab.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking the Chat tab mounts PetChat and unmounts PetLauncher', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(container.querySelector('.pet-chat')).toBeTruthy();
    expect(container.querySelector('.pet-launcher')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Actions' }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking Actions tab reverses back to the launcher', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(container.querySelector('.pet-chat')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
    expect(container.querySelector('.pet-launcher')).toBeTruthy();
    expect(container.querySelector('.pet-chat')).toBeNull();
  });

  it('close button hides the panel via pet_panel_hide', async () => {
    render(<PetPanelApp />);
    await fireEvent.click(screen.getByLabelText('Close pet panel'));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
  });

  it('Esc hides the panel via pet_panel_hide', async () => {
    render(<PetPanelApp />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
  });
});
