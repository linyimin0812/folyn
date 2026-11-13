/**
 * EditorPane lays the active file type's `editorAccessory` over the editor,
 * and nothing for a type that declares none.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { EditorAccessoryProps, FileTypeHandler } from '@folyn/extension-host';
import type { FileTab } from '@/store/editorStore';

// The CodeMirror editor is not under test.
vi.mock('@/editor/EditorView', () => ({ FolynEditor: () => null }));

const handlers: Record<string, Partial<FileTypeHandler>> = {};
vi.mock('../file-types/registry', () => ({
  getHandlerById: (id: string) => handlers[id],
}));

import { EditorPane } from './EditorPane';

function Accessory({ content, filePath }: EditorAccessoryProps) {
  return <span>accessory {filePath} {content.length}</span>;
}

function pane(tab: Partial<FileTab>) {
  return (
    <EditorPane
      activeTab={{ id: 't', name: 'a', path: 'a', content: '', fileType: 'code', ...tab } as FileTab}
      onContentChange={() => {}}
      onSave={() => {}}
      externalContentVersion={0}
      showLineNumbers={false}
      tabSize={2}
      wrapColumn={0}
      editorFont=""
      editorFontSize={14}
    />
  );
}

afterEach(() => {
  cleanup();
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('EditorPane editor accessory', () => {
  it('mounts the file type\'s accessory with the tab\'s path and current text', () => {
    handlers.erd = { id: 'erd', editorAccessory: Accessory };
    render(pane({ fileType: 'erd', path: 'db/schema.erd', content: 'Table t {}' }));

    expect(screen.queryByText('accessory db/schema.erd 10')).not.toBeNull();
  });

  it('mounts nothing for a type without one, or an unknown type', () => {
    handlers.code = { id: 'code' };
    render(pane({ fileType: 'code' }));
    expect(screen.queryByText(/^accessory/)).toBeNull();
    cleanup();

    render(pane({ fileType: 'gone' }));
    expect(screen.queryByText(/^accessory/)).toBeNull();
  });
});
