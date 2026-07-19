import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePetChatStore, MAX_SESSIONS } from '@/store/petChatStore';
import { isTauri } from '@/utils/platform';
import { stopPetChat, resetPetChatAdapter } from '@/services/petChatService';

/**
 * PetChatSessionHeader — the session-switcher bar above the pet chat body
 * (PR3, PRD "session UI"). Mirrors AiPanel's session-title dropdown idiom:
 * a button showing the active session's title + a ▾ chevron, which opens an
 * absolute dropdown listing all sessions (click to switch) plus a
 * "新建会话" entry and per-row rename / delete affordances.
 *
 * Differences from AiPanel's header (pet-panel constraints):
 *  - No native `confirm()` dialog (the panel is a click-through-adjacent
 *    secondary window; a modal dialog would steal focus awkwardly). Delete
 *    uses an inline second-confirm: the row morphs into
 *    "确认删除？[是][否]" until the user picks.
 *  - Rename is inline (an `<input>` replaces the row title); Enter commits,
 *    Escape cancels. AiPanel doesn't expose rename in its dropdown.
 *  - The cap (MAX_SESSIONS=50) is surfaced inline as a disabled "新建会话"
 *    row plus a "会话数已达上限（50）" hint, never an `alert()`.
 *  - Switching while streaming: PRD R操作语义 — "流式中切换 → 先 stop
 *    当前再切". The pet `streaming` flag is global (the active session is
 *    the one streaming), so on a switch click we `await stopPetChat(active)`
 *    + `setStreaming(false)` BEFORE `switchSession(target)`.
 *
 * Vault-free / isolation: reads only `petChatStore` + `petChatService`. Does
 * NOT import vault/editor/aiStore (pet-panel window isolation, PRD R6).
 *
 * Only rendered when `isPetChatConfigured()` is true (the unconfigured CTA
 * replaces the whole chat body — see PetChat.tsx).
 */
