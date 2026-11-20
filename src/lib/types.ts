export type PayType = 'once' | 'split' | 'revo' | 'bonus';
export const PAY_LABEL: Record<PayType, string> = {
  once: '1回払い',
  split: '分割',
  revo: 'リボ',
  bonus: 'ボーナス',
};

export type Need = 'need' | 'want';

export interface Card {
  id: string;
  name: string;
  /** 締め日。31 は「末日」 */
  closingDay: number;
  /** 締めた月から何か月後に引き落とされるか（翌月=1、翌々月=2） */
  payOffset: number;
  /** 引き落とし日。31 は「末日」 */
  payDay: number;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  order: number;
  /** 固定費（サブスク・通信・保険など） */
  fixed?: boolean;
}

export interface Txn {
  id: string;
  cardId: string;
  /** 利用日 YYYY-MM-DD */
  date: string;
  /** 請求月 YYYY-MM（引き落とされる月） */
  billMonth: string;
  merchant: string;
  /** 円。返金はマイナス */
  amount: number;
  categoryId?: string;
  payType: PayType;
  need?: Need;
  memo?: string;
  source: 'manual' | 'csv';
  /** pending = 手入力のみで明細と未照合 */
  status: 'pending' | 'confirmed';
  /** CSV 取り込み時の重複判定キー */
  importKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Rule {
  id: string;
  /** 正規化した店名に含まれる文字列 */
  pattern: string;
  categoryId: string;
  createdAt: number;
}

export interface Goal {
  id: 'default';
  total?: number;
  byCategory: Record<string, number>;
}

export interface SavingAction {
  id: string;
  date: string;
  text: string;
  /** 見込みの月あたり削減額 */
  monthlySaving: number;
  createdAt: number;
}

export interface Advice {
  /** 請求月 */
  id: string;
  text: string;
  createdAt: number;
}

export interface Settings {
  id: 'app';
  /** バックグラウンドに移ってから何秒でロックするか。0 = すぐ */
  autoLockSec: number;
  lastBackupAt?: number;
  /** Claude に送るまとめに店名を含めるか */
  claudeIncludeMerchants: boolean;
}

export interface Tables {
  cards: Card;
  categories: Category;
  txns: Txn;
  rules: Rule;
  goals: Goal;
  actions: SavingAction;
  advice: Advice;
  settings: Settings;
}
export type TableName = keyof Tables;
export const TABLES: TableName[] = ['cards', 'categories', 'txns', 'rules', 'goals', 'actions', 'advice', 'settings'];

export const DEFAULT_SETTINGS: Settings = { id: 'app', autoLockSec: 60, claudeIncludeMerchants: false };
