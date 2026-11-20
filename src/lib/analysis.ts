import { normalizeMerchant } from './categorize';
import { addMonths } from './dates';
import type { Category, Txn } from './types';

export const sum = (ts: Txn[]) => ts.reduce((a, t) => a + t.amount, 0);

export function inMonth(txns: Txn[], billMonth: string, cardId?: string): Txn[] {
  return txns.filter((t) => t.billMonth === billMonth && (!cardId || t.cardId === cardId));
}

export interface CatTotal {
  categoryId: string | null;
  amount: number;
  count: number;
}

export function byCategory(txns: Txn[]): CatTotal[] {
  const m = new Map<string | null, CatTotal>();
  for (const t of txns) {
    const k = t.categoryId ?? null;
    const cur = m.get(k) ?? { categoryId: k, amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

export interface MerchantTotal {
  merchant: string;
  amount: number;
  count: number;
}

export function byMerchant(txns: Txn[]): MerchantTotal[] {
  const m = new Map<string, MerchantTotal>();
  for (const t of txns) {
    const k = normalizeMerchant(t.merchant);
    const cur = m.get(k) ?? { merchant: t.merchant, amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

export interface Change {
  categoryId: string | null;
  cur: number;
  prev: number;
  diff: number;
}

/** 前月より増えたカテゴリ（1,000円以上かつ10%以上の増加） */
export function increases(cur: Txn[], prev: Txn[]): Change[] {
  const p = new Map(byCategory(prev).map((c) => [c.categoryId, c.amount]));
  const c = new Map(byCategory(cur).map((x) => [x.categoryId, x.amount]));
  const keys = new Set([...p.keys(), ...c.keys()]);
  const out: Change[] = [];
  for (const k of keys) {
    const a = c.get(k) ?? 0;
    const b = p.get(k) ?? 0;
    const diff = a - b;
    if (diff >= 1000 && (b === 0 || diff / b >= 0.1)) out.push({ categoryId: k, cur: a, prev: b, diff });
  }
  return out.sort((x, y) => y.diff - x.diff);
}

export interface Subscription {
  key: string;
  merchant: string;
  monthly: number;
  annual: number;
  months: number;
  categoryId?: string;
  lastDate: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * 定期的な支払い（サブスク・固定費）を検出する。
 * 直近 6 か月の請求のうち 3 か月以上（固定費カテゴリなら 2 か月以上）同じ店で、
 * 金額のばらつきが中央値の 15% 以内のもの。
 */
export function detectSubscriptions(txns: Txn[], endMonth: string, categories: Category[]): Subscription[] {
  const fixed = new Set(categories.filter((c) => c.fixed).map((c) => c.id));
  const start = addMonths(endMonth, -5);
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.billMonth < start || t.billMonth > endMonth || t.amount <= 0 || t.payType === 'split') continue;
    const k = normalizeMerchant(t.merchant);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Subscription[] = [];
  for (const [key, ts] of groups) {
    const perMonth = new Map<string, number>();
    for (const t of ts) perMonth.set(t.billMonth, (perMonth.get(t.billMonth) ?? 0) + t.amount);
    const amounts = [...perMonth.values()];
    const latest = ts.reduce((a, b) => (b.date > a.date ? b : a));
    const isFixed = !!latest.categoryId && fixed.has(latest.categoryId);
    if (perMonth.size < (isFixed ? 2 : 3)) continue;
    const med = median(amounts);
    if (Math.max(...amounts) - Math.min(...amounts) > med * 0.15) continue;
    // 最近 2 か月に請求がなければ解約済みとみなす
    if (latest.billMonth < addMonths(endMonth, -1)) continue;
    out.push({
      key,
      merchant: latest.merchant,
      monthly: med,
      annual: med * 12,
      months: perMonth.size,
      categoryId: latest.categoryId,
      lastDate: latest.date,
    });
  }
  return out.sort((a, b) => b.annual - a.annual);
}

const FEE_RE = /(手数料|年会費|利息|リボ|分割払|延滞|遅延|ATM|キャッシング)/;

/** 本来払わなくてよい費用（リボ・分割・手数料・年会費） */
export function feeTxns(txns: Txn[]): Txn[] {
  return txns.filter((t) => t.payType === 'revo' || t.payType === 'split' || FEE_RE.test(t.merchant.normalize('NFKC')));
}

export interface Suggestion {
  kind: 'fee' | 'sub' | 'want' | 'increase' | 'goal';
  title: string;
  detail: string;
  /** 年間で減らせる見込み額 */
  annual?: number;
}

export function suggestions(opts: {
  cur: Txn[];
  prev: Txn[];
  subs: Subscription[];
  catName: (id: string | null | undefined) => string;
  goalTotal?: number;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const fees = feeTxns(opts.cur);
  const revo = fees.filter((t) => t.payType === 'revo');
  if (revo.length) {
    out.push({
      kind: 'fee',
      title: `リボ払いが${revo.length}件あります`,
      detail: 'リボ払いは手数料（年15%前後）がかかります。1回払いへの変更や繰り上げ返済を検討しましょう。',
    });
  }
  const pureFees = fees.filter((t) => t.payType !== 'revo' && t.payType !== 'split');
  if (pureFees.length) {
    out.push({
      kind: 'fee',
      title: `手数料・年会費 ${pureFees.length}件（¥${sum(pureFees).toLocaleString('ja-JP')}）`,
      detail: `${pureFees.map((t) => t.merchant).slice(0, 3).join('、')} など。無料にする条件や、カードの見直しで払わずに済むかもしれません。`,
    });
  }
  if (opts.subs.length) {
    const annual = opts.subs.reduce((a, s) => a + s.annual, 0);
    out.push({
      kind: 'sub',
      title: `定期的な支払い ${opts.subs.length}件（年額 ¥${annual.toLocaleString('ja-JP')}）`,
      detail: `使っていないもの、重複しているものがないか確認しましょう。最大は ${opts.subs[0].merchant}（年 ¥${opts.subs[0].annual.toLocaleString('ja-JP')}）。`,
    });
  }
  const wants = opts.cur.filter((t) => t.need === 'want');
  if (wants.length) {
    const total = sum(wants);
    out.push({
      kind: 'want',
      title: `「なくてもよかった」${wants.length}件`,
      detail: `今月の合計 ¥${total.toLocaleString('ja-JP')}。来月はこの分が減らせる目安です。`,
      annual: total * 12,
    });
  }
  const inc = increases(opts.cur, opts.prev)[0];
  if (inc) {
    out.push({
      kind: 'increase',
      title: `${opts.catName(inc.categoryId)}が先月より +¥${inc.diff.toLocaleString('ja-JP')}`,
      detail: '一時的な出費か、習慣になりつつあるのかを振り返りましょう。',
    });
  }
  if (opts.goalTotal) {
    const total = sum(opts.cur);
    if (total > opts.goalTotal) {
      out.push({
        kind: 'goal',
        title: `目標を ¥${(total - opts.goalTotal).toLocaleString('ja-JP')} 超えています`,
        detail: '大きい支出から順に、来月減らせるものを1つ決めましょう。',
      });
    }
  }
  return out;
}

/** 直近 n か月の請求額の推移 */
export function monthlyTotals(txns: Txn[], endMonth: string, n: number, cardId?: string) {
  return Array.from({ length: n }, (_, i) => {
    const ym = addMonths(endMonth, i - (n - 1));
    return { ym, total: sum(inMonth(txns, ym, cardId)) };
  });
}
