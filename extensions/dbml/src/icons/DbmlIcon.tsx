/** DBML file icon — two tables joined by a relationship line (ER diagram). */
export function DbmlIcon(): React.JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="2" width="5" height="4.5" rx="0.8" fill="#4a6fa5" />
      <rect x="9.5" y="9.5" width="5" height="4.5" rx="0.8" fill="#4a6fa5" />
      <path d="M6.5 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v3.5" stroke="#4a6fa5" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <circle cx="6.5" cy="4.5" r="1.4" fill="#fff" />
    </svg>
  );
}
