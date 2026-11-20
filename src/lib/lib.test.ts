import { describe, expect, it } from 'vitest';
import { detectSubscriptions, feeTxns, increases } from './analysis';
import { exportBackup, importBackup, validateSnapshot } from './backup';
import { billMonthFor, payDateFor } from './billing';
import { learnRule, normalizeMerchant, suggestCategory } from './categorize';
import {
  decryptBackup,
  deriveKey,
  encryptBackup,
  generateDek,
  openJson,
  randomBytes,
  sealJson,
  unwrapDek,
  wrapDek,
  WrongPasswordError,
} from './crypto';
import { decodeCsv, detectMapping, extractRows, guessBillMonth, parseCsv, parseCsvDate, planImport } from './csv';
import { cleanText, parseYen } from './format';
import { validateSecret } from './lock';
import type { Card, Category, Txn } from './types';

const card: Card = { id: 'c1', name: 'メイン', closingDay: 15, payOffset: 1, payDay: 10, order: 0 };
const endOfMonth: Card = { ...card, id: 'c2', closingDay: 31, payDay: 27 };

const txn = (p: Partial<Txn>): Txn => ({
  id: Math.random().toString(36).slice(2),
  cardId: 'c1',
  date: '2026-11-01',
  billMonth: '2026-12',
  merchant: '店',
  amount: 1000,
  payType: 'once',
  source: 'manual',
  status: 'confirmed',
  createdAt: 1,
  updatedAt: 1,
  ...p,
});

