import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { CatDot, Field, Seg, Sheet, toast, useCards, useCategories } from '../components/ui';
import { billMonthFor } from '../lib/billing';
import { learnRule, normalizeMerchant, suggestCategory } from '../lib/categorize';
import { randomId } from '../lib/crypto';
import { isValidDate, todayKey, ymLabel } from '../lib/dates';
import { cleanMultiline, cleanText, parseYen } from '../lib/format';
import { store, useTable, type Op } from '../lib/store';
import { PAY_LABEL, type Need, type PayType, type Txn } from '../lib/types';

export function TxnSheet({ txn, onClose }: { txn: Txn | null; onClose: () => void }) {
  const cards = useCards();
  const cats = useCategories();
  const rules = useTable('rules');
  const txns = useTable('txns');

  const [amount, setAmount] = useState(txn ? String(Math.abs(txn.amount)) : '');
  const [refund, setRefund] = useState(!!txn && txn.amount < 0);
  const [merchant, setMerchant] = useState(txn?.merchant ?? '');
  const [date, setDate] = useState(txn?.date ?? todayKey());
  const [cardId, setCardId] = useState(txn?.cardId ?? cards[0]?.id ?? '');
  const [pickedCat, setPickedCat] = useState<string | undefined>(txn?.categoryId);
  const [payType, setPayType] = useState<PayType>(txn?.payType ?? 'once');
  const [need, setNeed] = useState<Need | undefined>(txn?.need);
  const [memo, setMemo] = useState(txn?.memo ?? '');
  const [status, setStatus] = useState<Txn['status']>(txn?.status ?? 'pending');
  const [busy, setBusy] = useState(false);

  const suggested = useMemo(() => suggestCategory(merchant, rules, txns), [merchant, rules, txns]);
  const categoryId = pickedCat ?? suggested;

  // よく使う店（直近 90 日の回数順）
  const frequent = useMemo(() => {
    const since = Date.now() - 90 * 86400_000;
    const m = new Map<string, { name: string; n: number }>();
    for (const t of txns) {
      if (t.createdAt < since) continue;
      const k = normalizeMerchant(t.merchant);
      m.set(k, { name: t.merchant, n: (m.get(k)?.n ?? 0) + 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 6).map((x) => x.name);
  }, [txns]);

  const card = cards.find((c) => c.id === cardId);
  const yen = parseYen(amount);
  const valid = yen != null && yen > 0 && !!card && isValidDate(date) && cleanText(merchant, 100) !== '';
  const keepBillMonth = txn?.status === 'confirmed' && txn.cardId === cardId;
  const billMonth = card && isValidDate(date) ? (keepBillMonth ? txn!.billMonth : billMonthFor(date, card)) : '';

  const save = async () => {
    if (!valid || !card || yen == null) return;
    setBusy(true);
    try {
      const now = Date.now();
      const name = cleanText(merchant, 100);
      const next: Txn = {
        id: txn?.id ?? randomId(),
        cardId,
        date,
        billMonth,
        merchant: name,
        amount: refund ? -yen : yen,
        categoryId,
        payType,
        need,
        memo: cleanMultiline(memo, 500) || undefined,
        source: txn?.source ?? 'manual',
        status,
        importKey: txn?.importKey,
        createdAt: txn?.createdAt ?? now,
        updatedAt: now,
      };
      const ops: Op[] = [{ t: 'txns', put: [next] }];
      // 推定と違うカテゴリを選んだら、その店のルールとして覚える
      if (pickedCat && pickedCat !== suggested) {
        const rule = learnRule(name, pickedCat, rules);
        if (rule) ops.push({ t: 'rules', put: [rule] });
      }
      await store.apply(ops);
      toast(txn ? '更新しました' : '記録しました');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={txn ? '明細を編集' : '支出を記録'} onClose={onClose}>
      <div className="col gap-4">
        <div className="row">
          <span className="num" style={{ fontSize: '1.8667rem' }}>
            {refund ? '−¥' : '¥'}
          </span>
          <input
            className="amount-input"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="金額（円）"
            placeholder="0"
            value={amount}
            maxLength={11}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d,０-９]/g, ''))}
            autoFocus={!txn}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
          返金・取り消し
        </label>
      </div>

      <Field label="お店・内容">
        <input className="input" value={merchant} maxLength={100} placeholder="例：スーパー〇〇" onChange={(e) => setMerchant(e.target.value)} />
      </Field>
      {!txn && frequent.length > 0 && (
        <div className="chips" aria-label="よく使う店">
          {frequent.map((f) => (
            <button key={f} onClick={() => setMerchant(f)} className={f === merchant ? 'on' : ''}>
              {f}
            </button>
          ))}
        </div>
      )}

      <Field label={pickedCat ? 'カテゴリ' : suggested ? 'カテゴリ（自動で推定）' : 'カテゴリ'} group>
        <div className="chips">
          {cats.list.map((c) => (
            <button key={c.id} className={categoryId === c.id ? 'on' : ''} aria-pressed={categoryId === c.id} onClick={() => setPickedCat(c.id)}>
              <CatDot cat={c} />
              {c.name}
            </button>
          ))}
        </div>
      </Field>

      <div className="row gap-12">
        <Field label="利用日">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {cards.length > 1 && (
          <Field label="カード">
            <select className="input" value={cardId} onChange={(e) => setCardId(e.target.value)}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {billMonth && <p className="tiny sub">{ymLabel(billMonth)}の請求になります</p>}

      <Field label="支払方法" group>
        <Seg label="支払方法" value={payType} onChange={setPayType} options={Object.entries(PAY_LABEL) as [PayType, string][]} />
      </Field>

      <Field label="振り返り" group>
        <Seg
          label="振り返り"
          value={need ?? 'none'}
          onChange={(v) => setNeed(v === 'none' ? undefined : (v as Need))}
          options={[
            ['none', '未評価'],
            ['need', '必要だった'],
            ['want', '不要だった'],
          ]}
        />
      </Field>

      <Field label="メモ">
        <input className="input" value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
      </Field>

      {txn?.source !== 'csv' && (
        <Field
          label="状態"
          group
          hint={
            status === 'pending'
              ? 'カードの明細で請求を確認できたら「確定」にしてください。CSVを取り込んだ場合は、同じ金額・近い日付の明細と自動でまとめて確定します。'
              : '確定した明細は、CSVを取り込んでも照合の対象になりません。'
          }
        >
          <Seg
            label="状態"
            value={status}
            onChange={setStatus}
            options={[
              ['pending', '照合待ち'],
              ['confirmed', '確定'],
            ]}
          />
        </Field>
      )}

      <button className="btn block" disabled={!valid || busy} onClick={save}>
        {txn ? '保存する' : '記録する'}
      </button>
      {txn && (
        <button
          className="btn ghost block danger"
          onClick={async () => {
            if (!confirm('この明細を削除しますか？')) return;
            await store.remove('txns', txn.id);
            toast('削除しました');
            onClose();
          }}
        >
          <Icon name="trash" /> 削除
        </button>
      )}
    </Sheet>
  );
}
