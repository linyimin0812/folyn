// SM-2 间隔重复调度器（纯函数）。
// 参考：research/learning-methods.md §3 与 prd.md "SM-2 scheduler spec (minimal)"。
//
// 与 Anki 的简化差异（MVP，文档化）：
// - lapse（Again）时不更新 ef（避免 ease hell，Anki 风格）。
// - 无同日 learning steps、无 fuzz、无 max-interval 上限（二期）。
// - 评级仅 4 按钮 → q∈{0,3,4,5}。

import type { ReviewRating, Sm2State, Sm2Result } from './types';

/** 评级 → SM-2 quality q∈0..5 */
const RATING_TO_Q: Record<ReviewRating, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

/** ef 下限 */
const MIN_EF = 1.3;

/** 把 YYYY-MM-DD 加上指定天数，返回 YYYY-MM-DD。纯函数，不读系统时钟。 */
export function addDays(yyyyMmDd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return yyyyMmDd;
  // 用本地 Date 构造，但仅做日期算术；输入无时区，构造时取本地 00:00。
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** 判断某原子是否到期：`next <= today`（YYYY-MM-DD 字典序即日期序）。
 *  注意：仅适用于规范日期串；畸形串的字典序无意义，调用方应保证 next 为合法日期
 *  （解析层 ATTR_RE + clamp 已约束）。 */
export function isDue(next: string, today: string): boolean {
  return next <= today;
}

/**
 * SM-2 调度。输入旧状态 + 评级 + today（YYYY-MM-DD），返回新状态（含 next）。
 *
 * 更新规则：
 * - q<3（again）：rep←0, ivl←1, lapses+1，ef 不变（避 ease hell）。
 * - q≥3：
 *   - rep==0 → ivl=1
 *   - rep==1 → ivl=6
 *   - rep≥2 → ivl=round(ivl_prev * ef)
 *   - rep += 1
 *   - ef ← ef + (0.1 - (5-q)*(0.08 + (5-q)*0.02))，下限 1.3
 * - next ← today + ivl 天
 */
export function reviewAtom(state: Sm2State, rating: ReviewRating, today: string): Sm2Result {
  const q = RATING_TO_Q[rating];
  let { rep, ef, ivl, lapses } = state;

  if (q < 3) {
    // lapse：重置，不降 ef
    rep = 0;
    ivl = 1;
    lapses += 1;
  } else {
    if (rep === 0) {
      ivl = 1;
    } else if (rep === 1) {
      ivl = 6;
    } else {
      ivl = Math.round(ivl * ef);
    }
    rep += 1;
    const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
    ef = ef + delta;
    if (ef < MIN_EF) ef = MIN_EF;
  }

  const next = addDays(today, ivl);
  return { rep, ef, ivl, lapses, next };
}
