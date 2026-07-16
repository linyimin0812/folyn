import type { PreviewProps } from '../types';
import { injectPreviewBootstrap } from './injectPreviewBootstrap';

export function HtmlPreview({ content }: PreviewProps) {
  return (
    <iframe
      className="html-preview-frame w-full h-full border-none bg-white"
      sandbox="allow-scripts"
      srcDoc={injectPreviewBootstrap(content)}
      title="HTML Preview"
    />
  );
}
