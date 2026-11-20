import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Field, MonthSwitch, toast, useCategories } from '../components/ui';
import { detectSubscriptions, feeTxns, inMonth, sum, suggestions } from '../lib/analysis';
import { randomId } from '../lib/crypto';
import { addMonths, dayLabel, todayKey, ymLabel } from '../lib/dates';
import { cleanMultiline, cleanText, fmtYen, parseYen } from '../lib/format';
import { buildClaudeReport } from '../lib/report';
import { store, useSettings, useTable } from '../lib/store';
import { PAY_LABEL, type Txn } from '../lib/types';

function monthsBetween(fromYm: string, toYm: string) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return ty * 12 + tm - (fy * 12 + fm);
}

export function Review({ month, setMonth, onEdit }: { month: string; setMonth: (m: string) => void; onEdit: (t: Txn) => void }) {
  const txns = useTable('txns');
  const actions = useTable('actions');
  const cats = useCategories();
  const goal = useTable('goals')[0];

  const d = useMemo(() => {
    const cur = inMonth(txns, month);
    const prev = inMonth(txns, addMonths(month, -1));
    const subs = detectSubscriptions(txns, month, cats.list);
    return {
      sugg: suggestions({ cur, prev, subs, catName: cats.name, goalTotal: goal?.total }),
      fees: feeTxns(cur),
      wants: cur.filter((t) => t.need === 'want').sort((a, b) => b.amount - a.amount),
    };
  }, [txns, month, cats, goal]);

  const sortedActions = [...actions].sort((a, b) => b.date.localeCompare(a.date));
  const thisYm = todayKey().slice(0, 7);
  const saved = actions.reduce((a, x) => a + x.monthlySaving * Math.max(0, monthsBetween(x.date.slice(0, 7), thisYm)), 0);

  return (
    <>
      <header className="page-head">
        <h1>見直し</h1>
        <MonthSwitch value={month} onChange={setMonth} />
      </header>
      <div className="page">
        <section className="col gap-12">
          {d.sugg.length === 0 && <p className="empty">今のところ見直し候補はありません</p>}
          {d.sugg.map((s, i) => (
            <div key={i} className={`card col gap-4 ${i === 0 ? 'strong' : ''}`}>
              <span className="eyebrow">見直し候補</span>
              <h3>{s.title}</h3>
              <p className="small sub">{s.detail}</p>
              {s.annual ? <p className="small teal-text">年間 {fmtYen(s.annual)} の削減余地</p> : null}
            </div>
          ))}
        </section>

        {d.fees.length > 0 && (
          <section className="col">
            <h2>手数料・リボ・分割</h2>
            <div className="list">
              {d.fees.map((t) => (
                <button className="list-row" key={t.id} onClick={() => onEdit(t)}>
                  <span className="grow ellipsis">
                    {t.merchant} <span className="tiny sub">{PAY_LABEL[t.payType]}</span>
                  </span>
                  <span className="num warn">{fmtYen(t.amount)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {d.wants.length > 0 && (
          <section className="col">
            <div className="row between">
              <h2>なくてもよかった支出</h2>
              <span className="num warn">{fmtYen(sum(d.wants))}</span>
            </div>
            <div className="list">
              {d.wants.slice(0, 10).map((t) => (
                <button className="list-row" key={t.id} onClick={() => onEdit(t)}>
                  <span className="grow ellipsis">
                    {t.merchant} <span className="tiny sub">{dayLabel(t.date)}</span>
                  </span>
                  <span className="num">{fmtYen(t.amount)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="card soft col gap-12">
          <div className="row between">
            <h2>削減メモ</h2>
            <span className="small">
              累計 <b className="num teal-text">{fmtYen(saved)}</b>
            </span>
          </div>
          <p className="tiny sub">解約・プラン変更など、実行したことを記録します。月の削減見込み額から、これまでに浮いた金額を計算します。</p>
          <ActionForm />
          <div className="list">
            {sortedActions.map((a) => (
              <div className="list-row" key={a.id}>
                <span className="grow">
                  {a.text}
                  <br />
                  <span className="tiny sub">
                    {ymLabel(a.date.slice(0, 7))}〜 ・ 月 {fmtYen(a.monthlySaving)}
                  </span>
                </span>
                <button
                  className="icon-btn plain"
                  aria-label={`「${a.text}」を削除`}
                  onClick={() => confirm('この削減メモを削除しますか？') && store.remove('actions', a.id)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <ClaudeAdvisor month={month} />
      </div>
    </>
  );
}

function ActionForm() {
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const yen = parseYen(amount);
  const ok = cleanText(text, 200) !== '' && yen != null && yen >= 0;
  return (
    <form
      className="col gap-8"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || yen == null) return;
        await store.put('actions', { id: randomId(), date: todayKey(), text: cleanText(text, 200), monthlySaving: yen, createdAt: Date.now() });
        setText('');
        setAmount('');
        toast('記録しました');
      }}
    >
      <input className="input" placeholder="例：動画サブスクを1つ解約" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} aria-label="実行したこと" />
      <div className="row">
        <input className="input grow" inputMode="numeric" placeholder="月の削減額（円）" value={amount} maxLength={11} onChange={(e) => setAmount(e.target.value)} aria-label="月の削減額（円）" />
        <button className="btn" disabled={!ok}>
          追加
        </button>
      </div>
    </form>
  );
}

function ClaudeAdvisor({ month }: { month: string }) {
  const settings = useSettings();
  const txns = useTable('txns');
  const cats = useCategories();
  const goal = useTable('goals')[0];
  const actions = useTable('actions');
  const advice = useTable('advice').find((a) => a.id === month);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');

  const text = useMemo(
    () =>
      open
        ? buildClaudeReport({ billMonth: month, txns, categories: cats.list, goal, actions, includeMerchants: settings.claudeIncludeMerchants })
        : '',
    [open, month, txns, cats, goal, actions, settings.claudeIncludeMerchants],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('コピーしました。Claudeアプリに貼り付けてください');
    } catch {
      toast('コピーできませんでした');
    }
  };
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
    await copy();
  };

  return (
    <section className="card col gap-12">
      <div className="row gap-8">
        <Icon name="spark" />
        <h2 className="grow">Claudeに相談</h2>
      </div>
      {advice && !open && (
        <div className="col gap-8">
          <span className="eyebrow">{ymLabel(month)}のアドバイス</span>
          <p className="small pre">{advice.text}</p>
        </div>
      )}
      {!open ? (
        <button className="btn ghost block" onClick={() => setOpen(true)}>
          {advice ? 'もう一度相談する' : `${ymLabel(month)}分のまとめを作る`}
        </button>
      ) : (
        <>
          <p className="notice warn small">
            送信ボタンを押すと、下の文章が<b>Claude（外部のサービス）に送られます</b>。アプリが自動で送ることはありません。中身を確認してから送ってください。
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.claudeIncludeMerchants}
              onChange={(e) => store.put('settings', { ...settings, claudeIncludeMerchants: e.target.checked })}
            />
            店名も含める（より具体的な助言になります）
          </label>
          <textarea className="input" readOnly value={text} aria-label="送信する内容" style={{ minHeight: 220, fontSize: 13 }} />
          <div className="row">
            <button className="btn grow" onClick={share}>
              <Icon name="share" /> Claudeに送る
            </button>
            <button className="btn ghost" onClick={copy} aria-label="コピー">
              <Icon name="copy" />
            </button>
          </div>
          <Field label="Claudeの回答を貼り付けて保存（任意）">
            <textarea className="input" value={reply} maxLength={20000} onChange={(e) => setReply(e.target.value)} />
          </Field>
          <div className="row">
            <button
              className="btn grow"
              disabled={!reply.trim()}
              onClick={async () => {
                await store.put('advice', { id: month, text: cleanMultiline(reply, 20000), createdAt: Date.now() });
                setReply('');
                setOpen(false);
                toast('保存しました');
              }}
            >
              回答を保存
            </button>
            <button className="btn ghost" onClick={() => setOpen(false)}>
              閉じる
            </button>
          </div>
        </>
      )}
    </section>
  );
}
