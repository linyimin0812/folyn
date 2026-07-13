import { describe, it, expect } from 'vitest';
import { nextSelectedEdgeId } from './ErDiagramX6';

describe('nextSelectedEdgeId', () => {
  it('selects the clicked edge when nothing was selected', () => {
    expect(nextSelectedEdgeId(null, 'e1')).toBe('e1');
  });

  it('switches selection when a different edge is clicked', () => {
    expect(nextSelectedEdgeId('e1', 'e2')).toBe('e2');
  });

  it('deselects when the already-selected edge is clicked again', () => {
    expect(nextSelectedEdgeId('e1', 'e1')).toBeNull();
  });

  it('clears selection on a blank-canvas click regardless of prior state', () => {
    expect(nextSelectedEdgeId('e1', null)).toBeNull();
    expect(nextSelectedEdgeId(null, null)).toBeNull();
  });
});
