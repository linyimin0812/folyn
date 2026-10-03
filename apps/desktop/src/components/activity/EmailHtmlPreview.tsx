/**
 * Click-to-open body preview for the activity timeline's `format: 'html'`
 * detail fields (email bodyHtml): collector-supplied HTML is DOMPurify-
 * sanitized (same forbid list as the pet bubble) before it touches the DOM;
 * content that doesn't look like HTML (plain-text mail) renders escaped with
 * preserved whitespace. Links open through the app's external-open path —
 * never an in-webview navigation.
 */
import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';

const LOOKS_HTML_RE = /<[a-zA-Z!/]/;

export function looksLikeHtml(s: string): boolean {
  return LOOKS_HTML_RE.test(s);
}

function forceAnchorTarget(node: Element): void {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
}

export function sanitizeBodyHtml(html: string): string {
  DOMPurify.addHook('afterSanitizeAttributes', forceAnchorTarget);
  try {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
      FORBID_ATTR: ['on*'],
      // ponytail: ALLOW_DATA_ATTR off — email bodies have no legit data-* use.
      ALLOW_DATA_ATTR: false,
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', forceAnchorTarget);
  }
}

interface EmailHtmlPreviewProps {
  title: string;
  content: string;
  onClose: () => void;
}

export function EmailHtmlPreview({ title, content, onClose }: EmailHtmlPreviewProps) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isHtml = looksLikeHtml(content);
  const html = useMemo(() => (isHtml ? sanitizeBodyHtml(content) : ''), [isHtml, content]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-lg max-w-3xl w-full max-h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-brd shrink-0">
          <h3 className="m-0 text-[14px] font-semibold text-t1 truncate">{title}</h3>
          <button
            className="bg-transparent border-0 p-1 m-0 cursor-pointer text-t3 hover:text-t1"
            onClick={onClose}
            aria-label={t('activity:timeline.closePreview')}
          >
            <X size={16} />
          </button>
        </div>
        <div
          className="overflow-y-auto p-4 text-[13px] leading-relaxed text-t1"
          // Fallback for when the document-level interceptor isn't installed —
          // same link policy as the rest of the app (in-app web tab vs. system
          // opener). Capture phase: injected markup can't swallow the event.
          onClickCapture={(e) => {
            const a = (e.target as Element).closest?.('a');
            if (!a) return;
            const href = a.getAttribute('href') ?? '';
            e.preventDefault();
            if (/^(https?|mailto:|tel:|ftp:)/i.test(href)) {
              // Dynamic: keeps the store chain (open-color.json) out of this
              // module's static import graph — node-env unit tests of the
              // pure helpers don't drag the stores in.
              void import('@/services/externalLinks').then((m) =>
                m.openLinkByMode(href, a.textContent || href),
              );
            }
          }}
        >
          {isHtml ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words" style={{ font: 'inherit' }}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
