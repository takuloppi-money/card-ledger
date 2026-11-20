import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Seg, toast } from '../components/ui';
import { biometricAvailable } from '../lib/biometric';
import { defaultCategories, defaultRules } from '../lib/categorize';
import { createVault, enableBiometric, validateSecret, type SecretMode } from '../lib/lock';
import { store } from '../lib/store';
import { DEFAULT_SETTINGS } from '../lib/types';
import { BackupRestore } from './BackupPanel';
import { CardForm } from './CardForm';
import { SecretPad } from './Unlock';

type Step = 'intro' | 'secret' | 'confirm' | 'card' | 'restore' | 'bio';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('intro');
  const [path, setPath] = useState<'new' | 'restore'>('new');
  const [mode, setMode] = useState<SecretMode>('pin');
  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [bioOk, setBioOk] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBioOk);
  }, []);

  const afterData = () => (bioOk ? setStep('bio') : finish());

  if (step === 'intro') {
    return (
      <div className="lock" style={{ justifyContent: 'flex-start', alignItems: 'stretch', paddingTop: 'calc(48px + env(safe-area-inset-top))' }}>
        <div className="col gap-8">
          <h1 style={{ fontSize: 28 }}>カード請求ノート</h1>
          <p>毎月のカード請求を記録して、少しずつ減らしていくためのアプリです。</p>
        </div>
        <div className="card col gap-8" style={{ borderColor: 'transparent' }}>
          <h3>データの守り方</h3>
          <ul className="plain">
            <li>記録はこのスマホの中だけに保存します。サーバーやクラウドには送りません。</li>
            <li>保存するデータはすべて暗号化し、PIN（またはFace ID）で開きます。</li>
            <li>
              <b>PINを忘れるとデータは取り出せません。</b>定期的に暗号化バックアップを書き出してください。
            </li>
          </ul>
        </div>
        <div className="col gap-8" style={{ marginTop: 'auto' }}>
          <button
            className="btn ink block"
            onClick={() => {
              setPath('new');
              setStep('secret');
            }}
          >
            はじめる
          </button>
          <button
            className="btn outline block"
            onClick={() => {
              setPath('restore');
              setStep('secret');
            }}
          >
            バックアップから復元する
          </button>
        </div>
      </div>
    );
  }

  if (step === 'secret' || step === 'confirm') {
    const isConfirm = step === 'confirm';
    const value = isConfirm ? confirmSecret : secret;
    return (
      <div className="lock">
        <div className="col gap-8" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Icon name="lock" size={32} />
          <h1>{isConfirm ? 'もう一度入力してください' : mode === 'pin' ? 'PINを決めてください' : 'パスワードを決めてください'}</h1>
          {!isConfirm && (
            <p className="small">
              {mode === 'pin' ? '6桁以上の数字。誕生日や連番は避けてください。' : '8文字以上。PINより推測されにくくなります。'}
            </p>
          )}
        </div>
        {!isConfirm && (
          <div style={{ width: '100%', maxWidth: 320 }}>
            <Seg
              label="ロックの方式"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setSecret('');
                setMsg('');
              }}
              options={[
                ['pin', '数字のPIN'],
                ['password', '英数字のパスワード'],
              ]}
            />
          </div>
        )}
        <SecretPad
          mode={mode}
          value={value}
          onChange={isConfirm ? setConfirm : setSecret}
          busy={busy}
          dark
          submitLabel={isConfirm ? '設定する' : '次へ'}
          onSubmit={async () => {
            setMsg('');
            if (!isConfirm) {
              const err = validateSecret(secret, mode);
              if (err) return setMsg(err);
              setConfirm('');
              setStep('confirm');
              return;
            }
            if (confirmSecret !== secret) {
              setMsg('一致しません。最初からやり直してください');
              setSecret('');
              setConfirm('');
              setStep('secret');
              return;
            }
            setBusy(true);
            try {
              const key = await createVault(secret, mode);
              await store.open(key);
              // 復元を選んだ場合も、途中でやめたときに困らないよう初期値を入れておく（復元すると置き換わる）
              const cats = defaultCategories();
              await store.apply([
                { t: 'categories', put: cats },
                { t: 'rules', put: defaultRules(cats) },
                { t: 'settings', put: [DEFAULT_SETTINGS] },
                { t: 'goals', put: [{ id: 'default', byCategory: {} }] },
              ]);
              setStep(path === 'new' ? 'card' : 'restore');
            } catch (e) {
              setMsg(e instanceof Error ? e.message : '設定に失敗しました');
            } finally {
              setBusy(false);
            }
          }}
        />
        <p className="lock-msg" role="alert">
          {msg}
        </p>
      </div>
    );
  }

  if (step === 'restore') {
    return (
      <div className="page" style={{ paddingTop: 'calc(32px + env(safe-area-inset-top))' }}>
        <h1>バックアップから復元</h1>
        <BackupRestore confirmReplace={false} onDone={afterData} />
        <button className="link-btn" onClick={() => setStep('card')}>
          復元せずに新しく始める
        </button>
      </div>
    );
  }

  if (step === 'card') {
    return (
      <div className="page" style={{ paddingTop: 'calc(32px + env(safe-area-inset-top))' }}>
        <h1>カードを登録</h1>
        <p className="sub small">締め日と支払日から、明細がどの月の請求になるかを計算します。カードはあとから追加できます。</p>
        <CardForm
          submitLabel="登録する"
          onSubmit={async (c) => {
            await store.put('cards', c);
            afterData();
          }}
        />
      </div>
    );
  }

  // step === 'bio'
  return (
    <div className="lock">
      <Icon name="face" size={48} />
      <div className="col gap-8" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h1>Face IDを使いますか？</h1>
        <p className="small">次回からFace IDでロックを解除できます。PINでも引き続き解除できます。</p>
      </div>
      <div className="col gap-8" style={{ width: '100%', maxWidth: 320 }}>
        <button
          className="btn ink block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await enableBiometric(secret);
              toast('Face IDを設定しました');
              finish();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : '設定できませんでした');
            } finally {
              setBusy(false);
            }
          }}
        >
          Face IDを設定する
        </button>
        <button className="btn outline block" onClick={finish}>
          あとで
        </button>
      </div>
      <p className="lock-msg" role="alert">
        {msg}
      </p>
    </div>
  );

  function finish() {
    setSecret('');
    setConfirm('');
    onDone();
  }
}