describe('暗号化', () => {
  it('DEK を包んで取り出せ、鍵が違えば失敗する', async () => {
    const dek = await generateDek();
    const salt = randomBytes(16);
    const kek = await deriveKey('123456', salt, 100_000, ['wrapKey', 'unwrapKey']);
    const w = await wrapDek(dek, kek);
    const back = await unwrapDek(w, kek);
    const sealed = await sealJson(dek, { a: 1 }, 'txns:x');
    expect(await openJson(back, sealed, 'txns:x')).toEqual({ a: 1 });
    expect(back.extractable).toBe(false);
    const wrong = await deriveKey('654321', salt, 100_000, ['wrapKey', 'unwrapKey']);
    await expect(unwrapDek(w, wrong)).rejects.toThrow();
  });

  it('暗号文を別レコードに差し替えると復号できない（AAD）', async () => {
    const dek = await generateDek();
    const sealed = await sealJson(dek, { amount: 100 }, 'txns:a');
    await expect(openJson(dek, sealed, 'txns:b')).rejects.toThrow();
  });

  it('同じ内容でも毎回違う暗号文になる', async () => {
    const dek = await generateDek();
    const a = await sealJson(dek, { x: 1 }, 'k');
    const b = await sealJson(dek, { x: 1 }, 'k');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('バックアップ：正しいパスワードで復号、違えば WrongPasswordError', async () => {
    const f = await encryptBackup({ hello: 'world' }, 'correct horse');
    expect(JSON.stringify(f)).not.toContain('world');
    expect(await decryptBackup(JSON.stringify(f), 'correct horse')).toEqual({ hello: 'world' });
    await expect(decryptBackup(JSON.stringify(f), 'wrong pass')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('バックアップ：反復回数を極端に大きく書き換えたファイルは拒否する', async () => {
    const f = await encryptBackup({}, 'password1');
    f.kdf.iterations = 1e10;
    await expect(decryptBackup(JSON.stringify(f), 'password1')).rejects.toThrow('不正な鍵設定');
  });
});

describe('PIN の条件', () => {
  it('短い・単純な PIN は拒否', () => {
    expect(validateSecret('12345', 'pin')).toBeTruthy();
    expect(validateSecret('111111', 'pin')).toBeTruthy();
    expect(validateSecret('123456', 'pin')).toBeTruthy();
    expect(validateSecret('abc123', 'pin')).toBeTruthy();
    expect(validateSecret('480263', 'pin')).toBeNull();
    expect(validateSecret('short', 'password')).toBeTruthy();
    expect(validateSecret('long enough', 'password')).toBeNull();
  });
});

describe('請求月', () => {
  it('15日締め翌月10日払い', () => {
    expect(billMonthFor('2026-11-15', card)).toBe('2026-12');
    expect(billMonthFor('2026-11-16', card)).toBe('2027-01');
    expect(payDateFor('2026-12', card)).toBe('2026-12-10');
  });
  it('末日締め翌月27日払い', () => {
    expect(billMonthFor('2026-02-28', endOfMonth)).toBe('2026-03');
    expect(billMonthFor('2026-12-31', endOfMonth)).toBe('2027-01');
  });
  it('末日払いは月の日数に合わせる', () => {
    expect(payDateFor('2026-02', { payDay: 31 })).toBe('2026-02-28');
  });
});

describe('入力の整形', () => {
  it('金額', () => {
    expect(parseYen('１，２３４円')).toBe(1234);
    expect(parseYen('¥-500')).toBe(-500);
    expect(parseYen('△300')).toBe(-300);
    expect(parseYen('12.5')).toBeNull();
    expect(parseYen('=1+1')).toBeNull();
    expect(parseYen('')).toBeNull();
  });
  it('制御文字・方向制御文字を除く', () => {
    expect(cleanText('a\u0000b‮c\n d', 100)).toBe('a b c d');
    expect(cleanText('x'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('自動分類', () => {
  it('表記ゆれを吸収してルールに一致', () => {
    expect(normalizeMerchant('ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ　渋谷')).toBe(normalizeMerchant('セブンイレブン渋谷'));
    const rules = [
      { id: 'r1', pattern: 'セブン', categoryId: 'a', createdAt: 1 },
      { id: 'r2', pattern: 'セブンイレブン', categoryId: 'b', createdAt: 1 },
    ];
    expect(suggestCategory('ｾﾌﾞﾝｲﾚﾌﾞﾝ 新宿店', rules, [])).toBe('b');
  });
  it('過去の明細からも推定し、手で直すとルールを覚える', () => {
    expect(suggestCategory('喫茶A', [], [txn({ merchant: '喫茶A', categoryId: 'cafe' })])).toBe('cafe');
    expect(learnRule('喫茶A', 'x', [])?.pattern).toBe(normalizeMerchant('喫茶A'));
    expect(learnRule('喫茶A', 'x', [{ id: 'r', pattern: '喫茶A', categoryId: 'x', createdAt: 1 }])).toBeNull();
  });
});

describe('CSV', () => {
  const sjisLike = [
    'カード名称,メインカード',
    '',
    'ご利用日,ご利用店名,ご利用金額,支払区分,今回ご請求額',
    '2026/10/20,"セブン-イレブン, 渋谷",540,1回払い,540',
    '2026/10/21,NETFLIX.COM,1490,1回払い,1490',
    '2026/10/21,NETFLIX.COM,1490,1回払い,1490',
    '2026/10/25,家電店,120000,分割(3回),40000',
    ',合計,,,42030',
  ].join('\r\n');

  it('引用符・カンマ入りのセルを読める', () => {
    const rows = parseCsv(sjisLike);
    expect(rows[3][1]).toBe('セブン-イレブン, 渋谷');
  });

  it('見出しを見つけ、今回請求額の列を優先する', () => {
    const rows = parseCsv(sjisLike);
    const map = detectMapping(rows);
    expect(map).toMatchObject({ headerRow: 2, date: 0, merchant: 1, amount: 4, payType: 3 });
    const out = extractRows(rows, map);
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ amount: 40000, payType: 'split' });
  });

  it('見出しのない CSV も推定できる', () => {
    const rows = parseCsv('2026/10/01,スーパーA,3200\n2026/10/02,ドラッグB,880\n');
    expect(detectMapping(rows)).toMatchObject({ headerRow: -1, date: 0, merchant: 1, amount: 2 });
  });

  it('Shift_JIS を読める', () => {
    // 「利用日」の Shift_JIS バイト列
    const bytes = new Uint8Array([0x97, 0x98, 0x97, 0x70, 0x93, 0xfa]);
    expect(decodeCsv(bytes.buffer)).toBe('利用日');
  });

  it('日付の書式', () => {
    expect(parseCsvDate('2026年1月5日')).toBe('2026-01-05');
    expect(parseCsvDate('26/01/05')).toBe('2026-01-05');
    expect(parseCsvDate('20260105')).toBe('2026-01-05');
    expect(parseCsvDate('2026/02/30')).toBeNull();
  });

  it('取り込み：手入力と照合し、同じ CSV の再取り込みは重複扱い', () => {
    const rows = extractRows(parseCsv(sjisLike), detectMapping(parseCsv(sjisLike)));
    const bm = guessBillMonth(rows, card)!;
    expect(bm).toBe('2026-12');
    const manual = txn({ id: 'm1', date: '2026-10-19', amount: 540, status: 'pending', merchant: 'セブン', categoryId: 'conv', billMonth: '2026-12' });
    const plan = planImport(rows, card, bm, [manual], []);
    expect(plan.matched).toHaveLength(1);
    expect(plan.matched[0].after).toMatchObject({ id: 'm1', status: 'confirmed', categoryId: 'conv', date: '2026-10-20' });
    // 同じ日・同じ店・同じ金額の 2 件は別物として両方取り込む
    expect(plan.added).toHaveLength(3);
    const all = [...plan.added, ...plan.matched.map((m) => m.after)];
    const again = planImport(rows, card, bm, all, []);
    expect(again.added).toHaveLength(0);
    expect(again.matched).toHaveLength(0);
    expect(again.duplicates).toBe(4);
  });
});

describe('分析', () => {
  const cats: Category[] = [{ id: 'sub', name: 'サブスク', color: '#000000', order: 0, fixed: true }];
  it('サブスクを検出し、止まったものは除外', () => {
    const ts = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].flatMap((bm) => [
      txn({ billMonth: bm, merchant: 'NETFLIX', amount: 1490, date: `${bm}-01` }),
      ...(bm < '2026-10' ? [txn({ billMonth: bm, merchant: 'OLD', amount: 500, date: `${bm}-01` })] : []),
      txn({ billMonth: bm, merchant: 'スーパー', amount: 3000 + Math.round(Math.random() * 5000), date: `${bm}-02` }),
    ]);
    const subs = detectSubscriptions(ts, '2026-11', cats);
    expect(subs.map((s) => s.merchant)).toEqual(['NETFLIX']);
    expect(subs[0].annual).toBe(1490 * 12);
  });
  it('増えたカテゴリと手数料', () => {
    const cur = [txn({ categoryId: 'a', amount: 5000 }), txn({ merchant: '年会費', amount: 1100 }), txn({ payType: 'revo' })];
    const prev = [txn({ categoryId: 'a', amount: 2000 })];
    expect(increases(cur, prev)[0]).toMatchObject({ categoryId: 'a', diff: 3000 });
    expect(feeTxns(cur)).toHaveLength(2);
  });
});

describe('バックアップの検証', () => {
  const snap = {
    cards: [card],
    categories: [{ id: 'k1', name: '食費', color: '#0ABAB5', order: 0 }],
    txns: [txn({ categoryId: 'k1' })],
    rules: [],
    goals: [{ id: 'default' as const, total: 90000, byCategory: { k1: 30000 } }],
    actions: [],
    advice: [],
    settings: [{ id: 'app' as const, autoLockSec: 60, claudeIncludeMerchants: false }],
  };

  it('書き出して読み戻せる', async () => {
    const blob = await exportBackup(snap, 'backup-pass');
    const back = await importBackup(await blob.text(), 'backup-pass');
    expect(back.txns[0].amount).toBe(1000);
    expect(back.goals[0].total).toBe(90000);
  });

  it('不正な値・存在しないカードへの参照・余計な項目を拒否', () => {
    expect(() => validateSnapshot({ ...snap, txns: [txn({ amount: 1.5 })] })).toThrow();
    expect(() => validateSnapshot({ ...snap, txns: [txn({ cardId: 'nope' })] })).toThrow();
    expect(() => validateSnapshot({ ...snap, evil: [] })).toThrow();
    expect(() => validateSnapshot({ ...snap, categories: [{ ...snap.categories[0], color: 'red;background:url(x)' }] })).toThrow();
    expect(() => validateSnapshot({ ...snap, cards: [{ ...card, id: '../x' }] })).toThrow();
  });
});
