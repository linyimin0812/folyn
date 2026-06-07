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
