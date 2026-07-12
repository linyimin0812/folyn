import type { PreviewProps } from '../types';

export function HtmlPreview({ content }: PreviewProps) {
  return (
    <iframe
      className="html-preview-frame w-full h-full border-none bg-white"
      sandbox="allow-scripts allow-same-origin"
      srcDoc={content}
      title="HTML Preview"
      onLoad={(e) => {
        const iframe = e.currentTarget;
        const doc = iframe.contentDocument;
        if (!doc) return;
        // ponytail: iframe inherits color-scheme from parent (Quill app dark theme),
        // so the canvas defaults to dark and transparent-bg SVG areas render dark.
        // Force light canvas to match browser behavior when opening the .html file.
        const style = doc.createElement('style');
        style.textContent = 'html,body{color-scheme:light !important;background:#fff !important}';
        doc.head.appendChild(style);
        doc.addEventListener('click', (ev) => {
          const anchor = (ev.target as HTMLElement).closest('a');
          if (!anchor) return;
          const href = anchor.getAttribute('href');
          if (!href) return;
          ev.preventDefault();
          if (href.startsWith('#')) {
            const target = doc.querySelector(href) || doc.querySelector(`[name="${href.slice(1)}"]`);
            target?.scrollIntoView({ behavior: 'smooth' });
          }
        });
      }}
    />
  );
}
