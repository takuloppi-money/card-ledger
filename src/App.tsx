import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { ToastHost, useCards } from './components/ui';
import { billMonthFor } from './lib/billing';
import { todayKey } from './lib/dates';
import { getLockMeta, type LockMeta } from './lib/lock';
import { store, useSettings } from './lib/store';
import type { Txn } from './lib/types';
import { Analysis } from './screens/Analysis';
import { CardForm } from './screens/CardForm';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Review } from './screens/Review';
import { Settings } from './screens/Settings';
import { TxnSheet } from './screens/TxnSheet';
import { Txns } from './screens/Txns';
import { Unlock } from './screens/Unlock';

type Phase = { k: 'loading' } | { k: 'setup' } | { k: 'locked'; meta: LockMeta } | { k: 'open' };

/** 操作がないまま放置したときにロックするまでの時間 */
const IDLE_LOCK_MS = 5 * 60_000;

export default function App() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });

  const lock = useCallback(async () => {
    store.lock();
    const meta = await getLockMeta();
    setPhase(meta ? { k: 'locked', meta } : { k: 'setup' });
  }, []);

  useEffect(() => {
    // 保存領域を「消さないで」とブラウザに依頼する
    navigator.storage?.persist?.().catch(() => undefined);
    getLockMeta().then((meta) => setPhase(meta ? { k: 'locked', meta } : { k: 'setup' }));
  }, []);

  // バックグラウンドに移ったら画面を覆い、アプリ切り替え画面に明細を映さない。
  // ロック中も含めて常に有効にするため、ここ（最上位）で管理する
  useEffect(() => {
    const hide = () => document.body.classList.add('veiled');
    const show = () => document.body.classList.remove('veiled');
    const onVis = () => (document.visibilityState === 'hidden' ? hide() : show());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, []);

  return (
    <>
      {phase.k === 'setup' && <Onboarding onDone={() => setPhase({ k: 'open' })} />}
      {phase.k === 'locked' && <Unlock meta={phase.meta} onUnlocked={() => setPhase({ k: 'open' })} />}
      {phase.k === 'open' && <Main onLock={lock} />}
      <div className="veil" aria-hidden="true" />
      <ToastHost />
    </>
  );
}

type Tab = 'home' | 'txns' | 'analysis' | 'review';

function Main({ onLock }: { onLock: () => void }) {
  const settings = useSettings();
  const cards = useCards();
  const [tab, setTab] = useState<Tab>('home');
  const [month, setMonth] = useState<string | null>(null);
  const [editing, setEditing] = useState<Txn | 'new' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  // 最初のカードの「今使うと請求される月」を既定の表示月にする
  const currentMonth = cards[0] ? billMonthFor(todayKey(), cards[0]) : todayKey().slice(0, 7);
  const shownMonth = month ?? currentMonth;

  // 自動ロック：バックグラウンドに移ってから一定時間、または操作がないまま一定時間
  useEffect(() => {
    let idle = window.setTimeout(onLock, IDLE_LOCK_MS);
    const bump = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(onLock, IDLE_LOCK_MS);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (settings.autoLockSec === 0) onLock();
      } else {
        if (hiddenAt.current && Date.now() - hiddenAt.current >= settings.autoLockSec * 1000) onLock();
        hiddenAt.current = null;
        bump();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointerdown', bump, { passive: true });
    window.addEventListener('keydown', bump);
    return () => {
      window.clearTimeout(idle);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [onLock, settings.autoLockSec]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  if (!cards.length) {
    return (
      <main>
        <div className="page" style={{ paddingTop: 'calc(24px + env(safe-area-inset-top))' }}>
          <h1>カードを登録してください</h1>
          <p className="sub small">締め日と支払日から、明細がどの月の請求になるかを計算します。</p>
          <CardForm submitLabel="登録する" onSubmit={(c) => store.put('cards', c)} />
        </div>
      </main>
    );
  }

  if (settingsOpen) return <Settings onClose={() => setSettingsOpen(false)} onLock={onLock} />;

  const TABS: { id: Tab | 'add'; label: string; icon: string }[] = [
    { id: 'home', label: 'ホーム', icon: 'home' },
    { id: 'txns', label: '明細', icon: 'list' },
    { id: 'add', label: '追加', icon: 'plus' },
    { id: 'analysis', label: '分析', icon: 'chart' },
    { id: 'review', label: '見直し', icon: 'check' },
  ];

  const common = { month: shownMonth, setMonth, onEdit: (t: Txn) => setEditing(t) };

  return (
    <>
      <main>
        {tab === 'home' && <Home {...common} onOpenSettings={() => setSettingsOpen(true)} onGo={setTab} />}
        {tab === 'txns' && <Txns {...common} />}
        {tab === 'analysis' && <Analysis {...common} />}
        {tab === 'review' && <Review {...common} />}
      </main>
      <nav className="tabbar" aria-label="メインメニュー">
        {TABS.map((t) =>
          t.id === 'add' ? (
            <button key={t.id} aria-label="支出を追加" onClick={() => setEditing('new')}>
              <span className="add">
                <Icon name="plus" size={24} />
              </span>
            </button>
          ) : (
            <button
              key={t.id}
              className={tab === t.id ? 'on' : ''}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id as Tab)}
            >
              <Icon name={t.icon} />
              {t.label}
            </button>
          ),
        )}
      </nav>
      {editing && <TxnSheet txn={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
