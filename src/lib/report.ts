import { byCategory, byMerchant, detectSubscriptions, feeTxns, increases, inMonth, monthlyTotals, sum } from './analysis';
import { addMonths, ymLabel } from './dates';
import { fmtDiff, fmtYen } from './format';
import type { Category, Goal, SavingAction, Txn } from './types';

/**
 * Claude に送る月次まとめ。
 * 既定では店名を含めず、カテゴリ別の合計など集計値だけにする。
 * カード名・個々の利用日・メモは含めない。
 */
export function buildClaudeReport(opts: {
  billMonth: string;
  txns: Txn[];
  categories: Category[];
  goal?: Goal;
  actions: SavingAction[];
  includeMerchants: boolean;
}): string {
  const { billMonth, txns, categories, goal, actions, includeMerchants } = opts;
  const name = (id: string | null | undefined) => categories.find((c) => c.id === id)?.name ?? '未分類';
  const cur = inMonth(txns, billMonth);
  const prev = inMonth(txns, addMonths(billMonth, -1));
  const total = sum(cur);
  const lines: string[] = [];

  lines.push(`あなたは家計の見直しが得意なファイナンシャルプランナーです。`);
  lines.push(`以下は私のクレジットカードの${ymLabel(billMonth)}請求分のまとめです。`);
  lines.push(`目的は「毎月の請求額を少しずつ減らすこと」です。`);
  lines.push(`無理のない範囲で、来月から実行できる具体的な削減策を優先度の高い順に3〜5個提案してください。`);
  lines.push(`それぞれ、見込める月あたりの削減額も添えてください。`);
  lines.push('');
  lines.push(`## 請求額`);
  lines.push(`- 今月: ${fmtYen(total)}（前月比 ${fmtDiff(total - sum(prev))}）`);
  if (goal?.total) lines.push(`- 目標: ${fmtYen(goal.total)}`);
  lines.push(
    `- 直近6か月: ${monthlyTotals(txns, billMonth, 6)
      .map((m) => `${ymLabel(m.ym)} ${fmtYen(m.total)}`)
      .join(' / ')}`,
  );
  lines.push('');
  lines.push(`## カテゴリ別（今月）`);
  for (const c of byCategory(cur)) lines.push(`- ${name(c.categoryId)}: ${fmtYen(c.amount)}（${c.count}件）`);

  const inc = increases(cur, prev);
  if (inc.length) {
    lines.push('');
    lines.push(`## 前月より増えたカテゴリ`);
    for (const i of inc.slice(0, 5)) lines.push(`- ${name(i.categoryId)}: ${fmtDiff(i.diff)}`);
  }

  const subs = detectSubscriptions(txns, billMonth, categories);
  if (subs.length) {
    lines.push('');
    lines.push(`## 定期的な支払い（自動検出）`);
    subs.forEach((s, i) =>
      lines.push(`- ${includeMerchants ? s.merchant : `定期支払い${i + 1}（${name(s.categoryId)}）`}: 月 ${fmtYen(s.monthly)}`),
    );
  }

  const fees = feeTxns(cur);
  if (fees.length) {
    lines.push('');
    lines.push(`## 手数料・リボ・分割`);
    lines.push(`- ${fees.length}件、合計 ${fmtYen(sum(fees))}`);
  }

  const wants = cur.filter((t) => t.need === 'want');
  const tagged = cur.filter((t) => t.need).length;
  if (tagged) {
    lines.push('');
    lines.push(`## 自己評価`);
    lines.push(`- 「なくてもよかった」と印を付けた支出: ${wants.length}件 / ${fmtYen(sum(wants))}`);
    const wantCats = byCategory(wants).slice(0, 3);
    if (wantCats.length) lines.push(`- 多いカテゴリ: ${wantCats.map((c) => `${name(c.categoryId)} ${fmtYen(c.amount)}`).join('、')}`);
  }

  if (includeMerchants) {
    lines.push('');
    lines.push(`## 金額の大きい店（今月）`);
    for (const m of byMerchant(cur).slice(0, 10)) lines.push(`- ${m.merchant}: ${fmtYen(m.amount)}（${m.count}回）`);
  }

  if (actions.length) {
    lines.push('');
    lines.push(`## これまでに実行した削減策`);
    for (const a of actions.slice(-10)) lines.push(`- ${a.date.slice(0, 7)}: ${a.text}（月 ${fmtYen(a.monthlySaving)}）`);
  }
  return lines.join('\n');
}
