import { useMemo, useState } from 'react';
import { CatDot, MonthSwitch, NeedToggle, Seg, useCards, useCategories } from '../components/ui';
import { inMonth, sum } from '../lib/analysis';
import { dayLabel } from '../lib/dates';
import { fmtYen } from '../lib/format';
import { useTable } from '../lib/store';
import { PAY_LABEL, type Txn } from '../lib/types';

type Filter = 'all' | 'pending' | 'unrated' | 'want';

export function Txns({ month, setMonth, onEdit }: { month: string; setMonth: (m: string) => void; onEdit: (t: Txn) => void }) {
  const txns = useTable('txns');
  const cards = useCards();
  const cats = useCategories();
  const [filter, setFilter] = useState<Filter>('all');
  const [cardId, setCardId] = useState('');

  const list = useMemo(() => {
    let xs = inMonth(txns, month, cardId || undefined);
    if (filter === 'pending') xs = xs.filter((t) => t.status === 'pending');
    if (filter === 'unrated') xs = xs.filter((t) => !t.need);
    if (filter === 'want') xs = xs.filter((t) => t.need === 'want');
    xs.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const groups: { date: string; items: Txn[] }[] = [];
    for (const t of xs) {
      const g = groups[groups.length - 1];
      if (g?.date === t.date) g.items.push(t);
      else groups.push({ date: t.date, items: [t] });
    }
    return { groups, total: sum(xs), count: xs.length };
  }, [txns, month, cardId, filter]);

  return (
    <>
      <header className="page-head">
        <h1>明細</h1>
        <MonthSwitch value={month} onChange={setMonth} />
      </header>
      <div className="page">
        <Seg
          label="絞り込み"
          value={filter}
          onChange={setFilter}
          options={[
            ['all', 'すべて'],
            ['unrated', '未評価'],
            ['want', '不要'],
            ['pending', '照合待ち'],
          ]}
        />
        {cards.length > 1 && (
          <select className="input" aria-label="カード" value={cardId} onChange={(e) => setCardId(e.target.value)}>
            <option value="">すべてのカード</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <div className="row between">
          <span className="sub small">{list.count}件</span>
          <span className="num" style={{ fontSize: 20 }}>
            {fmtYen(list.total)}
          </span>
        </div>
        {list.groups.length === 0 && <p className="empty">該当する明細はありません</p>}
        {list.groups.map((g) => (
          <section key={g.date} className="col">
            <h3 className="sub small">{dayLabel(g.date)}</h3>
            <div className="list">
              {g.items.map((t) => (
                <div className="list-row" key={t.id}>
                  <button className="grow col" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', minHeight: 44 }} onClick={() => onEdit(t)}>
                    <span className="ellipsis">{t.merchant}</span>
                    <span className="cat-chip">
                      <CatDot cat={cats.map.get(t.categoryId ?? '')} />
                      {cats.name(t.categoryId)}
                      {t.payType !== 'once' && ` ・ ${PAY_LABEL[t.payType]}`}
                      {t.status === 'pending' && <span className="teal-text"> ・ 照合待ち</span>}
                    </span>
                  </button>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <span className="num">{fmtYen(t.amount)}</span>
                    <NeedToggle txn={t} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
