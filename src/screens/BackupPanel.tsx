import { useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Field, toast } from '../components/ui';
import { backupFileName, exportBackup, importBackup } from '../lib/backup';
import { store, useSettings } from '../lib/store';

const PASS_MIN = 10;

/** 端末に保存させる。共有メニューが使えればファイルAppやAirDropを選べる */
async function saveFile(blob: Blob, name: string) {
  const file = new File([blob], name, { type: 'application/octet-stream' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return true;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return true;
}

export function BackupExport() {
  const settings = useSettings();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = pass.length < PASS_MIN;
  const mismatch = pass2 !== '' && pass !== pass2;

  return (
    <div className="col gap-12">
      <p className="small">
        すべてのデータを、パスワードで暗号化したファイル（.cardbackup）に書き出します。ファイルAppやAirDropで保存してください。
      </p>
      <p className="notice warn">パスワードを忘れると復元できません。アプリのPINとは別の、長めのパスワードを推奨します。</p>
      <Field label={`バックアップ用パスワード（${PASS_MIN}文字以上）`}>
        <input className="input" type="password" autoComplete="new-password" value={pass} maxLength={128} onChange={(e) => setPass(e.target.value)} />
      </Field>
      <Field label="もう一度入力">
        <input className="input" type="password" autoComplete="new-password" value={pass2} maxLength={128} onChange={(e) => setPass2(e.target.value)} />
      </Field>
      {mismatch && <p className="small danger">パスワードが一致しません</p>}
      <button
        className="btn block"
        disabled={busy || tooShort || pass !== pass2}
        onClick={async () => {
          setBusy(true);
          try {
            const blob = await exportBackup(store.snapshot(), pass);
            if (await saveFile(blob, backupFileName())) {
              await store.put('settings', { ...settings, lastBackupAt: Date.now() });
              toast('バックアップを書き出しました');
              setPass('');
              setPass2('');
            }
          } catch (e) {
            toast(e instanceof Error ? e.message : '書き出しに失敗しました');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="download" /> {busy ? '暗号化しています…' : '暗号化して書き出す'}
      </button>
      {settings.lastBackupAt && <p className="tiny sub">前回のバックアップ：{new Date(settings.lastBackupAt).toLocaleString('ja-JP')}</p>}
    </div>
  );
}

export function BackupRestore({ onDone, confirmReplace = true }: { onDone?: () => void; confirmReplace?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  return (
    <div className="col gap-12">
      <input
        ref={fileRef}
        type="file"
        accept=".cardbackup,application/octet-stream,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 50 * 1024 * 1024) {
            setErr('ファイルが大きすぎます');
            return;
          }
          setFileText(await f.text());
          setFileName(f.name);
          setErr('');
        }}
      />
      <button className="btn ghost block" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" /> {fileName ? `選択中：${fileName}` : 'バックアップファイルを選ぶ'}
      </button>
      {fileText && (
        <>
          <Field label="バックアップ用パスワード">
            <input className="input" type="password" autoComplete="off" value={pass} maxLength={128} onChange={(e) => setPass(e.target.value)} />
          </Field>
          <button
            className="btn block"
            disabled={busy || !pass}
            onClick={async () => {
              if (confirmReplace && !confirm('今あるデータはすべてバックアップの内容に置き換わります。よろしいですか？')) return;
              setBusy(true);
              setErr('');
              try {
                const snap = await importBackup(fileText, pass);
                await store.replaceAll(snap);
                toast(`復元しました（明細 ${snap.txns.length}件）`);
                setFileText(null);
                setFileName('');
                setPass('');
                onDone?.();
              } catch (e) {
                setErr(e instanceof Error ? e.message : '復元に失敗しました');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '復号しています…' : '復元する'}
          </button>
        </>
      )}
      {err && (
        <p className="small danger" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
