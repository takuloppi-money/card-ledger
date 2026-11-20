import { randomId } from './crypto';
import type { Category, Rule, Txn } from './types';

/** 店名の表記ゆれを吸収する（全角半角・大文字小文字・空白・長音や記号の違い） */
export function normalizeMerchant(s: string): string {
  return s
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐－―ー・.,／/＊*]/g, '')
    .trim();
}

/**
 * 店名からカテゴリを推定する。
 * 1. 分類ルール（長いパターンほど優先）
 * 2. 過去に同じ店で付けたカテゴリ（新しいもの優先）
 */
export function suggestCategory(merchant: string, rules: Rule[], txns: Txn[]): string | undefined {
  const m = normalizeMerchant(merchant);
  if (!m) return undefined;
  let best: Rule | undefined;
  for (const r of rules) {
    const p = normalizeMerchant(r.pattern);
    if (p && m.includes(p) && (!best || p.length > normalizeMerchant(best.pattern).length)) best = r;
  }
  if (best) return best.categoryId;
  let latest: Txn | undefined;
  for (const t of txns) {
    if (t.categoryId && normalizeMerchant(t.merchant) === m && (!latest || t.updatedAt > latest.updatedAt)) latest = t;
  }
  return latest?.categoryId;
}

/** 手で直したカテゴリを、その店名のルールとして覚える */
export function learnRule(merchant: string, categoryId: string, rules: Rule[]): Rule | null {
  const pattern = normalizeMerchant(merchant);
  if (!pattern) return null;
  const existing = rules.find((r) => normalizeMerchant(r.pattern) === pattern);
  if (existing) return existing.categoryId === categoryId ? null : { ...existing, categoryId };
  return { id: randomId(), pattern, categoryId, createdAt: Date.now() };
}

/** 色は明るさも変えて、色の見分けにくい人でも区別しやすくしている */
const DEFAULTS: [string, string, boolean?][] = [
  ['食費', '#0ABAB5'],
  ['外食', '#E58A3A'],
  ['コンビニ', '#C25E8A'],
  ['日用品', '#5B7FD6'],
  ['交通', '#8FB33A'],
  ['趣味・娯楽', '#7A5BC2'],
  ['衣服・美容', '#D9A400'],
  ['交際費', '#E06A5A'],
  ['医療', '#3F8F8C'],
  ['サブスク', '#03201F', true],
  ['通信', '#2F4F6F', true],
  ['公共料金', '#6B5B3E', true],
  ['保険', '#556B2F', true],
  ['手数料', '#A84F0C'],
  ['その他', '#9AA9A8'],
];

export function defaultCategories(): Category[] {
  return DEFAULTS.map(([name, color, fixed], i) => ({ id: randomId(), name, color, order: i, fixed }));
}

const DEFAULT_RULES: [string, string][] = [
  ['セブンイレブン', 'コンビニ'],
  ['ファミリーマート', 'コンビニ'],
  ['ローソン', 'コンビニ'],
  ['ミニストップ', 'コンビニ'],
  ['NETFLIX', 'サブスク'],
  ['SPOTIFY', 'サブスク'],
  ['APPLECOMBILL', 'サブスク'],
  ['YOUTUBE', 'サブスク'],
  ['AMAZONPRIME', 'サブスク'],
  ['年会費', '手数料'],
  ['手数料', '手数料'],
  ['JR', '交通'],
  ['モバイルSUICA', '交通'],
  ['ETC', '交通'],
];

export function defaultRules(categories: Category[]): Rule[] {
  const byName = new Map(categories.map((c) => [c.name, c.id]));
  return DEFAULT_RULES.flatMap(([pattern, name]) => {
    const categoryId = byName.get(name);
    return categoryId ? [{ id: randomId(), pattern, categoryId, createdAt: Date.now() }] : [];
  });
}
