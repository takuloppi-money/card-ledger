import { billMonthFor } from './billing';
import { normalizeMerchant, suggestCategory } from './categorize';
import { randomId } from './crypto';
import { diffDays, isValidDate } from './dates';
import { cleanText, parseYen } from './format';
import type { Card, PayType, Rule, Txn } from './types';

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;

/** UTF-8 として読めなければ Shift_JIS（多くのカード会社の CSV）として読む */
export function decodeCsv(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('shift_jis').decode(buf);
  }
  return text.replace(/^﻿/, '');
}

/** RFC 4180 準拠の CSV パーサ（引用符・改行入りのセルに対応） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > MAX_ROWS) throw new Error(`行数が多すぎます（${MAX_ROWS}行まで）`);
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

export function parseCsvDate(s: string): string | null {
  const t = s.normalize('NFKC').trim();
  let m = t.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/);
  if (!m) {
    const short = t.match(/^(\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (short) m = [short[0], `20${short[1]}`, short[2], short[3]] as RegExpMatchArray;
  }
  if (!m) {
    const compact = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) m = compact;
  }
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

export function parsePayType(s: string): PayType {
  const t = s.normalize('NFKC');
  if (/リボ/.test(t)) return 'revo';
  if (/ボーナス/.test(t)) return 'bonus';
  if (/分割|\d+回払/.test(t) && !/^1回/.test(t)) return 'split';
  return 'once';
}

export interface CsvMapping {
  headerRow: number; // -1 = 見出しなし
  date: number;
  merchant: number;
  amount: number;
  payType: number; // -1 = なし
}

const HEAD = {
  date: /(利用日|利用年月日|ご利用年月日|取引日|日付|売上日)/,
  merchant: /(利用店|ご利用先|利用先|加盟店|店名|摘要|ご利用内容|利用内容|内容)/,
  amountPrimary: /(今回.*請求|今回.*支払|当月.*請求|支払総額|お支払金額|ご請求額|請求金額)/,
  amount: /(利用金額|ご利用金額|金額)/,
  payType: /(支払方法|支払区分|お支払方法|支払回数)/,
};

function findCol(header: string[], re: RegExp, exclude: number[] = []): number {
  return header.findIndex((h, i) => !exclude.includes(i) && re.test(h.normalize('NFKC')));
}

/** 見出し行と列を推定する。推定できない列は -1 */
export function detectMapping(rows: string[][]): CsvMapping {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const h = rows[r];
    const date = findCol(h, HEAD.date);
    let amount = findCol(h, HEAD.amountPrimary);
    if (amount < 0) amount = findCol(h, HEAD.amount);
    if (date >= 0 && amount >= 0) {
      const merchant = findCol(h, HEAD.merchant, [date, amount]);
      const payType = findCol(h, HEAD.payType, [date, amount, merchant]);
      return { headerRow: r, date, merchant, amount, payType };
    }
  }
  // 見出しがない CSV：中身から推定する
  const sample = rows.filter((r) => r.some((c) => parseCsvDate(c))).slice(0, 30);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const score = (fn: (c: string) => boolean) =>
    Array.from({ length: width }, (_, i) => sample.filter((r) => r[i] != null && fn(r[i])).length);
  const pick = (scores: number[], exclude: number[]) => {
    let best = -1;
    scores.forEach((s, i) => {
      if (!exclude.includes(i) && s > 0 && (best < 0 || s > scores[best])) best = i;
    });
    return best;
  };
  const date = pick(score((c) => !!parseCsvDate(c)), []);
  const amount = pick(score((c) => parseYen(c) != null && !parseCsvDate(c)), [date]);
  const textLen = Array.from({ length: width }, (_, i) =>
    sample.reduce((a, r) => a + (r[i] && parseYen(r[i]) == null && !parseCsvDate(r[i]) ? r[i].length : 0), 0),
  );
  const merchant = pick(textLen, [date, amount]);
  return { headerRow: -1, date, merchant, amount, payType: -1 };
}

export interface CsvRow {
  date: string;
  merchant: string;
  amount: number;
  payType: PayType;
}

/** 日付と金額を読めない行（合計行・注記など）は除外する */
export function extractRows(rows: string[][], map: CsvMapping): CsvRow[] {
  if (map.date < 0 || map.amount < 0) return [];
  const out: CsvRow[] = [];
  for (let i = map.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseCsvDate(r[map.date] ?? '');
    const amount = parseYen(r[map.amount] ?? '');
    if (!date || amount == null || amount === 0) continue;
    out.push({
      date,
      merchant: cleanText(map.merchant >= 0 ? (r[map.merchant] ?? '') : '', 100) || '（店名なし）',
      amount,
      payType: map.payType >= 0 ? parsePayType(r[map.payType] ?? '') : 'once',
    });
  }
  return out;
}

/** 明細の多くが属する請求月（CSV は通常 1 回の請求分） */
export function guessBillMonth(rows: CsvRow[], card: Card): string | null {
  const count = new Map<string, number>();
  for (const r of rows) {
    const bm = billMonthFor(r.date, card);
    count.set(bm, (count.get(bm) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [k, v] of count) if (!best || v > count.get(best)! || (v === count.get(best)! && k > best)) best = k;
  return best;
}

export interface ImportPlan {
  added: Txn[];
  matched: { before: Txn; after: Txn }[];
  duplicates: number;
}

/**
 * 取り込み計画を作る。
 * - 同じ取り込みキーの明細が既にあれば重複としてスキップ
 * - 手入力（未照合）の明細と、同じカード・同じ金額・利用日の差が 3 日以内なら 1 件にまとめる
 */
export function planImport(
  rows: CsvRow[],
  card: Card,
  billMonth: string,
  existing: Txn[],
  rules: Rule[],
): ImportPlan {
  const now = Date.now();
  const keys = new Set(existing.filter((t) => t.importKey).map((t) => t.importKey));
  const pending = existing
    .filter((t) => t.cardId === card.id && t.status === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set<string>();
  const seen = new Map<string, number>();
  const plan: ImportPlan = { added: [], matched: [], duplicates: 0 };

  for (const r of rows) {
    const base = `${card.id}|${billMonth}|${r.date}|${normalizeMerchant(r.merchant)}|${r.amount}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const importKey = `${base}|${n}`;
    if (keys.has(importKey)) {
      plan.duplicates++;
      continue;
    }
    const hit = pending
      .filter((p) => !used.has(p.id) && p.amount === r.amount && Math.abs(diffDays(p.date, r.date)) <= 3)
      .sort((a, b) => Math.abs(diffDays(a.date, r.date)) - Math.abs(diffDays(b.date, r.date)))[0];
    if (hit) {
      used.add(hit.id);
      plan.matched.push({
        before: hit,
        after: {
          ...hit,
          date: r.date,
          billMonth,
          payType: r.payType,
          status: 'confirmed',
          importKey,
          memo: hit.merchant !== r.merchant ? cleanText(`${hit.memo ? `${hit.memo} ` : ''}（明細上の店名：${r.merchant}）`, 500) : hit.memo,
          updatedAt: now,
        },
      });
      continue;
    }
    plan.added.push({
      id: randomId(),
      cardId: card.id,
      date: r.date,
      billMonth,
      merchant: r.merchant,
      amount: r.amount,
      categoryId: suggestCategory(r.merchant, rules, existing),
      payType: r.payType,
      source: 'csv',
      status: 'confirmed',
      importKey,
      createdAt: now,
      updatedAt: now,
    });
  }
  return plan;
}
