import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { LockoutError, lockoutRemaining, unlockWithBiometric, unlockWithSecret, type LockMeta, type SecretMode } from '../lib/lock';
import { store } from '../lib/store';

/** PIN はテンキー、パスワードは入力欄 */
export function SecretPad({
  mode,
  value,
  onChange,
  onSubmit,
  submitLabel,
  busy,
  extraKey,
  dark,
}: {
  mode: SecretMode;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  busy?: boolean;
  extraKey?: React.ReactNode;
  dark?: boolean;
}) {
  if (mode === 'password') {
    return (
      <form
        className="col gap-12"
        style={{ width: '100%', maxWidth: 320 }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          className="input"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="パスワード"
          value={value}
          maxLength={128}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
        <button className={`btn block ${dark ? 'ink' : ''}`} disabled={busy || !value}>
          {busy ? '確認中…' : submitLabel}
        </button>
      </form>
    );
  }
  const press = (d: string) => value.length < 12 && onChange(value + d);
  return (
    <div className="col gap-16" style={{ alignItems: 'center' }}>
      <div className="pin-dots" aria-label={`${value.length}桁入力済み`}>
        {Array.from({ length: Math.max(6, value.length) }, (_, i) => (
          <span key={i} className={i < value.length ? 'on' : ''} />
        ))}
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        {extraKey ?? <span />}
        <button onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button className="fn" aria-label="1文字消す" onClick={() => onChange(value.slice(0, -1))} disabled={busy}>
          <Icon name="backspace" size={26} />
        </button>
      </div>
      <button className={`btn ${dark ? 'ink' : ''}`} style={{ minWidth: 200 }} onClick={onSubmit} disabled={busy || value.length < 6}>
        {busy ? '確認中…' : submitLabel}
      </button>
    </div>
  );
}

export function Unlock({ meta, onUnlocked }: { meta: LockMeta; onUnlocked: () => void }) {
  const [secret, setSecret] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [wait, setWait] = useState(lockoutRemaining());

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setInterval(() => setWait(lockoutRemaining()), 1000);
    return () => window.clearInterval(t);
  }, [wait]);

  const fail = (e: unknown) => {
    setMsg(e instanceof Error ? e.message : 'ロックを解除できませんでした');
    setShake(true);
    window.setTimeout(() => setShake(false), 400);
    setSecret('');
    setWait(lockoutRemaining());
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const key = await unlockWithSecret(secret);
      await store.open(key);
      onUnlocked();
    } catch (e) {
      fail(e instanceof LockoutError ? new Error('しばらく待ってから入力してください') : e);
    } finally {
      setBusy(false);
    }
  };

  const bio = async () => {
    setBusy(true);
    setMsg('');
    try {
      const key = await unlockWithBiometric();
      await store.open(key);
      onUnlocked();
    } catch (e) {
      setMsg(e instanceof DOMException && e.name === 'NotAllowedError' ? '認証がキャンセルされました' : e instanceof Error ? e.message : '認証できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const bioKey = meta.bio ? (
    <button className="fn" aria-label="指紋・顔認証で解除" onClick={bio} disabled={busy}>
      <Icon name="finger" size={30} />
    </button>
  ) : undefined;

  return (
    <div className="lock">
      <div className="col gap-4" style={{ alignItems: 'center' }}>
        <Icon name="lock" size={32} />
        <h1>カード請求ノート</h1>
        <p className="small">{meta.mode === 'pin' ? 'PINを入力してください' : 'パスワードを入力してください'}</p>
      </div>
      <div className={shake ? 'shake' : ''}>
        {wait > 0 ? (
          <p className="lock-msg">入力の失敗が続いたため、{Math.ceil(wait / 1000)}秒お待ちください</p>
        ) : (
          <SecretPad mode={meta.mode} value={secret} onChange={setSecret} onSubmit={submit} submitLabel="ロックを解除" busy={busy} extraKey={bioKey} dark />
        )}
      </div>
      {meta.bio && meta.mode === 'password' && (
        <button className="btn ink" onClick={bio} disabled={busy}>
          <Icon name="finger" /> 指紋・顔認証で解除
        </button>
      )}
      <p className="lock-msg" role="alert">
        {msg}
      </p>
    </div>
  );
}
