import { evaluateBiometric, registerBiometric } from './biometric';
import {
  deriveKey,
  deriveKeyFromPrf,
  fromB64,
  generateDek,
  PBKDF2_ITERATIONS,
  randomBytes,
  toB64,
  unwrapDek,
  wrapDek,
  type Sealed,
} from './crypto';
import { vdb } from './store';

export type SecretMode = 'pin' | 'password';

export interface LockMeta {
  v: 1;
  mode: SecretMode;
  salt: string;
  iterations: number;
  wrapped: Sealed;
  bio?: { credId: string; prfSalt: string; hkdfSalt: string; wrapped: Sealed };
}

export const PIN_MIN = 6;
export const PASSWORD_MIN = 8;

export function validateSecret(secret: string, mode: SecretMode): string | null {
  if (mode === 'pin') {
    if (!/^\d+$/.test(secret)) return 'PINは数字で入力してください';
    if (secret.length < PIN_MIN) return `PINは${PIN_MIN}桁以上にしてください`;
    if (/^(\d)\1+$/.test(secret)) return '同じ数字の繰り返しは使えません';
    if ('01234567890'.includes(secret) || '9876543210'.includes(secret)) return '連続した数字は使えません';
    return null;
  }
  if (secret.length < PASSWORD_MIN) return `パスワードは${PASSWORD_MIN}文字以上にしてください`;
  return null;
}

export async function getLockMeta(): Promise<LockMeta | null> {
  const row = await vdb.meta.get('lock');
  return (row?.value as LockMeta | undefined) ?? null;
}

async function saveMeta(meta: LockMeta) {
  await vdb.meta.put({ key: 'lock', value: meta });
}

const kekFor = (secret: string, meta: Pick<LockMeta, 'salt' | 'iterations'>) =>
  deriveKey(secret, fromB64(meta.salt), meta.iterations, ['wrapKey', 'unwrapKey']);

/** 初回：データ鍵を作り、PIN から導出した鍵で包んで保存する */
export async function createVault(secret: string, mode: SecretMode): Promise<CryptoKey> {
  if (await getLockMeta()) throw new Error('すでに設定されています');
  const dek = await generateDek();
  const salt = toB64(randomBytes(16));
  const kek = await kekFor(secret, { salt, iterations: PBKDF2_ITERATIONS });
  const wrapped = await wrapDek(dek, kek);
  await saveMeta({ v: 1, mode, salt, iterations: PBKDF2_ITERATIONS, wrapped });
  // 以後は取り出し不可（non-extractable）の鍵だけを使う
  return unwrapDek(wrapped, kek);
}

// ---- 試行回数の制限 ----
// 5 回失敗すると 30 秒待ち、以降失敗するたびに待ち時間が倍になる（最大 1 時間）

const FAIL_KEY = 'card-ledger:fail';
interface FailState {
  count: number;
  until: number;
}

function readFail(): FailState {
  try {
    const v = JSON.parse(localStorage.getItem(FAIL_KEY) ?? '');
    if (typeof v?.count === 'number' && typeof v?.until === 'number') return v;
  } catch {
    /* 空なら初期値 */
  }
  return { count: 0, until: 0 };
}

function writeFail(s: FailState) {
  try {
    localStorage.setItem(FAIL_KEY, JSON.stringify(s));
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

/** ロック解除を待つ必要がある残りミリ秒 */
export function lockoutRemaining(): number {
  return Math.max(0, readFail().until - Date.now());
}

function recordFailure() {
  const s = readFail();
  const count = s.count + 1;
  const wait = count >= 5 ? Math.min(30_000 * 2 ** (count - 5), 3_600_000) : 0;
  writeFail({ count, until: wait ? Date.now() + wait : 0 });
}

export class LockoutError extends Error {}

export async function unlockWithSecret(secret: string): Promise<CryptoKey> {
  if (lockoutRemaining() > 0) throw new LockoutError('しばらく待ってから入力してください');
  const meta = await getLockMeta();
  if (!meta) throw new Error('初期設定がされていません');
  try {
    const key = await unwrapDek(meta.wrapped, await kekFor(secret, meta));
    writeFail({ count: 0, until: 0 });
    return key;
  } catch {
    recordFailure();
    throw new Error(meta.mode === 'pin' ? 'PINが違います' : 'パスワードが違います');
  }
}

/** PIN/パスワードの変更（データ鍵は同じまま、包み直すだけ） */
export async function changeSecret(oldSecret: string, newSecret: string, mode: SecretMode) {
  const meta = await getLockMeta();
  if (!meta) throw new Error('初期設定がされていません');
  let dek: CryptoKey;
  try {
    dek = await unwrapDek(meta.wrapped, await kekFor(oldSecret, meta), true);
  } catch {
    recordFailure();
    throw new Error('現在のPIN/パスワードが違います');
  }
  const salt = toB64(randomBytes(16));
  const wrapped = await wrapDek(dek, await kekFor(newSecret, { salt, iterations: PBKDF2_ITERATIONS }));
  await saveMeta({ ...meta, mode, salt, iterations: PBKDF2_ITERATIONS, wrapped });
}

export async function enableBiometric(secret: string) {
  const meta = await getLockMeta();
  if (!meta) throw new Error('初期設定がされていません');
  let dek: CryptoKey;
  try {
    dek = await unwrapDek(meta.wrapped, await kekFor(secret, meta), true);
  } catch {
    recordFailure();
    throw new Error('PIN/パスワードが違います');
  }
  const { credId, prfSalt, output } = await registerBiometric();
  const hkdfSalt = randomBytes(16);
  const wrapped = await wrapDek(dek, await deriveKeyFromPrf(output, hkdfSalt));
  await saveMeta({ ...meta, bio: { credId, prfSalt, hkdfSalt: toB64(hkdfSalt), wrapped } });
}

export async function unlockWithBiometric(): Promise<CryptoKey> {
  const meta = await getLockMeta();
  if (!meta?.bio) throw new Error('生体認証は設定されていません');
  const out = await evaluateBiometric(meta.bio.credId, meta.bio.prfSalt);
  const key = await unwrapDek(meta.bio.wrapped, await deriveKeyFromPrf(out, fromB64(meta.bio.hkdfSalt)));
  writeFail({ count: 0, until: 0 });
  return key;
}

export async function disableBiometric() {
  const meta = await getLockMeta();
  if (!meta) return;
  const rest: LockMeta = { ...meta };
  delete rest.bio;
  await saveMeta(rest);
}

/** すべてのデータを削除する */
export async function wipeAll() {
  await vdb.delete();
  try {
    localStorage.removeItem(FAIL_KEY);
  } catch {
    /* noop */
  }
}
