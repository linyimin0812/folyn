import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// Mock study store — mirrors the renderToString discipline used in
// ClipCardView.test.tsx (no @testing-library/react dep).
const createTopic = vi.fn(async (_title: string): Promise<string | null> => 'new-slug');
const selectTopic = vi.fn((_slug: string) => {});
const deleteTopic = vi.fn(async (_slug: string) => {});
const studyState = {
  topics: [],
  activeSlug: null,
  selectTopic,
  createTopic,
  deleteTopic,
};
vi.mock('@/store/studyStore', () => ({
  useStudyStore: Object.assign((sel: (s: typeof studyState) => unknown) => sel(studyState), {
    getState: () => studyState,
  }),
}));

// Mock sm2 + dailyScan so the list renders without date/scheduling deps.
vi.mock('@/features/study/sm2', () => ({ isDue: () => false }));
vi.mock('@/features/schedule/dailyScan', () => ({ dateToString: () => '2026-07-02' }));

import { StudyTopicList } from './StudyTopicList';

describe('StudyTopicList', () => {
  it('renders header + button without inline sw-quick-add', () => {
    const html = renderToString(<StudyTopicList />);
    expect(html).toContain('学习主题');
    expect(html).toContain('sw-add-btn');
    // Inline add block removed.
    expect(html).not.toContain('sw-quick-add');
  });

  it('shows empty hint when no topics', () => {
    const html = renderToString(<StudyTopicList />);
    expect(html).toContain('暂无学习主题');
  });
});
