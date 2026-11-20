/**
 * 指紋認証（Touch ID）・顔認証（Face ID）でのロック解除（WebAuthn の PRF 拡張）
 * 端末に登録された生体認証をそのまま使うため、指紋・顔のどちらの端末でも同じコードで動く。
 *
 * パスキーを作成し、認証のたびに PRF 拡張で「端末の生体認証を通したときだけ得られる 32 バイトの秘密」を受け取る。
 * その秘密から鍵を導出してデータ鍵を包むので、生体認証を通らない限りデータ鍵を取り出せない。
 * （「認証できたら開く」だけの見せかけのロックではない）
 * PRF に対応していない端末（iOS 17 以前など）では使えないため、その場合は PIN のみになる。
 */
import { fromB64, randomBytes, toB64 } from './crypto';

type PrfExt = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

export async function biometricAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    const uv = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!uv) return false;
    const caps = await (
      PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }
    ).getClientCapabilities?.();
    if (caps && caps['extension:prf'] === false) return false;
    return true;
  } catch {
    return false;
  }
}

/** パスキーを作成し、PRF の出力を返す */
export async function registerBiometric(): Promise<{ credId: string; prfSalt: string; output: ArrayBuffer }> {
  const prfSalt = randomBytes(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'カード請求ノート' },
      user: { id: randomBytes(16), name: 'card-ledger', displayName: 'カード請求ノート' },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('登録がキャンセルされました');
  const ext = cred.getClientExtensionResults() as PrfExt;
  if (!ext.prf?.enabled && !ext.prf?.results?.first) {
    throw new Error('この端末は生体認証によるデータ保護（PRF）に対応していません');
  }
  const credId = toB64(cred.rawId);
  const output = ext.prf.results?.first ?? (await evaluateBiometric(credId, toB64(prfSalt)));
  return { credId, prfSalt: toB64(prfSalt), output };
}

/** 生体認証を行い、PRF の出力を返す */
export async function evaluateBiometric(credId: string, prfSalt: string): Promise<ArrayBuffer> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: fromB64(credId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: fromB64(prfSalt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('認証がキャンセルされました');
  const out = (cred.getClientExtensionResults() as PrfExt).prf?.results?.first;
  if (!out) throw new Error('生体認証で鍵を取り出せませんでした');
  return out;
}
