import { useState, useEffect, useCallback, useRef } from 'react';

interface AttrPanelProps {
  quillId: string;
  tagName: string;
  onClose: () => void;
  callBridge: (fn: string, ...args: unknown[]) => unknown;
}

interface AttrEntry {
  name: string;
  value: string;
}

export function AttrPanel({ quillId, tagName, onClose, callBridge }: AttrPanelProps) {
  const [attrs, setAttrs] = useState<AttrEntry[]>([]);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch attributes from bridge
  const fetchAttrs = useCallback(() => {
    const result = callBridge('getAttrs', quillId) as Record<string, string> | null | undefined;
    if (!result) return;
    const entries = Object.entries(result).map(([name, value]) => ({ name, value }));
    setAttrs(entries);
  }, [quillId, callBridge]);

  useEffect(() => {
    fetchAttrs();
  }, [fetchAttrs]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleValueChange = useCallback(
    (name: string, val: string) => {
      setAttrs((prev) => prev.map((a) => (a.name === name ? { ...a, value: val } : a)));
      callBridge('setAttr', quillId, name, val);
    },
    [quillId, callBridge],
  );

  const handleRemoveAttr = useCallback(
    (name: string) => {
      setAttrs((prev) => prev.filter((a) => a.name !== name));
      callBridge('removeAttr', quillId, name);
    },
    [quillId, callBridge],
  );

  const handleAddAttr = useCallback(() => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    callBridge('setAttr', quillId, trimmedName, newValue);
    setAttrs((prev) => [...prev, { name: trimmedName, value: newValue }]);
    setNewName('');
    setNewValue('');
    setShowAdd(false);
  }, [quillId, newName, newValue, callBridge]);

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddAttr();
      }
      if (e.key === 'Escape') {
        setShowAdd(false);
      }
    },
    [handleAddAttr],
  );

  return (
    <div
      ref={panelRef}
      className="fixed right-0 top-0 bottom-0 w-72 bg-panel border-l border-brd z-50 shadow-xl flex flex-col"
      data-quill-panel
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-brd shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
          </svg>
          <span className="text-xs font-semibold text-t1">Attributes</span>
          <span className="text-[10px] font-mono text-t3 bg-surf px-1.5 py-0.5 rounded">&lt;{tagName}&gt;</span>
        </div>
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-hov text-t3 hover:text-t1 transition-colors"
          onClick={onClose}
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Attribute list */}
      <div className="overflow-y-auto flex-1 p-3 space-y-2">
        {attrs.length === 0 && !showAdd && (
          <div className="text-[11px] text-t3 text-center py-6">No attributes</div>
        )}
        {attrs.map((attr) => (
          <div key={attr.name} className="flex items-center gap-2 text-xs group">
            <span className="text-t3 font-mono shrink-0 w-20 truncate" title={attr.name}>
              {attr.name}
            </span>
            <input
              className="bg-surf border border-brd rounded px-2 py-1 text-t1 flex-1 min-w-0 text-[11px] focus:outline-none focus:border-acc transition-colors"
              value={attr.value}
              onChange={(e) => handleValueChange(attr.name, e.target.value)}
            />
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-t3 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
              onClick={() => handleRemoveAttr(attr.name)}
              title="Remove attribute"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add new attribute */}
        {showAdd && (
          <div className="flex items-center gap-2 text-xs mt-2 p-2 bg-surf rounded border border-brd">
            <input
              className="bg-panel border border-brd rounded px-2 py-1 text-t1 w-20 text-[11px] focus:outline-none focus:border-acc transition-colors"
              placeholder="name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleAddKeyDown}
              autoFocus
            />
            <input
              className="bg-panel border border-brd rounded px-2 py-1 text-t1 flex-1 min-w-0 text-[11px] focus:outline-none focus:border-acc transition-colors"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleAddKeyDown}
            />
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-acc hover:bg-accdim transition-colors shrink-0"
              onClick={handleAddAttr}
              title="Add attribute"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-brd p-3">
        {!showAdd && (
          <button
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium text-acc hover:bg-accdim transition-colors"
            onClick={() => setShowAdd(true)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add Attribute
          </button>
        )}
      </div>
    </div>
  );
}
