import { useMemo } from 'react';
import { Icon } from '../components/Icon';
import { CatDot, useCards, useCategories } from '../components/ui';
import { byCategory, detectSubscriptions, increases, inMonth, sum, suggestions } from '../lib/analysis';
import { payDateFor } from '../lib/billing';
import { addMonths, dayLabel, monthLabel } from '../lib/dates';
import { fmtDiff, fmtNum, fmtYen } from '../lib/format';
import { store, useSettings, useTable } from '../lib/store';
import type { Txn } from '../lib/types';
import { NeedToggle } from '../components/ui';

type Props = {
  month: string;
  setMonth: (m: string) => void;
  onEdit: (t: Txn) => void;
  onOpenSettings: () => void;
  onGo: (tab: 'txns' | 'review' | 'analysis') => void;
};

export function Home({ month, setMonth, onEdit, onOpenSettings, onGo }: Props) {
  const txns = useTable('txns');
  const cards = useCards();
  const cats = useCategories();
  const settings = useSettings();
  const goal = useTable('goals')[0];

  const d = useMemo(() => {
    const cur = inMonth(txns, month);
    const prev = inMonth(txns, addMonths(month, -1));
    const total = sum(cur);
    const subs = detectSubscriptions(txns, month, cats.list);
    const cat = byCategory(cur).filter((c) => c.amount > 0);
    const top = cat.slice(0, 3);
    const rest = cat.slice(3).reduce((a, c) => a + c.amount, 0);
    return {
      cur,
      total,
      prevTotal: sum(prev),
      hasPrev: prev.length > 0,
      pending: cur.filter((t) => t.status === 'pending').length,
      top,
      rest,
      positive: cat.reduce((a, c) => a + c.amount, 0),
      inc: increases(cur, prev).slice(0, 3),
      sugg: suggestions({ cur, prev, subs, catName: cats.name, goalTotal: goal?.total })[0],
      recent: [...cur].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5),
    };
  }, [txns, month, cats, goal]);

  const goalTotal = goal?.total;
  const ratio = goalTotal ? Math.min(1, d.total / goalTotal) : 0;
  const over = goalTotal ? d.total > goalTotal : false;
  const payDate = cards.length === 1 ? payDateFor(month, cards[0]) : null;
  const backupDue = store.all('txns').length > 0 && (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > 30 * 86400_000);

  return (
    <>
      <section className="hero">
        <div className="row between">
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn" aria-label="前の月" onClick={() => setMonth(addMonths(month, -1))}>
              <Icon name="left" size={18} />
            </button>
            <h1 style={{ fontSize: 17, padding: '0 6px' }}>{monthLabel(month)}の請求</h1>
            <button className="icon-btn" aria-label="次の月" onClick={() => setMonth(addMonths(month, 1))}>
              <Icon name="right" size={18} />
            </button>
          </div>
          <button className="icon-btn" aria-label="設定" onClick={onOpenSettings}>
            <Icon name="gear" size={20} />
          </button>
        </div>
        <div className="hero-amount">
          <span className="num yen">¥</span>
          <span className="num big">{fmtNum(d.total)}</span>
        </div>
        {payDate && <p className="small" style={{ marginTop: -8, fontWeight: 700 }}>{dayLabel(payDate)} 引き落とし</p>}
        {goalTotal ? (
          <div className="col gap-4">
            <div className={`hero-bar ${over ? 'over' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={goalTotal} aria-valuenow={d.total} aria-label="目標に対する請求額">
              <div style={{ width: `${ratio * 100}%` }} />
            </div>
            <div className="row between small" style={{ fontWeight: 700 }}>
              <span>目標 {fmtYen(goalTotal)}</span>
              <span>{over ? `${fmtYen(d.total - goalTotal)} 超過` : `あと ${fmtYen(goalTotal - d.total)}`}</span>
            </div>
          </div>
        ) : (
          <button className="pill" style={{ alignSelf: 'flex-start' }} onClick={onOpenSettings}>
            目標額を設定する
          </button>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {d.hasPrev && <span className="pill dark">前月比 {fmtDiff(d.total - d.prevTotal)}</span>}
          {d.pending > 0 && (
            <button className="pill" onClick={() => onGo('txns')}>
              照合待ち {d.pending}件
            </button>
          )}
        </div>
      </section>

      <div className="page">
        {backupDue && (
          <button className="notice warn row" style={{ border: 0, textAlign: 'left' }} onClick={onOpenSettings}>
            <Icon name="download" size={18} />
            <span className="grow">しばらくバックアップしていません。設定から暗号化バックアップを書き出しましょう。</span>
          </button>
        )}

        {d.cur.length === 0 ? (
          <div className="empty">
            <p>この月の明細はまだありません。</p>
            <p className="small">下の＋で手入力するか、設定からCSVを取り込んでください。</p>
          </div>
        ) : (
          <>
            {d.positive > 0 && (
              <section className="col gap-8">
                <h2>カテゴリ別</h2>
                <div className="stack-bar" aria-hidden="true">
                  {d.top.map((c) => (
                    <div key={c.categoryId ?? 'none'} style={{ width: `${(c.amount / d.positive) * 100}%`, background: cats.color(c.categoryId) }} />
                  ))}
                  {d.rest > 0 && <div style={{ width: `${(d.rest / d.positive) * 100}%`, background: '#C8D3D2' }} />}
                </div>
                <div className="legend">
                  {d.top.map((c) => (
                    <div key={c.categoryId ?? 'none'}>
                      <span className="dot" style={{ background: cats.color(c.categoryId) }} />
                      <span className="ellipsis">{cats.name(c.categoryId)}</span>
                      <b>{fmtYen(c.amount)}</b>
                    </div>
                  ))}
                  {d.rest > 0 && (
                    <div>
                      <span className="dot" style={{ background: '#C8D3D2' }} />
                      <span>ほか</span>
                      <b>{fmtYen(d.rest)}</b>
                    </div>
                  )}
                </div>
              </section>
            )}

            {d.sugg && (
              <section className="card strong col gap-8">
                <span className="eyebrow">見直し候補</span>
                <h3 style={{ fontSize: 16 }}>{d.sugg.title}</h3>
                <p className="small sub">{d.sugg.detail}</p>
                <button className="btn small" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => onGo('review')}>
                  確認する
                </button>
              </section>
            )}

            {d.inc.length > 0 && (
              <section className="col">
                <h2>先月より増えたもの</h2>
                <div className="list">
                  {d.inc.map((c) => (
                    <div className="list-row" key={c.categoryId ?? 'none'}>
                      <CatDot cat={cats.map.get(c.categoryId ?? '')} />
                      <span className="grow">{cats.name(c.categoryId)}</span>
                      <span className="num warn">{fmtDiff(c.diff)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="col">
              <div className="row between">
                <h2>最近の明細</h2>
                <button className="link-btn" onClick={() => onGo('txns')}>
                  すべて見る
                </button>
              </div>
              <div className="list">
                {d.recent.map((t) => (
                  <div className="list-row" key={t.id}>
                    <button className="grow col" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', minHeight: 44 }} onClick={() => onEdit(t)}>
                      <span className="ellipsis">{t.merchant}</span>
                      <span className="cat-chip">
                        <CatDot cat={cats.map.get(t.categoryId ?? '')} />
                        {cats.name(t.categoryId)} ・ {dayLabel(t.date)}
                        {t.status === 'pending' && ' ・ 照合待ち'}
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
          </>
        )}
      </div>
    </>
  );
}
