import { useState } from 'react';
import { Field, Seg } from '../components/ui';
import { termsLabel } from '../lib/billing';
import { randomId } from '../lib/crypto';
import { cleanText } from '../lib/format';
import type { Card } from '../lib/types';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const dayText = (d: number) => (d === 31 ? '末日' : `${d}日`);

export function CardForm({
  initial,
  order = 0,
  submitLabel,
  onSubmit,
}: {
  initial?: Card;
  order?: number;
  submitLabel: string;
  onSubmit: (c: Card) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [closingDay, setClosing] = useState(initial?.closingDay ?? 31);
  const [payOffset, setOffset] = useState(String(initial?.payOffset ?? 1));
  const [payDay, setPayDay] = useState(initial?.payDay ?? 27);
  const [busy, setBusy] = useState(false);

  const card: Card = {
    id: initial?.id ?? randomId(),
    name: cleanText(name, 40),
    closingDay,
    payOffset: Number(payOffset),
    payDay,
    order: initial?.order ?? order,
  };

  return (
    <form
      className="col gap-16"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!card.name) return;
        setBusy(true);
        try {
          await onSubmit(card);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="カードの呼び名" hint="カード番号は入力しないでください">
        <input className="input" value={name} maxLength={40} placeholder="例：メインカード" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="締め日">
        <select className="input" value={closingDay} onChange={(e) => setClosing(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {dayText(d)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="引き落とし月" group>
        <Seg
          label="引き落とし月"
          value={payOffset}
          onChange={setOffset}
          options={[
            ['1', '翌月'],
            ['2', '翌々月'],
          ]}
        />
      </Field>
      <Field label="引き落とし日">
        <select className="input" value={payDay} onChange={(e) => setPayDay(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {dayText(d)}
            </option>
          ))}
        </select>
      </Field>
      <p className="notice">{termsLabel(card)}</p>
      <button className="btn block" disabled={busy || !card.name}>
        {submitLabel}
      </button>
    </form>
  );
}