export function PetChatSessionHeader() {
  const { t } = useTranslation();
  const sessions = usePetChatStore((s) => s.sessions);
  const activeSessionId = usePetChatStore((s) => s.activeSessionId);
  const streaming = usePetChatStore((s) => s.streaming);
  const createSession = usePetChatStore((s) => s.createSession);
  const switchSession = usePetChatStore((s) => s.switchSession);
  const deleteSession = usePetChatStore((s) => s.deleteSession);
  const renameSession = usePetChatStore((s) => s.renameSession);
  const setStreaming = usePetChatStore((s) => s.setStreaming);

  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const atCap = sessions.length >= MAX_SESSIONS;

  // Close the dropdown on outside click. Mirrors AiPanel's pattern.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRenamingId(null);
        setConfirmingDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  // Auto-focus the rename input when it appears.
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Escape closes the dropdown (PetPanelApp also hides the whole panel on
  // Esc, but that handler is on document and calls pet_panel_hide; the
  // panel-hide is the desired outer behavior, so we don't stopPropagation —
  // Esc both closes the dropdown AND hides the panel, matching the user's
  // "get me out of here" intent).
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      setOpen(false);
      setRenamingId(null);
      setConfirmingDeleteId(null);
    }
  }, [open]);

  const handleNewSession = useCallback(() => {
    const id = createSession();
    if (!id) {
      // Cap reached — the persistent atCap hint below already communicates
      // this; nothing more to do. The button is also disabled when atCap,
      // so this branch is defensive only.
      return;
    }
    setOpen(false);
  }, [createSession]);

  const handleSwitch = useCallback(async (targetId: string) => {
    if (targetId === activeSessionId) {
      setOpen(false);
      return;
    }
    // PRD: 流式中切换 → 先 stop 当前再切. The pet `streaming` flag is
    // global (active session is the one streaming), so stop the active
    // session's adapter before switching.
    if (streaming && activeSessionId) {
      await stopPetChat(activeSessionId);
      setStreaming(false);
    }
    switchSession(targetId);
    setOpen(false);
  }, [activeSessionId, streaming, switchSession, setStreaming]);

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
    setConfirmingDeleteId(null);
  }, []);

  const handleCommitRename = useCallback(() => {
    if (renamingId) {
      renameSession(renamingId, renameValue);
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, renameSession]);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleStartDelete = useCallback((id: string) => {
    setConfirmingDeleteId(id);
    setRenamingId(null);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setConfirmingDeleteId(null);
  }, []);

  const handleConfirmDelete = useCallback(async (id: string) => {
    // PRD: 流式中删除 → 先 stop + 从 Map 移除 adapter. If the session
    // being deleted is the active streaming one, stop it first. (A
    // non-active session can't be streaming under the pet's global-flag
    // model, but we still reset its adapter to drop any cached process.)
    if (streaming && id === activeSessionId) {
      await stopPetChat(id);
      setStreaming(false);
    }
    // Drop the cached adapter for this session (no-op if none). Done AFTER
    // stop so the child process is terminated before the Map entry leaves.
    await resetPetChatAdapter(id);
    deleteSession(id);
    setConfirmingDeleteId(null);
    // If the deleted session was active, deleteSession has already switched
    // active to a remaining (or auto-created) one — no extra switch needed.
  }, [streaming, activeSessionId, setStreaming, deleteSession]);

  const title = activeSession?.title || t('pet:chat.sessionHeader.defaultTitle');

  // Jump to main window's Settings → AI 工具 tab. The pet-panel is a
  // separate Tauri window = separate JS realm, so it cannot touch the main
  // window's navStore directly. Emit `pet://menu-action` `open-ai-settings`
  // and let the main window's `routePetMenuAction` set the page/tab and focus
  // main. ponytail: duplicates PetChat's emitMenuAction — the existing
  // pattern is per-consumer (PetLauncher has its own copy too), so a shared
  // helper would be a bigger diff than the duplication itself.
  const handleOpenSettings = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://menu-action', { action: 'open-ai-settings' });
    } catch (err) {
      console.warn('[pet-chat-header] emit open-ai-settings failed:', err);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative shrink-0 flex items-center justify-between h-[30px] px-2 border-b border-brd"
      onKeyDown={handleContainerKeyDown}
    >
      <button
        type="button"
        className="flex items-center gap-1 bg-transparent border-none py-0.5 px-1.5 rounded cursor-pointer max-w-full min-w-0 hover:bg-hov"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t('pet:chat.sessionHeader.toggleAria')}
      >
        <span className="text-[12px] font-semibold text-acc truncate">{title}</span>
        <svg
          className="shrink-0 text-t3"
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <button
        type="button"
        className="py-[3px] px-2 border border-acc rounded-md bg-acc text-white text-[11px] cursor-pointer hover:opacity-[.85] transition-opacity"
        onClick={() => void handleOpenSettings()}
      >
        {t('pet:chat.sessionHeader.openAiSettings')}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-1 min-w-[220px] max-w-[300px] max-h-[320px] overflow-y-auto bg-panel border border-brd rounded-md shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[100] p-1 flex flex-col gap-0.5"
        >
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            const isRenaming = renamingId === s.id;
            const isConfirmingDelete = confirmingDeleteId === s.id;

            if (isConfirmingDelete) {
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 py-1.5 px-2 rounded text-[12px] text-t2"
                >
                  <span className="truncate min-w-0">{t('pet:chat.sessionHeader.confirmDelete')}</span>
                  <span className="shrink-0 flex gap-1">
                    <button
                      type="button"
                      className="py-0.5 px-2 rounded bg-red text-white text-[11px] cursor-pointer border-none"
                      onClick={() => void handleConfirmDelete(s.id)}
                    >
                      {t('pet:chat.sessionHeader.deleteYes')}
                    </button>
                    <button
                      type="button"
                      className="py-0.5 px-2 rounded bg-transparent border border-brd text-t2 text-[11px] cursor-pointer hover:bg-hov"
                      onClick={handleCancelDelete}
                    >
                      {t('pet:chat.sessionHeader.deleteNo')}
                    </button>
                  </span>
                </div>
              );
            }

            if (isRenaming) {
              return (
                <div key={s.id} className="py-1 px-1.5">
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="w-full py-1 px-1.5 text-[12px] bg-inp border border-acc rounded outline-none text-t1"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCommitRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCancelRename();
                      }
                    }}
                    onBlur={handleCommitRename}
                  />
                </div>
              );
            }

            return (
              <div
                key={s.id}
                className={`group flex items-center justify-between gap-2 w-full py-1.5 px-2 rounded cursor-pointer text-left text-[12px] ${isActive ? 'bg-accdim text-acc' : 'text-t2 hover:bg-hov'}`}
                onClick={() => void handleSwitch(s.id)}
              >
                <span className="truncate min-w-0 flex-1 flex items-center gap-1.5">
                  {isActive && streaming && (
                    <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-acc animate-pulse" />
                  )}
                  <span className="truncate">{s.title}</span>
                </span>
                <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="w-5 h-5 flex items-center justify-center rounded text-t3 hover:bg-hov hover:text-t1 cursor-pointer bg-transparent border-none"
                    title={t('pet:chat.sessionHeader.renameAria')}
                    aria-label={t('pet:chat.sessionHeader.renameAria')}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(s.id, s.title);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="w-5 h-5 flex items-center justify-center rounded text-t3 hover:bg-hov hover:text-red cursor-pointer bg-transparent border-none"
                    title={t('pet:chat.sessionHeader.deleteAria')}
                    aria-label={t('pet:chat.sessionHeader.deleteAria')}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartDelete(s.id);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </span>
              </div>
            );
          })}

          {/* New session entry + cap hint */}
          <div className="mt-1 pt-1 border-t border-brd2 flex flex-col gap-0.5">
            {atCap && (
              <div className="py-1 px-2 text-[11px] text-t3">
                {t('pet:chat.sessionHeader.capHint', { max: MAX_SESSIONS })}
              </div>
            )}
            <button
              type="button"
              className="flex items-center gap-1.5 py-1.5 px-2 rounded text-[12px] text-t2 bg-transparent border-none cursor-pointer hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleNewSession}
              disabled={atCap}
              title={t('pet:chat.sessionHeader.newSession')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('pet:chat.sessionHeader.newSession')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
