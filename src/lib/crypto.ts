/**
 * 暗号化まわり（Web Crypto API のみを使用。自前の暗号実装はしない）
 *
 * - データ暗号鍵 DEK: AES-GCM 256bit。全レコードをこの鍵で暗号化して IndexedDB に保存する。
 * - DEK は PIN/パスワードから PBKDF2-SHA256 で導出した鍵 (KEK) で包んで（wrap して）保存する。
 *   PIN を間違えると unwrap が GCM の認証エラーで失敗するため、PIN の検証値を別に持つ必要がない。
 * - バックアップは DEK とは無関係に、書き出し時のパスワードから導出した鍵で暗号化する。
 */

const te = new TextEncoder();
const td = new TextDecoder();

export const PBKDF2_ITERATIONS = 600_000;
/** 読み込むファイルに異常な反復回数が書かれていても固まらないよう上限を設ける */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 5_000_000;

export interface Sealed {
  iv: string;
  ct: string;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function randomId(): string {
  return toB64(randomBytes(12)).replace(/\+/g, '-').replace(/\//g, '_');
}

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('不正なデータです');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function checkIterations(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS) {
    throw new Error('不正な鍵設定です');
  }
  return n;
}

/** PIN/パスワードから鍵を導出する。usages で wrap 用か暗号化用かを切り替える */
export async function deriveKey(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: checkIterations(iterations) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/** 生体認証（WebAuthn PRF）の出力から鍵を導出する */
export async function deriveKeyFromPrf(prfOutput: ArrayBuffer, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('card-ledger/biometric-kek/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** DEK を新規作成する。包む（wrap）ために一時的に extractable で作る */
export function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv: toB64(iv), ct: toB64(ct) };
}

/**
 * 包まれた DEK を取り出す。鍵が違えば例外。
 * 通常の利用時は extractable=false（取り出した鍵を JS から読み出せない）。
 */
export async function unwrapDek(w: Sealed, kek: CryptoKey, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    fromB64(w.ct),
    kek,
    { name: 'AES-GCM', iv: fromB64(w.iv) },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/** aad（追加認証データ）にレコードの場所を入れ、暗号文を別レコードに差し替えられないようにする */
export async function sealJson(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(aad) },
    key,
    te.encode(JSON.stringify(value)),
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function openJson<T = unknown>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: te.encode(aad) },
    key,
    fromB64(sealed.ct),
  );
  return JSON.parse(td.decode(pt)) as T;
}

// ---- バックアップファイル ----

export const BACKUP_FORMAT = 'card-ledger-backup';
const BACKUP_AAD = `${BACKUP_FORMAT}/v1`;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  v: 1;
  kdf: { alg: 'PBKDF2-SHA256'; iterations: number; salt: string };
  iv: string;
  ct: string;
}

export async function encryptBackup(payload: unknown, password: string): Promise<BackupFile> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS, ['encrypt', 'decrypt']);
  const sealed = await sealJson(key, payload, BACKUP_AAD);
  return {
    format: BACKUP_FORMAT,
    v: 1,
    kdf: { alg: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: toB64(salt) },
    ...sealed,
  };
}

export class WrongPasswordError extends Error {
  constructor() {
    super('パスワードが違うか、ファイルが壊れています');
  }
}

export async function decryptBackup(text: string, password: string): Promise<unknown> {
  let f: Partial<BackupFile>;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error('バックアップファイルではありません');
  }
  if (!f || f.format !== BACKUP_FORMAT || f.v !== 1 || f.kdf?.alg !== 'PBKDF2-SHA256') {
    throw new Error('バックアップファイルではありません');
  }
  const key = await deriveKey(password, fromB64(f.kdf.salt), f.kdf.iterations, ['encrypt', 'decrypt']);
  try {
    return await openJson(key, { iv: String(f.iv), ct: String(f.ct) }, BACKUP_AAD);
  } catch {
    throw new WrongPasswordError();
  }
}
