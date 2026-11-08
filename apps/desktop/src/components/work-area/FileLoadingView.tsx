/** Skeleton line widths (%); 0 is a paragraph gap. */
const LINES = [92, 84, 96, 70, 0, 88, 94, 62];

/**
 * Shown over the work area while a file is being read: an indeterminate bar
 * along the top and a document skeleton, the same look as extension file views.
 */
export function FileLoadingView({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="ed-loading" role="progressbar" aria-label={label}>
      <div className="ed-loadbar" />
      <div className="ed-doc-skeleton" aria-hidden="true">
        <span className="ed-skel ed-skel-title" />
        {LINES.map((width, i) =>
          width ? <span key={i} className="ed-skel" style={{ width: `${width}%` }} /> : <span key={i} className="h-2" />,
        )}
      </div>
    </div>
  );
}
