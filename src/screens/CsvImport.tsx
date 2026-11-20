import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Field, toast, useCards } from '../components/ui';
import { decodeCsv, detectMapping, extractRows, guessBillMonth, MAX_CSV_BYTES, parseCsv, planImport, type CsvMapping } from '../lib/csv';
import { dayLabel, ymLabel } from '../lib/dates';
import { fmtYen } from '../lib/format';
import { store, useTable } from '../lib/store';

export function CsvImport() {
  const cards = useCards();
  const txns = useTable('txns');
  const rules = useTable('rules');
  const fileRef = useRef<HTMLInputElement>(null);
  const [cardId, setCardId] = useState(cards[0]?.id ?? '');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<CsvMapping | null>(null);
  const [billMonth, setBillMonth] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const card = cards.find((c) => c.id === cardId);
  const parsed = useMemo(() => (rows && map ? extractRows(rows, map) : []), [rows, map]);
  const plan = useMemo(
    () => (card && billMonth && parsed.length ? planImport(parsed, card, billMonth, txns, rules) : null),
    [card, billMonth, parsed, txns, rules],
  );

  const reset = () => {
    setRows(null);
    setMap(null);
    setFileName('');
    setBillMonth('');
  };

  const onFile = async (f: File) => {
    setErr('');
    if (f.size > MAX_CSV_BYTES) return setErr('ファイルが大きすぎます（5MBまで）');
    try {
      const r = parseCsv(decodeCsv(await f.arrayBuffer()));
      const m = detectMapping(r);
      setRows(r);
      setMap(m);
      setFileName(f.name);
      const ex = extractRows(r, m);
      if (!ex.length) setErr('明細を読み取れませんでした。下で列の対応を選び直してください。');
      if (card) setBillMonth(guessBillMonth(ex, card) ?? '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '読み込めませんでした');
    }
  };

  const header = rows && map ? (map.headerRow >= 0 ? rows[map.headerRow] : rows.find((r) => r.length > 1) ?? []) : [];
  const colOptions = header.map((h, i) => [i, map && map.headerRow >= 0 ? `${i + 1}列目：${h.slice(0, 16)}` : `${i + 1}列目（例：${h.slice(0, 12)}）`] as const);
  const setCol = (k: keyof CsvMapping, v: number) => map && setMap({ ...map, [k]: v });

  return (
    <div className="col gap-12">
      <ol className="howto">
        <li>カード会社の会員ページから、明細のCSVをダウンロード</li>
        <li>下の「CSVファイルを選ぶ」から、ファイルAppのダウンロードを開く</li>
        <li>内容を確認して取り込む</li>
      </ol>
      <p className="tiny sub">手入力した明細とは、同じ金額・利用日の差が3日以内なら自動でまとめます。同じCSVを2回取り込んでも重複しません。</p>
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
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <button className="btn ghost block" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" /> {fileName ? `選択中：${fileName}` : 'CSVファイルを選ぶ'}
      </button>
      {err && (
        <p className="small danger" role="alert">
          {err}
        </p>
      )}

      {rows && map && (
        <>
          <details>
            <summary className="small" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
              列の対応（自動で判定済み）
            </summary>
            <div className="col gap-8">
              {(
                [
                  ['date', '利用日'],
                  ['merchant', '店名'],
                  ['amount', '請求金額'],
                  ['payType', '支払方法'],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <select className="input" value={map[k]} onChange={(e) => setCol(k, Number(e.target.value))}>
                    <option value={-1}>（なし）</option>
                    {colOptions.map(([i, l]) => (
                      <option key={i} value={i}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </details>

          <Field label="請求月" hint="CSVが何月の請求分かを選びます。分割払いなどで古い利用日の明細も、この月の請求として記録します。">
            <input className="input" type="month" value={billMonth} onChange={(e) => setBillMonth(e.target.value)} />
          </Field>

          {parsed.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>利用日</th>
                    <th>店名</th>
                    <th>金額</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      <td>{dayLabel(r.date)}</td>
                      <td>{r.merchant}</td>
                      <td>{fmtYen(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan && (
            <div className="card soft col gap-4">
              <span className="small">
                {ymLabel(billMonth)}請求分 ・ {parsed.length}件 ・ 合計 <b className="num">{fmtYen(parsed.reduce((a, r) => a + r.amount, 0))}</b>
              </span>
              <span className="small">新しく追加：{plan.added.length}件</span>
              <span className="small">手入力とまとめる：{plan.matched.length}件</span>
              {plan.duplicates > 0 && <span className="small sub">取り込み済みのため除外：{plan.duplicates}件</span>}
            </div>
          )}

          <div className="row">
            <button
              className="btn grow"
              disabled={busy || !plan || plan.added.length + plan.matched.length === 0}
              onClick={async () => {
                if (!plan) return;
                setBusy(true);
                try {
                  await store.apply([{ t: 'txns', put: [...plan.added, ...plan.matched.map((m) => m.after)] }]);
                  toast(`${plan.added.length + plan.matched.length}件を取り込みました`);
                  reset();
                } finally {
                  setBusy(false);
                }
              }}
            >
              取り込む
            </button>
            <button className="btn ghost" onClick={reset}>
              やめる
            </button>
          </div>
        </>
      )}
    </div>
  );
}
