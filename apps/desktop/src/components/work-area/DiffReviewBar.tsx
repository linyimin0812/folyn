import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import type { FolynEditorHandle } from '@/editor/EditorView';
import { DiffToolbar } from '../editor/DiffToolbar';
import {
  computeDiffHunks,
  setDiffHunks,
  acceptAllHunks,
  rejectAllHunks,
  setOnHunksChange,
} from '@/editor/extensions/InlineDiffExtension';
import type { FileTab } from '@/store/editorStore';

interface DiffReviewBarProps {
  editorRef: React.RefObject<FolynEditorHandle | null>;
  activeTab: FileTab | undefined;
}

export function DiffReviewBar({ editorRef, activeTab }: DiffReviewBarProps) {
  const diffReviewMode = useDiffReviewStore((s) => s.diffReviewMode);
  const diffFilePath = useDiffReviewStore((s) => s.diffFilePath);
  const diffOldContent = useDiffReviewStore((s) => s.diffOldContent);
  const diffNewContent = useDiffReviewStore((s) => s.diffNewContent);
  const exitDiffReview = useDiffReviewStore((s) => s.exitDiffReview);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);

  const [hunkCount, setHunkCount] = useState(0);
  const isDiffTab = diffReviewMode && activeTab?.path === diffFilePath;

  // Enter diff review mode: compute diff hunks and show merged content in editor
  useEffect(() => {
    if (!isDiffTab || diffOldContent == null || diffNewContent == null) return;

    function applyDiff() {
      const view = editorRef.current?.getView();
      if (!view) return false;

      const { hunks, mergedContent } = computeDiffHunks(diffOldContent!, diffNewContent!);
      setHunkCount(hunks.length);

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: mergedContent },
        effects: setDiffHunks.of(hunks),
      });
      return true;
    }

    if (!applyDiff()) {
      const timer = setTimeout(applyDiff, 50);
      return () => clearTimeout(timer);
    }
  }, [isDiffTab, diffOldContent, diffNewContent, editorRef]);

  // React to hunk count changes via CodeMirror updateListener
  useEffect(() => {
    if (!isDiffTab) {
      setHunkCount(0);
      setOnHunksChange(null);
      return;
    }
    setOnHunksChange((count) => {
      setHunkCount(count);
      if (count === 0) {
        const currentView = editorRef.current?.getView();
        if (currentView && activeTab) {
          updateTabContent(activeTab.id, currentView.state.doc.toString());
        }
        exitDiffReview();
      }
    });
    return () => setOnHunksChange(null);
  }, [isDiffTab, activeTab, updateTabContent, exitDiffReview, editorRef]);

  const handleAcceptAll = useCallback(() => {
    const view = editorRef.current?.getView();
    if (!view || diffNewContent == null || !activeTab) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: diffNewContent },
      effects: acceptAllHunks.of(undefined),
    });

    updateTabContent(activeTab.id, diffNewContent);
    exitDiffReview();
  }, [diffNewContent, activeTab, updateTabContent, exitDiffReview, editorRef]);

  const handleRejectAll = useCallback(() => {
    const view = editorRef.current?.getView();
    if (!view || diffOldContent == null || !activeTab) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: diffOldContent },
      effects: rejectAllHunks.of(undefined),
    });

    updateTabContent(activeTab.id, diffOldContent);
    exitDiffReview();
  }, [diffOldContent, activeTab, updateTabContent, exitDiffReview, editorRef]);

  if (!isDiffTab) return null;

  return (
    <DiffToolbar
      hunkCount={hunkCount}
      onAcceptAll={handleAcceptAll}
      onRejectAll={handleRejectAll}
    />
  );
}
