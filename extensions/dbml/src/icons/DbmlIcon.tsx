/** DBML file icon — the app's `sql.svg` (DBML is SQL-flavoured), inlined as
 * a data URL by esbuild's `.svg: 'dataurl'` loader so the host bundle is
 * self-contained (no app assets, no CDN). */
import sqlUrl from './sql.svg';

const S = 16;

export function DbmlIcon(): React.JSX.Element {
  return (
    <img
      src={sqlUrl}
      width={S}
      height={S}
      alt=""
      style={{ display: 'block', flexShrink: 0, width: S, height: S }}
    />
  );
}
