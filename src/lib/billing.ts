import { addMonths, daysInMonth, ymOf } from './dates';
import type { Card } from './types';

type CardTerms = Pick<Card, 'closingDay' | 'payOffset'>;

/** 利用日から請求月（引き落とされる月）を求める */
export function billMonthFor(date: string, card: CardTerms): string {
  const ym = ymOf(date);
  const day = Number(date.slice(8, 10));
  const closing = Math.min(card.closingDay, daysInMonth(ym));
  const closingMonth = day <= closing ? ym : addMonths(ym, 1);
  return addMonths(closingMonth, card.payOffset);
}

/** 請求月の引き落とし日（YYYY-MM-DD） */
export function payDateFor(billMonth: string, card: Pick<Card, 'payDay'>): string {
  const d = Math.min(card.payDay, daysInMonth(billMonth));
  return `${billMonth}-${String(d).padStart(2, '0')}`;
}

/** 締め日の説明文（例：「15日締め・翌月10日払い」） */
export function termsLabel(card: Pick<Card, 'closingDay' | 'payOffset' | 'payDay'>): string {
  const c = card.closingDay >= 31 ? '末日' : `${card.closingDay}日`;
  const p = card.payDay >= 31 ? '末日' : `${card.payDay}日`;
  const o = card.payOffset === 1 ? '翌月' : card.payOffset === 2 ? '翌々月' : `${card.payOffset}か月後の`;
  return `${c}締め・${o}${p}払い`;
}
