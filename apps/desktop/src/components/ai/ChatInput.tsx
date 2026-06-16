import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useAiStore } from '@/store/aiStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { flattenFileTree } from '@/utils/treeUtils';
import { FileIcon } from '@/components/icons/FileIcon';

export interface PendingAttachment {
  id: string;
  name: string;
  type: 'image' | 'file';
  path?: string;
  blob?: Blob;
  previewUrl?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments: PendingAttachment[]) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function ChatInput({ onSend, onStop, isStreaming }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mentionMenu, setMentionMenu] = useState<{ visible: boolean; filter: string; anchorPos: number }>({ visible: false, filter: '', anchorPos: 0 });
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendingFileAttachments = useAiStore((s) => s.pendingFileAttachments);
  const consumePendingFiles = useAiStore((s) => s.consumePendingFiles);

  useEffect(() => {
    if (pendingFileAttachments.length === 0) return;
    const files = consumePendingFiles();
    setAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.path));
      const newOnes = files
        .filter((f) => !existing.has(f.path))
        .map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          type: 'file' as const,
          path: f.path,
        }));
      return [...prev, ...newOnes];
    });
  }, [pendingFileAttachments, consumePendingFiles]);

  const fileTree = useVaultStore((s) => s.fileTree);
  const allFiles = useMemo(() => flattenFileTree(fileTree), [fileTree]);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.path ?? null;
  });
  const filteredMentionFiles = useMemo(() => {
    if (!mentionMenu.visible) return [];
    const q = mentionMenu.filter.toLowerCase();
    const matched = q
      ? allFiles.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      : allFiles;
    if (!activeFilePath) return matched.slice(0, 20);
    const activeIdx = matched.findIndex((f) => f.path === activeFilePath);
    if (activeIdx <= 0) return matched.slice(0, 20);
    return [matched[activeIdx], ...matched.slice(0, activeIdx), ...matched.slice(activeIdx + 1)].slice(0, 20);
  }, [mentionMenu.visible, mentionMenu.filter, allFiles, activeFilePath]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]))) {
      const filter = textBeforeCursor.slice(atIdx + 1);
      if (!filter.includes(' ') && !filter.includes('\n')) {
        setMentionMenu({ visible: true, filter, anchorPos: atIdx });
        setMentionIndex(0);
        return;
      }
    }
    setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
  }, []);

  const insertMention = useCallback((filePath: string) => {
    const { anchorPos } = mentionMenu;
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? input.length;
    const before = input.slice(0, anchorPos);
    const after = input.slice(cursorPos);
    const newValue = `${before}${after}`;
    setInput(newValue);
    setMentionMenu({ visible: false, filter: '', anchorPos: 0 });

    const fileName = filePath.split('/').pop() || filePath;
    setAttachments((prev) => {
      if (prev.some((a) => a.path === filePath)) return prev;
      return [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: fileName,
        type: 'file' as const,
        path: filePath,
      }];
    });

    setTimeout(() => {
      if (textarea) {
        textarea.selectionStart = textarea.selectionEnd = anchorPos;
        textarea.focus();
      }
    }, 0);
  }, [mentionMenu, input]);

  const handleSendClick = useCallback(() => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;
    const userText = input.trim();
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    onSend(userText, currentAttachments);
  }, [input, attachments, isStreaming, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mentionMenu.visible && filteredMentionFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMentionFiles.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMentionFiles.length) % filteredMentionFiles.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentionFiles[mentionIndex].path);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  }, [mentionMenu.visible, filteredMentionFiles, mentionIndex, insertMention, handleSendClick]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const ext = file.type.split('/')[1] || 'png';
        const previewUrl = URL.createObjectURL(file);
        setAttachments((prev) => [...prev, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: `paste-${Date.now()}.${ext}`,
          type: 'image',
          blob: file,
          previewUrl,
        }]);
        return;
      }
    }
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith('image/');
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      setAttachments((prev) => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type: isImage ? 'image' : 'file',
        blob: file,
        previewUrl,
      }]);
    }
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  return (
    <div className="flex flex-col py-2.5 px-3 border-t border-brd shrink-0">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-1 py-0.5 px-1.5 bg-surf border border-brd rounded-md text-[11px] text-t2 max-w-[160px]">
              {att.previewUrl ? (
                <img className="w-7 h-7 object-cover rounded shrink-0" src={att.previewUrl} alt={att.name} />
              ) : (
                <span className="inline-flex items-center shrink-0"><FileIcon filename={att.name} /></span>
              )}
              <span className="truncate min-w-0 flex-1">{att.name}</span>
              <button className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-[10px] text-t3 cursor-pointer shrink-0 transition-all duration-100 bg-transparent border-none hover:bg-hov hover:text-red" onClick={() => removeAttachment(att.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col border border-brd rounded-lg bg-inp transition-[border-color] duration-[140ms] focus-within:border-acc" style={{ position: 'relative' }}>
        {mentionMenu.visible && filteredMentionFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 max-h-[200px] overflow-y-auto bg-panel border border-brd rounded-lg mb-1 shadow-[0_-4px_12px_rgba(0,0,0,.08)] z-[100]">
            {filteredMentionFiles.map((file, i) => (
              <div
                key={file.path}
                className={`py-1.5 px-3 text-[12px] cursor-pointer flex items-center gap-1.5 ${i === mentionIndex ? 'bg-hov' : ''} hover:bg-hov`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(file.path); }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileIcon filename={file.name} /> {file.name}</span>
                <span className="text-t3 text-[11px] ml-auto overflow-hidden text-ellipsis whitespace-nowrap max-w-[60%] text-right">{file.path}</span>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="flex-1 resize-none border-none rounded-t-lg pt-2 px-2.5 pb-1 text-[12px] font-ui bg-transparent text-t1 outline-none placeholder:text-t3"
          placeholder="输入指令，@ 引用文件..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={2}
          disabled={isStreaming}
          autoCapitalize="off"
        />
        <div className="flex items-center gap-0.5 py-0.5 px-1.5 pb-1.5">
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed" onClick={handleFileSelect} disabled={isStreaming} title="附加文件">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <div className="flex-1" />
          {isStreaming ? (
            <button className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-all duration-[120ms] bg-red text-white hover:opacity-[.85]" onClick={onStop} title="停止">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-all duration-[120ms] bg-acc text-white hover:opacity-[.85] disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleSendClick}
              disabled={!input.trim() && attachments.length === 0}
              title="发送"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.txt,.md,.json,.csv,.pdf,.html,.htm,.xml,.yaml,.yml,.toml,.log"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}
