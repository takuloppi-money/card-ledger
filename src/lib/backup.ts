import { decryptBackup, encryptBackup } from './crypto';
import { isValidDate } from './dates';
import { cleanMultiline, cleanText } from './format';
import type { Snapshot } from './store';
import {
  DEFAULT_SETTINGS,
  TABLES,
  type Advice,
  type Card,
  type Category,
  type Goal,
  type PayType,
  type Rule,
  type SavingAction,
  type Settings,
  type Txn,
} from './types';

const APP = 'card-ledger';

export async function exportBackup(snap: Snapshot, password: string): Promise<Blob> {
  const file = await encryptBackup({ app: APP, v: 1, exportedAt: Date.now(), data: snap }, password);
  return new Blob([JSON.stringify(file)], { type: 'application/octet-stream' });
}

export function backupFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `card-ledger-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.cardbackup`;
}

export async function importBackup(text: string, password: string): Promise<Snapshot> {
  const payload = (await decryptBackup(text, password)) as { app?: unknown; v?: unknown; data?: unknown };
  if (!payload || payload.app !== APP || payload.v !== 1) throw new Error('このアプリのバックアップではありません');
  return validateSnapshot(payload.data);
}

// ---- 中身の検証（暗号化されていても、改ざん・別アプリのデータを想定して型を確かめる） ----

