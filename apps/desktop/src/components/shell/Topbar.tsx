import { useEditorStore, type ViewMode } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/hooks/useTheme';
import { ExportMenu } from '@/components/editor/ExportMenu';

/** File types that only support preview mode (no editor) */
const PREVIEW_ONLY_FILE_TYPES = new Set(['image', 'pdf']);

/** File types where view mode switching is not applicable */
const HIDE_VIEW_MODE_FILE_TYPES = new Set(['image', 'pdf', 'code', 'web']);

const VIEW_MODE_ICONS: Record<ViewMode, React.ReactNode> = {
  split: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="8" y1="2.5" x2="8" y2="13.5" />
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
      <line x1="9" y1="4" x2="12" y2="7" />
    </svg>
  ),
  preview: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
};

const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: 'split', label: '分屏' },
  { key: 'edit', label: '编辑' },
  { key: 'preview', label: '预览' },
];

interface TopbarProps {
  isMobile?: boolean;
  onToggleSidebar?: () => void;
}

export function Topbar({ isMobile, onToggleSidebar }: TopbarProps) {
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const toggleAiPanel = useEditorStore((state) => state.toggleAiPanel);
  const activeTab = useEditorStore((state) => {
    const tabs = state.tabs;
    return tabs.find((t) => t.id === state.activeTabId);
  });
  const isPreviewOnly = activeTab ? PREVIEW_ONLY_FILE_TYPES.has(activeTab.fileType) : false;
  const hideViewMode = activeTab ? HIDE_VIEW_MODE_FILE_TYPES.has(activeTab.fileType) : false;
  const setCurrentPage = useSettingsStore((state) => state.setCurrentPage);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      {/* Left: Logo + mobile menu */}
      <div className="tb-left">
        {isMobile && (
          <button className="tb-btn mobile-menu-btn" onClick={onToggleSidebar} title="菜单">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" />
              <line x1="2" y1="12" x2="14" y2="12" />
            </svg>
          </button>
        )}
        <div className="logo" onClick={() => setCurrentPage('editor')}>
          <img src={`${import.meta.env.BASE_URL}quill.svg`} alt="Quill" width="24" height="24" style={{ borderRadius: 5 }} />
          <span className="logo-name">
            Qu<em>ill</em>
          </span>
        </div>
      </div>

      {/* Right: View mode + Action buttons */}
      <div className="tb-right">
        {/* View mode segment — hidden for non-markdown file types */}
        {!hideViewMode && (
        <div className="view-seg">
          {VIEW_MODES.map((mode) => {
            const disabled = isPreviewOnly && mode.key !== 'preview';
            return (
              <button
                key={mode.key}
                className={`vseg ${isPreviewOnly ? (mode.key === 'preview' ? 'on' : '') : viewMode === mode.key ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && setViewMode(mode.key)}
                title={disabled ? `${mode.label}（不可用）` : mode.label}
                disabled={disabled}
              >
                {VIEW_MODE_ICONS[mode.key]}
              </button>
            );
          })}
        </div>
        )}

        <div className="top-div" />

        <button className="tb-btn tb-ai-btn" onClick={toggleAiPanel} title="AI 面板">
          AI
        </button>
        <ExportMenu />
        <button className="tb-btn" onClick={toggleTheme} title="切换主题">
          {theme === 'light' ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="3" />
              <line x1="8" y1="1" x2="8" y2="5" /><line x1="8" y1="11" x2="8" y2="15" />
              <line x1="1" y1="8" x2="5" y2="8" /><line x1="11" y1="8" x2="15" y2="8" />
              <line x1="3.05" y1="3.05" x2="5.88" y2="5.88" /><line x1="10.12" y1="10.12" x2="12.95" y2="12.95" />
              <line x1="3.05" y1="12.95" x2="5.88" y2="10.12" /><line x1="10.12" y1="5.88" x2="12.95" y2="3.05" />
            </svg>
          )}
        </button>

      </div>
    </header>
  );
}
