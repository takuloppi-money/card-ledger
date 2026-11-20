import { useMemo } from 'react';
import { CatDot, MonthSwitch, useCategories } from '../components/ui';
import { byCategory, byMerchant, detectSubscriptions, inMonth, monthlyTotals } from '../lib/analysis';
import { addMonths, monthLabel } from '../lib/dates';
import { fmtDiff, fmtYen } from '../lib/format';
import { useTable } from '../lib/store';
import type { Txn } from '../lib/types';

export function Analysis({ month, setMonth }: { month: string; setMonth: (m: string) => void; onEdit: (t: Txn) => void }) {
  const txns = useTable('txns');
  const cats = useCategories();
  const goal = useTable('goals')[0];

  const d = useMemo(() => {
    const cur = inMonth(txns, month);
    const prev = inMonth(txns, addMonths(month, -1));
    const prevCat = new Map(byCategory(prev).map((c) => [c.categoryId, c.amount]));
    return {
      months: monthlyTotals(txns, month, 6),
      cats: byCategory(cur).map((c) => ({ ...c, diff: c.amount - (prevCat.get(c.categoryId) ?? 0) })),
      merchants: byMerchant(cur).slice(0, 10),
      subs: detectSubscriptions(txns, month, cats.list),
    };
  }, [txns, month, cats]);

  const max = Math.max(1, ...d.months.map((m) => m.total), goal?.total ?? 0);
  const subsAnnual = d.subs.reduce((a, s) => a + s.annual, 0);

  return (
    <>
      <header className="page-head">
        <h1>分析</h1>
        <MonthSwitch value={month} onChange={setMonth} />
      </header>
      <div className="page">
        <section className="card col gap-8">
          <div className="row between tiny sub">
            <span>直近6か月の請求額</span>
            {goal?.total ? <span>点線：目標 {fmtYen(goal.total)}</span> : null}
          </div>
          <div className="bars" role="img" aria-label={d.months.map((m) => `${monthLabel(m.ym)} ${fmtYen(m.total)}`).join('、')}>
            {goal?.total ? <div className="goal-line" style={{ bottom: `${(goal.total / max) * 100}%` }} /> : null}
            {d.months.map((m) => (
              <div key={m.ym} className={`bar ${m.ym === month ? 'on' : ''}`} style={{ height: `${(Math.max(0, m.total) / max) * 100}%` }} />
            ))}
          </div>
          <div className="bar-labels">
            {d.months.map((m) => (
              <button
                key={m.ym}
                className={m.ym === month ? 'on' : ''}
                style={{ background: 'none', border: 0, padding: '4px 0', color: 'inherit', font: 'inherit', fontWeight: 'inherit', minHeight: 44 }}
                onClick={() => setMonth(m.ym)}
              >
                {monthLabel(m.ym)}
                <br />
                <span className="num" style={{ fontSize: '0.6667rem' }}>
                  {m.total ? `${Math.round(m.total / 1000)}k` : '-'}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="col">
          <h2>カテゴリ別</h2>
          {d.cats.length === 0 && <p className="empty">明細がありません</p>}
          <div className="list">
            {d.cats.map((c) => (
              <div className="list-row" key={c.categoryId ?? 'none'}>
                <CatDot cat={cats.map.get(c.categoryId ?? '')} />
                <span className="grow">
                  {cats.name(c.categoryId)} <span className="tiny sub">{c.count}件</span>
                </span>
                <div className="col" style={{ alignItems: 'flex-end' }}>
                  <span className="num">{fmtYen(c.amount)}</span>
                  <span className={`tiny ${c.diff > 0 ? 'warn' : 'teal-text'}`}>前月 {fmtDiff(c.diff)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="col">
          <h2>お店ランキング</h2>
          <div className="list">
            {d.merchants.map((m, i) => (
              <div className="list-row" key={m.merchant}>
                <span className="num sub" style={{ width: 20 }}>
                  {i + 1}
                </span>
                <span className="grow ellipsis">
                  {m.merchant} <span className="tiny sub">{m.count}回</span>
                </span>
                <span className="num">{fmtYen(m.amount)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="col">
          <div className="row between">
            <h2>定期的な支払い</h2>
            {d.subs.length > 0 && <span className="small sub">年額 {fmtYen(subsAnnual)}</span>}
          </div>
          {d.subs.length === 0 ? (
            <p className="small sub">3か月以上続けて同じくらいの金額を払っているお店を、自動で見つけて表示します。</p>
          ) : (
            <div className="list">
              {d.subs.map((s) => (
                <div className="list-row" key={s.key}>
                  <CatDot cat={cats.map.get(s.categoryId ?? '')} />
                  <span className="grow ellipsis">{s.merchant}</span>
                  <div className="col" style={{ alignItems: 'flex-end' }}>
                    <span className="num">{fmtYen(s.monthly)}/月</span>
                    <span className="tiny sub">年 {fmtYen(s.annual)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
