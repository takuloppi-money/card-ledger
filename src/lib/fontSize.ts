/**
 * 文字の大きさ（端末ごとの表示設定）。
 * ロック画面にも反映させるため、暗号化データではなく localStorage に保存する（秘密の情報ではない）。
 */
export type FontSize = 's' | 'm' | 'l' | 'xl';

export const FONT_SIZES: [FontSize, string, number][] = [
  ['s', '小', 12.5],
  ['m', '標準', 13.5],
  ['l', '大', 15],
  ['xl', '特大', 16.5],
];

const KEY = 'card-ledger:font-size';

export function getFontSize(): FontSize {
  try {
    const v = localStorage.getItem(KEY);
    if (FONT_SIZES.some(([k]) => k === v)) return v as FontSize;
  } catch {
    /* 読めなければ標準 */
  }
  return 'm';
}

export function applyFontSize(size: FontSize = getFontSize()) {
  const px = FONT_SIZES.find(([k]) => k === size)?.[2] ?? 13.5;
  document.documentElement.style.fontSize = `${px}px`;
}

export function setFontSize(size: FontSize) {
  try {
    localStorage.setItem(KEY, size);
  } catch {
    /* 保存できなくても今回の表示には反映する */
  }
  applyFontSize(size);
}
