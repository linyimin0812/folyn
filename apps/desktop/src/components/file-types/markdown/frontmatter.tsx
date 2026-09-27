/** Parse YAML frontmatter from markdown content */
export interface FrontmatterMeta {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

export function parseFrontmatter(content: string): { meta: FrontmatterMeta | null; body: string; frontmatterLineCount: number } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return { meta: null, body: content, frontmatterLineCount: 0 };

  const yamlBlock = match[1];
  const meta: FrontmatterMeta = {};
  let currentKey = '';
  let currentValue = '';

  for (const line of yamlBlock.split('\n')) {
    const keyValueMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (keyValueMatch) {
      if (currentKey) {
        meta[currentKey] = currentValue.trim();
      }
      currentKey = keyValueMatch[1];
      currentValue = keyValueMatch[2];
    } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
      currentValue += ' ' + line.trim();
    }
  }
  if (currentKey) {
    meta[currentKey] = currentValue.trim();
  }

  // ponytail: count newlines in the frontmatter match (incl. closing --- line) so
  // rehypeSourceLine can offset anchor source lines to match editor content lines.
  const frontmatterLineCount = (match[0].match(/\n/g) ?? []).length;

  return { meta: Object.keys(meta).length > 0 ? meta : null, body: content.slice(match[0].length), frontmatterLineCount };
}

// ponytail: skill = the two required skill-file frontmatter keys; only that
// case gets the SKILL badge. Plain frontmatter still renders the meta card.
const isSkillMeta = (meta: FrontmatterMeta) => Boolean(meta.name && meta.description);

/** Render frontmatter meta as a styled card (SKILL badge only for skill files) */
export function SkillMetaCard({ meta }: { meta: FrontmatterMeta }) {
  return (
    <div className="skill-meta-card">
      <div className="skill-meta-header">
        {isSkillMeta(meta) && <span className="skill-meta-badge">SKILL</span>}
        {meta.name && <span className="skill-meta-name">{meta.name}</span>}
      </div>
      {meta.description && (
        <p className="skill-meta-description">{meta.description}</p>
      )}
      {Object.entries(meta)
        .filter(([key]) => key !== 'name' && key !== 'description')
        .map(([key, value]) => (
          <div className="skill-meta-field" key={key}>
            <span className="skill-meta-key">{key}</span>
            <span className="skill-meta-value">{value}</span>
          </div>
        ))}
    </div>
  );
}
