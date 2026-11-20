export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ja-JP');
}

export function fmtYen(n: number): string {
  return `${n < 0 ? '−' : ''}¥${fmtNum(Math.abs(n))}`;
}

/** 増減の表記（+¥1,000 / −¥1,000） */
export function fmtDiff(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}¥${fmtNum(Math.abs(n))}`;
}

/** 店名・メモなどの自由入力を保存前に整える（制御文字を除き、長さを制限） */
export function cleanText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanMultiline(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max);
}

/** 金額入力（全角・カンマ・円記号を許容）→ 整数。無効なら null */
export function parseYen(s: string): number | null {
  let t = s.normalize('NFKC').replace(/[,\s¥円]/g, '');
  let neg = false;
  if (/^[△▲\-−]/.test(t)) {
    neg = true;
    t = t.slice(1);
  } else if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return neg ? -n : n;
}
