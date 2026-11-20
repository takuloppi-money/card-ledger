import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { addMonths, ymLabel } from '../lib/dates';
import { store, useTable } from '../lib/store';
import type { Category, Need, Txn } from '../lib/types';
import { Icon } from './Icon';

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: message }));
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const h = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), 3200);
    };
    window.addEventListener('app-toast', h);
    return () => {
      window.removeEventListener('app-toast', h);
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className="toast-wrap" aria-live="polite">
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn plain" aria-label="閉じる" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function FullPage({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className="full" role="dialog" aria-modal="true" aria-label={title}>
      <header className="page-head">
        <h1>{title}</h1>
        <button className="icon-btn plain" aria-label="閉じる" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div style={{ paddingTop: 12 }}>{children}</div>
    </div>
  );
}

export function Group({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="group">
      <button aria-expanded={open} onClick={onToggle}>
        {title}
        <Icon name={open ? 'up' : 'down'} size={18} />
      </button>
      {open && <div className="group-body">{children}</div>}
    </section>
  );
}

export function Field({ label, children, hint, group }: { label: string; children: ReactNode; hint?: string; group?: boolean }) {
  if (group) {
    return (
      <div className="field" role="group" aria-label={label}>
        <span className="field-label">{label}</span>
        {children}
        {hint && <span className="tiny sub">{hint}</span>}
      </div>
    );
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="tiny sub">{hint}</span>}
    </label>
  );
}

export function MonthSwitch({ value, onChange, dark }: { value: string; onChange: (ym: string) => void; dark?: boolean }) {
  const cls = dark ? 'icon-btn' : 'icon-btn plain';
  return (
    <div className="month-switch">
      <button className={cls} aria-label="前の月" onClick={() => onChange(addMonths(value, -1))}>
        <Icon name="left" size={18} />
      </button>
      <span className="label">{ymLabel(value)}</span>
      <button className={cls} aria-label="次の月" onClick={() => onChange(addMonths(value, 1))}>
        <Icon name="right" size={18} />
      </button>
    </div>
  );
}

export function useCategories() {
  const cats = useTable('categories');
  return useMemo(() => {
    const sorted = [...cats].sort((a, b) => a.order - b.order);
    const map = new Map(sorted.map((c) => [c.id, c]));
    const name = (id: string | null | undefined) => (id && map.get(id)?.name) || '未分類';
    const color = (id: string | null | undefined) => (id && map.get(id)?.color) || '#C8D3D2';
    return { list: sorted, map, name, color };
  }, [cats]);
}

export function useCards() {
  const cards = useTable('cards');
  return useMemo(() => [...cards].sort((a, b) => a.order - b.order), [cards]);
}

export function CatDot({ cat }: { cat?: Category }) {
  return <span className="dot" style={{ background: cat?.color ?? '#C8D3D2' }} />;
}

export function NeedToggle({ txn }: { txn: Txn }) {
  const set = (need: Need) =>
    store.put('txns', { ...txn, need: txn.need === need ? undefined : need, updatedAt: Date.now() });
  return (
    <div className="need-toggle" role="group" aria-label="この支出は必要だったか">
      <button className={txn.need === 'need' ? 'on-need' : ''} aria-pressed={txn.need === 'need'} onClick={() => set('need')}>
        必要
      </button>
      <button className={txn.need === 'want' ? 'on-want' : ''} aria-pressed={txn.need === 'want'} onClick={() => set('want')}>
        不要
      </button>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
