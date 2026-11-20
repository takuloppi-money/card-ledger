import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { CatDot, Field, FullPage, Group, Seg, toast, useCards, useCategories } from '../components/ui';
import { termsLabel } from '../lib/billing';
import { biometricAvailable } from '../lib/biometric';
import { normalizeMerchant } from '../lib/categorize';
import { randomId } from '../lib/crypto';
import { cleanText, parseYen } from '../lib/format';
import { changeSecret, disableBiometric, enableBiometric, getLockMeta, validateSecret, wipeAll, type LockMeta, type SecretMode } from '../lib/lock';
import { store, useSettings, useTable } from '../lib/store';
import type { Card } from '../lib/types';
import { BackupExport, BackupRestore } from './BackupPanel';
import { CardForm } from './CardForm';
import { CsvImport } from './CsvImport';

type Section = 'cards' | 'cats' | 'goal' | 'csv' | 'lock' | 'backup' | 'restore' | 'about' | null;

export function Settings({ onClose, onLock }: { onClose: () => void; onLock: () => void }) {
  const [open, setOpen] = useState<Section>(null);
  const toggle = (s: Section) => setOpen(open === s ? null : s);

  return (
    <FullPage title="設定" onClose={onClose}>
      <div className="page" style={{ paddingTop: 0, paddingBottom: 12 }}>
        <button className="btn ink block" onClick={onLock}>
          <Icon name="lock" /> 今すぐロック
        </button>
      </div>
      <Group title="CSVを取り込む" open={open === 'csv'} onToggle={() => toggle('csv')}>
        <CsvImport />
      </Group>
      <Group title="カード" open={open === 'cards'} onToggle={() => toggle('cards')}>
        <Cards />
      </Group>
      <Group title="目標額" open={open === 'goal'} onToggle={() => toggle('goal')}>
        <GoalForm />
      </Group>
      <Group title="カテゴリと自動分類" open={open === 'cats'} onToggle={() => toggle('cats')}>
        <Categories />
      </Group>
      <Group title="ロック（PIN・指紋・顔認証）" open={open === 'lock'} onToggle={() => toggle('lock')}>
        <LockSettings />
      </Group>
      <Group title="バックアップを書き出す" open={open === 'backup'} onToggle={() => toggle('backup')}>
        <BackupExport />
      </Group>
      <Group title="バックアップから復元" open={open === 'restore'} onToggle={() => toggle('restore')}>
        <BackupRestore />
      </Group>
      <Group title="データの守り方" open={open === 'about'} onToggle={() => toggle('about')}>
        <ul className="plain">
          <li>記録はこのスマホのブラウザ領域にだけ保存され、サーバーやクラウドには送られません。</li>
          <li>保存データはすべてAES-256で暗号化されています。鍵はPIN（または指紋・顔認証）からしか取り出せません。</li>
          <li>アプリは外部と通信しない設定（CSP）になっています。Claudeに送るのは、あなたが「Claudeに送る」を押したときの文章だけです。</li>
          <li>バックグラウンドに移ると画面を隠し、設定した時間がたつと自動でロックします。</li>
          <li>PINとバックアップのパスワードを両方忘れると、データは誰にも復元できません。</li>
        </ul>
      </Group>
      <div className="page" style={{ paddingTop: 24 }}>
        <section className="card col gap-8">
          <h3 className="danger">すべてのデータを削除</h3>
          <p className="small sub">明細・設定・ロックをすべて削除します。元に戻せません。</p>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('本当にすべてのデータを削除しますか？')) return;
              if (!confirm('元に戻せません。削除してよいですか？')) return;
              store.lock();
              await wipeAll();
              location.reload();
            }}
          >
            すべて削除する
          </button>
        </section>
      </div>
    </FullPage>
  );
}

