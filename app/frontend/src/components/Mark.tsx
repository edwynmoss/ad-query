/**
 * The AD Query mark: a small directory tree with the second child in brand
 * blue. Same geometry as scripts/installer-art.py (100-unit box), so the app,
 * the icon and the installer all draw the same thing.
 */
export function Mark({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className={className}>
      <g fill="currentColor">
        <rect x="14" y="12" width="38" height="26" rx="7" />
        <rect x="23" y="38" width="7" height="49" />
        <rect x="23" y="50" width="23" height="7" />
        <rect x="50" y="40" width="40" height="26" rx="7" />
        <rect x="23" y="80" width="23" height="7" />
      </g>
      <rect x="50" y="70" width="40" height="26" rx="7" className="fill-brand" />
    </svg>
  );
}
