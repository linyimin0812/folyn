/**
 * Search panel state + CM extensions shared by all three CodeMirror
 * editors (markdown / json / html source). The hook owns visibility +
 * replace-row state and exposes stable refs for the CM keymap to call
 * without re-creating the editor. `viewTick` is bumped by the parent's
 * update listener so EditorSearchBar can recompute match count.
 */
import { useRef, useState } from 'react';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { search } from '@codemirror/search';

interface SearchPanelState {
  visible: boolean;
  replaceOpen: boolean;
  viewTick: number;
  setVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  setReplaceOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setViewTick: (fn: (n: number) => number) => void;
  toggleRef: React.MutableRefObject<() => void>;
  toggleReplaceRef: React.MutableRefObject<() => void>;
}

export function useSearchPanelState(): SearchPanelState {
  const [visible, setVisible] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [viewTick, setViewTick] = useState(0);
  const toggleRef = useRef<() => void>(() => {});
  toggleRef.current = () => setVisible((v) => !v);
  const toggleReplaceRef = useRef<() => void>(() => {});
  toggleReplaceRef.current = () => {
    setVisible(true);
    setReplaceOpen((v) => !v);
  };
  return {
    visible,
    replaceOpen,
    viewTick,
    setVisible,
    setReplaceOpen,
    setViewTick,
    toggleRef,
    toggleReplaceRef,
  };
}

/**
 * CM extensions to install in each editor: enables search state +
 * overrides Cmd+F / Cmd+Alt+F to toggle the React panel (highest
 * precedence so we win over `searchKeymap`'s built-in Cmd+F →
 * `openSearchPanel`). The rest of `searchKeymap` (Cmd+G etc.) is kept by
 * the caller alongside its own `keymap.of([...])`.
 */
export function buildSearchExtensions(
  toggleRef: SearchPanelState['toggleRef'],
  toggleReplaceRef: SearchPanelState['toggleReplaceRef'],
) {
  return [
    search(),
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-f',
          run: () => {
            toggleRef.current();
            return true;
          },
        },
        {
          key: 'Mod-Alt-f',
          run: () => {
            toggleReplaceRef.current();
            return true;
          },
        },
      ]),
    ),
  ];
}
