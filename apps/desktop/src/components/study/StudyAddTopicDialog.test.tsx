import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

import { StudyAddTopicDialog } from './StudyAddTopicDialog';

describe('StudyAddTopicDialog', () => {
  it('renders dialog markup with heading and input', () => {
    const html = renderToString(
      <StudyAddTopicDialog onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain('新建学习主题');
    expect(html).toContain('dlg-overlay');
    expect(html).toContain('dlg-input');
    expect(html).toContain('placeholder="主题标题…"');
  });

  it('disables confirm button with empty title (initial render)', () => {
    const html = renderToString(
      <StudyAddTopicDialog onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    // Confirm button present and disabled initially (empty title).
    expect(html).toContain('新建');
    expect(html).toContain('disabled=""');
  });
});
