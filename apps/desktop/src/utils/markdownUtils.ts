export interface HeadingItem {
  level: number;
  text: string;
  line: number;
}

export function extractHeadings(content: string): HeadingItem[] {
  const lines = content.split('\n');
  const headings: HeadingItem[] = [];
  let inCodeBlock = false;
  lines.forEach((line, index) => {
    // Toggle fenced code block state (``` or ~~~, optionally preceded by up to 3 spaces)
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  });
  return headings;
}