function Cards() {
  const cards = useCards();
  const txns = useTable('txns');
  const [editing, setEditing] = useState<Card | 'new' | null>(null);

  if (editing) {
    return (
      <div className="col gap-12">
        <CardForm
          initial={editing === 'new' ? undefined : editing}
          order={cards.length}
          submitLabel="保存する"
          onSubmit={async (c) => {
            await store.put('cards', c);
            toast('保存しました');
            setEditing(null);
          }}
        />
        <button className="btn ghost" onClick={() => setEditing(null)}>
          キャンセル
        </button>
      </div>
    );
  }
  return (
    <div className="col gap-8">
      <p className="tiny sub">締め日を変えても、すでに記録した明細の請求月は変わりません。</p>
      <div className="list">
        {cards.map((c) => {
          const n = txns.filter((t) => t.cardId === c.id).length;
          return (
            <div className="list-row" key={c.id}>
              <button className="grow col" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', minHeight: 44 }} onClick={() => setEditing(c)}>
                <span>{c.name}</span>
                <span className="tiny sub">
                  {termsLabel(c)} ・ 明細 {n}件
                </span>
              </button>
              {cards.length > 1 && (
                <button
                  className="icon-btn plain"
                  aria-label={`${c.name}を削除`}
                  onClick={async () => {
                    if (!confirm(`「${c.name}」と、そのカードの明細 ${n}件を削除しますか？`)) return;
                    await store.apply([
                      { t: 'txns', remove: txns.filter((t) => t.cardId === c.id).map((t) => t.id) },
                      { t: 'cards', remove: [c.id] },
                    ]);
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn ghost" onClick={() => setEditing('new')}>
        <Icon name="plus" /> カードを追加
      </button>
    </div>
  );
}

function GoalForm() {
  const goal = useTable('goals')[0] ?? { id: 'default' as const, byCategory: {} };
  const cats = useCategories();
  const [total, setTotal] = useState(goal.total ? String(goal.total) : '');
  const [byCat, setByCat] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(goal.byCategory).map(([k, v]) => [k, String(v)])),
  );
  return (
    <form
      className="col gap-12"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = parseYen(total);
        const bc: Record<string, number> = {};
        for (const [k, v] of Object.entries(byCat)) {
          const n = parseYen(v);
          if (n != null && n > 0) bc[k] = n;
        }
        await store.put('goals', { id: 'default', total: t && t > 0 ? t : undefined, byCategory: bc });
        toast('保存しました');
      }}
    >
      <Field label="毎月の請求額の目標（円）">
        <input className="input" inputMode="numeric" value={total} maxLength={11} placeholder="例：90000" onChange={(e) => setTotal(e.target.value)} />
      </Field>
      <details>
        <summary className="small" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
          カテゴリごとの上限（任意）
        </summary>
        <div className="col gap-8">
          {cats.list.map((c) => (
            <label key={c.id} className="row">
              <CatDot cat={c} />
              <span className="grow small">{c.name}</span>
              <input
                className="input"
                style={{ width: 140 }}
                inputMode="numeric"
                maxLength={11}
                value={byCat[c.id] ?? ''}
                onChange={(e) => setByCat({ ...byCat, [c.id]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </details>
      <button className="btn block">保存する</button>
    </form>
  );
}

const PALETTE = ['#0ABAB5', '#E58A3A', '#C25E8A', '#5B7FD6', '#8FB33A', '#7A5BC2', '#D9A400', '#E06A5A', '#3F8F8C', '#03201F', '#2F4F6F', '#9AA9A8'];

function Categories() {
  const cats = useCategories();
  const rules = useTable('rules');
  const txns = useTable('txns');
  const [name, setName] = useState('');
  const [fixed, setFixed] = useState(false);
  const sortedRules = [...rules].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="col gap-12">
      <div className="list">
        {cats.list.map((c) => (
          <div className="list-row" key={c.id}>
            <CatDot cat={c} />
            <span className="grow">
              {c.name}
              {c.fixed && <span className="tiny sub"> ・ 固定費</span>}
            </span>
            <button
              className="icon-btn plain"
              aria-label={`${c.name}の名前を変える`}
              onClick={async () => {
                const v = prompt('新しい名前', c.name);
                const n = v == null ? '' : cleanText(v, 30);
                if (n) await store.put('categories', { ...c, name: n });
              }}
            >
              <Icon name="list" size={18} />
            </button>
            <button
              className="icon-btn plain"
              aria-label={`${c.name}を削除`}
              onClick={async () => {
                const used = txns.filter((t) => t.categoryId === c.id);
                if (!confirm(`「${c.name}」を削除しますか？${used.length ? `\n${used.length}件の明細が未分類になります。` : ''}`)) return;
                await store.apply([
                  { t: 'txns', put: used.map((t) => ({ ...t, categoryId: undefined, updatedAt: Date.now() })) },
                  { t: 'rules', remove: rules.filter((r) => r.categoryId === c.id).map((r) => r.id) },
                  { t: 'categories', remove: [c.id] },
                ]);
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </div>
      <form
        className="col gap-8"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = cleanText(name, 30);
          if (!n) return;
          await store.put('categories', {
            id: randomId(),
            name: n,
            color: PALETTE[cats.list.length % PALETTE.length],
            order: Math.max(-1, ...cats.list.map((c) => c.order)) + 1,
            fixed: fixed || undefined,
          });
          setName('');
          setFixed(false);
        }}
      >
        <div className="row">
          <input className="input grow" placeholder="新しいカテゴリ" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} aria-label="新しいカテゴリ名" />
          <button className="btn" disabled={!cleanText(name, 30)}>
            追加
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} />
          固定費（サブスクの検出が早くなります）
        </label>
      </form>

      <h3 style={{ marginTop: 8 }}>自動分類のルール</h3>
      <p className="tiny sub">明細のカテゴリを手で直すと、その店名をここに覚えます。</p>
      <div className="list">
        {sortedRules.length === 0 && <p className="small sub">ルールはまだありません</p>}
        {sortedRules.map((r) => (
          <div className="list-row" key={r.id}>
            <span className="grow ellipsis small">「{r.pattern}」を含む → {cats.name(r.categoryId)}</span>
            <button className="icon-btn plain" aria-label={`ルール「${r.pattern}」を削除`} onClick={() => store.remove('rules', r.id)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </div>
      <p className="tiny sub">ルールの文字は表記ゆれを吸収した形（{normalizeMerchant('ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ')} など）で保存されます。</p>
    </div>
  );
}

function LockSettings() {
  const settings = useSettings();
  const [meta, setMeta] = useState<LockMeta | null>(null);
  const [bioOk, setBioOk] = useState(false);
  const [mode, setMode] = useState<SecretMode>('pin');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [bioSecret, setBioSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => getLockMeta().then((m) => {
    setMeta(m);
    if (m) setMode(m.mode);
  });
  useEffect(() => {
    reload();
    biometricAvailable().then(setBioOk);
  }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await reload();
    } catch (e) {
      toast(e instanceof DOMException && e.name === 'NotAllowedError' ? 'キャンセルされました' : e instanceof Error ? e.message : '失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const nextErr = next ? validateSecret(next, mode) : null;
  const inputMode = (m: SecretMode | undefined) => (m === 'pin' ? 'numeric' : 'text');

  return (
    <div className="col gap-16">
      <Field label="自動ロック（アプリを閉じてから）" group>
        <Seg
          label="自動ロック"
          value={String(settings.autoLockSec)}
          onChange={(v) => store.put('settings', { ...settings, autoLockSec: Number(v) })}
          options={[
            ['0', 'すぐ'],
            ['60', '1分'],
            ['300', '5分'],
          ]}
        />
      </Field>
      <p className="tiny sub">操作しないまま5分たった場合もロックします。</p>

      <section className="col gap-8">
        <h3>指紋・顔認証</h3>
        {!bioOk ? (
          <p className="small sub">この端末・ブラウザは、生体認証によるデータ保護に対応していません。iPhoneでは、Safariでホーム画面に追加して使い、端末の設定で指紋（Touch ID）または顔（Face ID）を登録しておく必要があります。</p>
        ) : meta?.bio ? (
          <>
            <p className="small">設定済みです。</p>
            <button className="btn ghost" disabled={busy} onClick={() => confirm('指紋・顔認証での解除をやめますか？') && run(disableBiometric, '指紋・顔認証をやめました')}>
              指紋・顔認証をやめる
            </button>
          </>
        ) : (
          <>
            <Field label={meta?.mode === 'pin' ? '確認のため現在のPIN' : '確認のため現在のパスワード'}>
              <input className="input" type="password" inputMode={inputMode(meta?.mode)} autoComplete="off" value={bioSecret} maxLength={128} onChange={(e) => setBioSecret(e.target.value)} />
            </Field>
            <button
              className="btn"
              disabled={busy || !bioSecret}
              onClick={() =>
                run(async () => {
                  await enableBiometric(bioSecret);
                  setBioSecret('');
                }, '指紋・顔認証を設定しました')
              }
            >
              <Icon name="finger" /> 指紋・顔認証を設定する
            </button>
          </>
        )}
      </section>

      <section className="col gap-8">
        <h3>PIN・パスワードの変更</h3>
        <Field label="現在のPIN/パスワード">
          <input className="input" type="password" inputMode={inputMode(meta?.mode)} autoComplete="off" value={cur} maxLength={128} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Seg
          label="新しい方式"
          value={mode}
          onChange={setMode}
          options={[
            ['pin', '数字のPIN'],
            ['password', 'パスワード'],
          ]}
        />
        <Field label={mode === 'pin' ? '新しいPIN（6桁以上）' : '新しいパスワード（8文字以上）'}>
          <input className="input" type="password" inputMode={inputMode(mode)} autoComplete="new-password" value={next} maxLength={128} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="もう一度">
          <input className="input" type="password" inputMode={inputMode(mode)} autoComplete="new-password" value={next2} maxLength={128} onChange={(e) => setNext2(e.target.value)} />
        </Field>
        {nextErr && <p className="small danger">{nextErr}</p>}
        {next2 && next !== next2 && <p className="small danger">一致しません</p>}
        <button
          className="btn"
          disabled={busy || !cur || !next || !!nextErr || next !== next2}
          onClick={() =>
            run(async () => {
              await changeSecret(cur, next, mode);
              setCur('');
              setNext('');
              setNext2('');
            }, '変更しました')
          }
        >
          変更する
        </button>
      </section>
      <p className="tiny sub">
        現在：{meta?.mode === 'pin' ? '数字のPIN' : 'パスワード'}
        {meta?.bio ? ' ＋ 指紋・顔認証' : ''} ・ 鍵の導出 PBKDF2-SHA256 {meta?.iterations.toLocaleString()}回
      </p>
    </div>
  );
}
