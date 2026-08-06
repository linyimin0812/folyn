import { type ReactNode } from 'react';
import { useTerminalStore, type TerminalSessionInfo } from '@/store/terminalStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTranslation } from 'react-i18next';
import { TerminalView } from './TerminalView';
import { Plus, X, PanelRight, PanelBottom } from 'lucide-react';
import { TerminalIcon } from '@/components/icons/TerminalIcon';

const DEFAULT_HEIGHT = 240;

const HEADER_ROW_BASE_CLASSES =
  'flex gap-1 shrink-0 px-2 bg-panel border-b border-brd overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const HEADER_ROW_CLASSES = `${HEADER_ROW_BASE_CLASSES} items-start h-[28px]`;
const HEADER_ROW_RIGHT_CLASSES = `${HEADER_ROW_BASE_CLASSES} items-center h-[34px]`;
const TAB_SCROLL_BASE_CLASSES =
  'self-stretch flex-1 min-w-0 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB_SCROLL_CLASSES = `${TAB_SCROLL_BASE_CLASSES} items-start`;
const TAB_SCROLL_RIGHT_CLASSES = `${TAB_SCROLL_BASE_CLASSES} items-center`;
const SESSION_TAB_CLASSES =
  'group flex h-[24px] shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[13px] leading-none font-mono cursor-pointer whitespace-nowrap select-none transition-[background-color,color] duration-100';
const ACTION_BUTTON_CLASSES =
  'flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent text-t3 cursor-pointer transition-[background-color,color,transform] duration-100 hover:bg-hov hover:text-t1 active:scale-[0.96]';
const TAB_INNER_BUTTON_CLASSES =
  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent text-t3 cursor-pointer transition-[background-color,color] duration-100 hover:bg-hov hover:text-t1';
const TAB_CLOSE_BUTTON_CLASSES =
  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent text-[11px] text-t3 cursor-pointer opacity-0 transition-[opacity,background-color,color] duration-100 group-hover:opacity-100 hover:bg-hov hover:text-red';

function TerminalActionButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={ACTION_BUTTON_CLASSES}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TerminalSessionTab({
  session,
  active,
  onSelect,
  onRestart,
  onClose,
}: {
  session: TerminalSessionInfo;
  active: boolean;
  onSelect: () => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`${SESSION_TAB_CLASSES} ${
        active ? 'bg-surf2 text-t1' : 'text-t3 hover:bg-hov hover:text-t2'
      }`}
      onClick={onSelect}
    >
      <TerminalIcon
        size={14}
        className={`shrink-0 block ${active ? '' : 'opacity-50'}`}
      />
      <span
        className={`max-w-[120px] truncate leading-none ${session.status === 'exited' ? 'opacity-50' : ''}`}
      >
        {session.title}
      </span>
      {session.status === 'exited' && (
        <button
          type="button"
          className={TAB_INNER_BUTTON_CLASSES}
          title={t('terminal:restart')}
          aria-label={t('terminal:restart')}
          onClick={(e) => {
            e.stopPropagation();
            onRestart();
          }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
            <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className={TAB_CLOSE_BUTTON_CLASSES}
        title={t('terminal:close')}
        aria-label={t('terminal:close')}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>
    </div>
  );
}

function TerminalTabRow() {
  const { t } = useTranslation();
  const terminalInRightDock = useEditorViewStateStore((s) => s.terminalInRightDock);
  const openTerminalDock = useEditorViewStateStore((s) => s.openTerminalDock);
  const showTerminalInRightDock = useEditorViewStateStore((s) => s.showTerminalInRightDock);
  const closeTerminalPanel = useEditorViewStateStore((s) => s.closeTerminalPanel);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeSession = useTerminalStore((s) => s.closeSession);

  return (
    <div className={terminalInRightDock ? HEADER_ROW_RIGHT_CLASSES : HEADER_ROW_CLASSES}>
      <div className={terminalInRightDock ? TAB_SCROLL_RIGHT_CLASSES : TAB_SCROLL_CLASSES}>
        {sessions.map((session) => (
          <TerminalSessionTab
            key={session.id}
            session={session}
            active={session.id === activeId}
            onSelect={() => setActive(session.id)}
            onRestart={() => {
              closeSession(session.id);
              setActive(addSession());
            }}
            onClose={() => closeSession(session.id)}
          />
        ))}
        <TerminalActionButton title={t('terminal:new')} onClick={() => addSession()}>
          <Plus size={15} />
        </TerminalActionButton>
      </div>
      <div className={`flex shrink-0 gap-1 ${terminalInRightDock ? 'items-center' : 'items-start'}`}>
        <TerminalActionButton
          title={
            terminalInRightDock
              ? t('terminal:openAtBottom')
              : t('terminal:showInRightDock')
          }
          onClick={() => (terminalInRightDock ? openTerminalDock() : showTerminalInRightDock())}
        >
          {terminalInRightDock ? <PanelBottom size={16} /> : <PanelRight size={16} />}
        </TerminalActionButton>
        <TerminalActionButton title={t('terminal:closePanel')} onClick={closeTerminalPanel}>
          <X size={16} />
        </TerminalActionButton>
      </div>
    </div>
  );
}

/**
 * Terminal panel: session-tab header + xterm body, docked at the BOTTOM or as
 * a right-side column. The columns button switches between the two locations;
 * the bottom height is lifted to BottomTerminal so the resize handle and the
 * panel share one source of truth.
 */
export function TerminalPanel({
  height = DEFAULT_HEIGHT,
}: {
  height?: number | string;
}) {
  const { t } = useTranslation();
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);

  return (
    <div
      className="shrink-0 flex flex-col overflow-hidden bg-bg"
      style={{ height }}
    >
      <TerminalTabRow />

      <div className="flex-1 min-h-0 relative">
        {sessions.map((s) => (
          <TerminalView key={s.id} id={s.id} active={s.id === activeId} />
        ))}
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg">
            <div className="w-[44px] h-[44px] rounded-[10px] bg-hov border border-brd flex items-center justify-center">
              <TerminalIcon size={18} className="opacity-70" />
            </div>
            <span className="text-xs text-t3">{t('terminal:empty')}</span>
            <button
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-acc text-white text-xs border-none cursor-pointer transition-opacity hover:opacity-90 font-medium"
              onClick={addSession}
            >
              <Plus size={12} />
              {t('terminal:new')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
