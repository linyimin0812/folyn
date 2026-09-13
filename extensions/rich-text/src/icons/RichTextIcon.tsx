/** Rich-text file icon — the host's `richtext.svg`, inlined as a data URL
 * by esbuild's `.svg: 'dataurl'` loader so the extension bundle is
 * self-contained (no app assets, no CDN). */
import richtextUrl from './richtext.svg';

const S = 16;

export function RichTextIcon(): React.JSX.Element {
  return (
    <img
      src={richtextUrl}
      width={S}
      height={S}
      alt=""
      style={{ display: 'block', flexShrink: 0, width: S, height: S }}
    />
  );
}
