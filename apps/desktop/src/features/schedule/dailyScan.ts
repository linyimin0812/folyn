// 枚举 vault 中所有 daily note 文件 {path, date}。
// 复用 CalendarPanel 的扫描逻辑，但返回路径而非仅日期集合。

import type { VaultEntry } from '@folyn/vault-provider';

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** 在 fileTree 中查找指定目录名（仅一级匹配，递归向下扫描），
 *  返回其下所有 YYYY-MM-DD.md 的 {path, date}。 */
export function extractDailyNotePaths(
  entries: VaultEntry[],
  dailyDir: string,
): { path: string; date: string }[] {
  const out: { path: string; date: string }[] = [];
  function scan(items: VaultEntry[]) {
    for (const entry of items) {
      if (entry.type === 'dir' && entry.name === dailyDir && entry.children) {
        for (const child of entry.children) {
          if (child.type === 'file') {
            const m = DATE_RE.exec(child.name);
            if (m) out.push({ path: child.path, date: m[1] });
          }
        }
      } else if (entry.type === 'dir' && entry.children) {
        scan(entry.children);
      }
    }
  }
  scan(entries);
  return out;
}

/** YYYY-MM-DD → Date（本地 0 点）。 */
export function dateFromString(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Date → YYYY-MM-DD。 */
export function dateToString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 周一为一周起始。 */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