class Invalid extends Error {
  constructor(where: string) {
    super(`バックアップの内容が不正です（${where}）`);
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function id(x: unknown, w: string): string {
  if (typeof x !== 'string' || !ID_RE.test(x)) throw new Invalid(w);
  return x;
}
function text(x: unknown, max: number, w: string, required = true): string {
  if (typeof x !== 'string') {
    if (!required && x == null) return '';
    throw new Invalid(w);
  }
  return cleanText(x, max);
}
function int(x: unknown, min: number, max: number, w: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) throw new Invalid(w);
  return x;
}
function optInt(x: unknown, min: number, max: number, w: string): number | undefined {
  return x == null ? undefined : int(x, min, max, w);
}
function list(x: unknown, max: number, w: string): Obj[] {
  if (!Array.isArray(x) || x.length > max || !x.every(isObj)) throw new Invalid(w);
  return x;
}
const PAY: PayType[] = ['once', 'split', 'revo', 'bonus'];
const TS_MAX = 4_102_444_800_000; // 2100年

export function validateSnapshot(data: unknown): Snapshot {
  if (!isObj(data)) throw new Invalid('全体');
  for (const k of Object.keys(data)) if (!TABLES.includes(k as never)) throw new Invalid(`不明な項目 ${k}`);

  const cards: Card[] = list(data.cards ?? [], 50, 'カード').map((c) => ({
    id: id(c.id, 'カードID'),
    name: text(c.name, 40, 'カード名'),
    closingDay: int(c.closingDay, 1, 31, '締め日'),
    payOffset: int(c.payOffset, 1, 2, '支払月'),
    payDay: int(c.payDay, 1, 31, '支払日'),
    order: int(c.order, 0, 1000, '並び順'),
  }));
  const categories: Category[] = list(data.categories ?? [], 100, 'カテゴリ').map((c) => {
    if (typeof c.color !== 'string' || !COLOR_RE.test(c.color)) throw new Invalid('カテゴリの色');
    return {
      id: id(c.id, 'カテゴリID'),
      name: text(c.name, 30, 'カテゴリ名'),
      color: c.color,
      order: int(c.order, 0, 1000, '並び順'),
      fixed: c.fixed === true ? true : undefined,
    };
  });
  const cardIds = new Set(cards.map((c) => c.id));
  const catIds = new Set(categories.map((c) => c.id));
  const catRef = (x: unknown, w: string) => {
    if (x == null) return undefined;
    const v = id(x, w);
    return catIds.has(v) ? v : undefined;
  };

  const txns: Txn[] = list(data.txns ?? [], 200_000, '明細').map((t) => {
    const cardId = id(t.cardId, '明細のカード');
    if (!cardIds.has(cardId)) throw new Invalid('明細のカード');
    if (typeof t.date !== 'string' || !isValidDate(t.date)) throw new Invalid('利用日');
    if (typeof t.billMonth !== 'string' || !YM_RE.test(t.billMonth)) throw new Invalid('請求月');
    if (!PAY.includes(t.payType as PayType)) throw new Invalid('支払方法');
    if (t.source !== 'manual' && t.source !== 'csv') throw new Invalid('入力元');
    if (t.status !== 'pending' && t.status !== 'confirmed') throw new Invalid('状態');
    if (t.need != null && t.need !== 'need' && t.need !== 'want') throw new Invalid('要/不要');
    return {
      id: id(t.id, '明細ID'),
      cardId,
      date: t.date,
      billMonth: t.billMonth,
      merchant: text(t.merchant, 100, '店名'),
      amount: int(t.amount, -100_000_000, 100_000_000, '金額'),
      categoryId: catRef(t.categoryId, '明細のカテゴリ'),
      payType: t.payType as PayType,
      need: (t.need as Txn['need']) ?? undefined,
      memo: text(t.memo, 500, 'メモ', false) || undefined,
      source: t.source,
      status: t.status,
      importKey: t.importKey == null ? undefined : text(t.importKey, 400, '取込キー'),
      createdAt: int(t.createdAt, 0, TS_MAX, '作成日時'),
      updatedAt: int(t.updatedAt, 0, TS_MAX, '更新日時'),
    };
  });

  const rules: Rule[] = list(data.rules ?? [], 5000, 'ルール').flatMap((r) => {
    const categoryId = catRef(r.categoryId, 'ルールのカテゴリ');
    if (!categoryId) return [];
    return [{ id: id(r.id, 'ルールID'), pattern: text(r.pattern, 100, 'パターン'), categoryId, createdAt: int(r.createdAt, 0, TS_MAX, '作成日時') }];
  });

  const goals: Goal[] = list(data.goals ?? [], 1, '目標').map((g) => {
    if (g.id !== 'default' || !isObj(g.byCategory)) throw new Invalid('目標');
    const byCategory: Record<string, number> = {};
    for (const [k, v] of Object.entries(g.byCategory)) {
      if (catIds.has(k)) byCategory[k] = int(v, 0, 100_000_000, 'カテゴリ目標');
    }
    return { id: 'default', total: optInt(g.total, 0, 100_000_000, '目標額'), byCategory };
  });

  const actions: SavingAction[] = list(data.actions ?? [], 5000, '削減メモ').map((a) => {
    if (typeof a.date !== 'string' || !isValidDate(a.date)) throw new Invalid('削減メモの日付');
    return {
      id: id(a.id, '削減メモID'),
      date: a.date,
      text: text(a.text, 200, '削減メモ'),
      monthlySaving: int(a.monthlySaving, 0, 100_000_000, '削減額'),
      createdAt: int(a.createdAt, 0, TS_MAX, '作成日時'),
    };
  });

  const advice: Advice[] = list(data.advice ?? [], 1200, 'アドバイス').map((a) => {
    if (typeof a.id !== 'string' || !YM_RE.test(a.id)) throw new Invalid('アドバイスの月');
    if (typeof a.text !== 'string') throw new Invalid('アドバイス');
    return { id: a.id, text: cleanMultiline(a.text, 20000), createdAt: int(a.createdAt, 0, TS_MAX, '作成日時') };
  });

  const s = list(data.settings ?? [], 1, '設定')[0];
  const settings: Settings[] = [
    s
      ? {
          id: 'app',
          autoLockSec: int(s.autoLockSec, 0, 3600, '自動ロック'),
          lastBackupAt: optInt(s.lastBackupAt, 0, TS_MAX, '最終バックアップ'),
          claudeIncludeMerchants: s.claudeIncludeMerchants === true,
        }
      : DEFAULT_SETTINGS,
  ];

  return { cards, categories, txns, rules, goals, actions, advice, settings };
}
