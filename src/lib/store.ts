import Dexie, { type Table } from 'dexie';
import { useMemo, useSyncExternalStore } from 'react';
import { openJson, sealJson, type Sealed } from './crypto';
import { DEFAULT_SETTINGS, TABLES, type Settings, type TableName, type Tables } from './types';

/**
 * IndexedDB には暗号文だけを保存する。
 * records: キー "テーブル名:ID"、値は AES-GCM の暗号文（キーを AAD に使う）
 * meta:    ロック設定（PIN から鍵を導出するための salt と、包まれた鍵）。秘密情報は含まない
 */
interface EncRecord extends Sealed {
  k: string;
  t: TableName;
}
interface MetaRow {
  key: string;
  value: unknown;
}

class VaultDB extends Dexie {
  records!: Table<EncRecord, string>;
  meta!: Table<MetaRow, string>;
  constructor() {
    super('card-ledger');
    this.version(1).stores({ records: 'k, t', meta: 'key' });
  }
}

export const vdb = new VaultDB();

type WithId = { id: string };
type Data = { [K in TableName]: Map<string, Tables[K]> };
export type Snapshot = { [K in TableName]: Tables[K][] };
export type Op = { [K in TableName]: { t: K; put?: Tables[K][]; remove?: string[] } }[TableName];

const emptyData = (): Data => Object.fromEntries(TABLES.map((t) => [t, new Map()])) as unknown as Data;
const recKey = (t: TableName, id: string) => `${t}:${id}`;

class Store {
  private key: CryptoKey | null = null;
  private data: Data = emptyData();
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  private need(): CryptoKey {
    if (!this.key) throw new Error('ロックされています');
    return this.key;
  }

  get unlocked() {
    return this.key !== null;
  }

  /** 鍵を受け取り、全レコードを復号してメモリに展開する */
  async open(key: CryptoKey) {
    const recs = await vdb.records.toArray();
    const data = emptyData();
    for (const r of recs) {
      if (!TABLES.includes(r.t)) continue;
      const v = await openJson<WithId>(key, r, r.k);
      (data[r.t] as Map<string, unknown>).set(v.id, v);
    }
    this.key = key;
    this.data = data;
    this.emit();
  }

  /** ロック：鍵と復号済みデータをメモリから捨てる */
  lock() {
    this.key = null;
    this.data = emptyData();
    this.emit();
  }

  all<K extends TableName>(t: K): Tables[K][] {
    return [...this.data[t].values()];
  }

  get<K extends TableName>(t: K, id: string): Tables[K] | undefined {
    return this.data[t].get(id);
  }

  settings(): Settings {
    return this.get('settings', 'app') ?? DEFAULT_SETTINGS;
  }

  private async seal<K extends TableName>(t: K, v: Tables[K]): Promise<EncRecord> {
    const k = recKey(t, v.id);
    return { k, t, ...(await sealJson(this.need(), v, k)) };
  }

  async put<K extends TableName>(t: K, ...items: Tables[K][]) {
    await this.apply([{ t, put: items } as Op]);
  }

  async remove<K extends TableName>(t: K, ...ids: string[]) {
    await this.apply([{ t, remove: ids } as Op]);
  }

  /** 複数テーブルへの変更を 1 つのトランザクションで反映する */
  async apply(ops: Op[]) {
    // 暗号化（非同期）はトランザクションの外で済ませておく
    const puts: EncRecord[] = [];
    for (const op of ops) for (const v of op.put ?? []) puts.push(await this.seal(op.t, v));
    const dels = ops.flatMap((op) => (op.remove ?? []).map((id) => recKey(op.t, id)));
    await vdb.transaction('rw', vdb.records, async () => {
      if (dels.length) await vdb.records.bulkDelete(dels);
      if (puts.length) await vdb.records.bulkPut(puts);
    });
    for (const op of ops) {
      const m = this.data[op.t] as Map<string, unknown>;
      for (const id of op.remove ?? []) m.delete(id);
      for (const v of (op.put ?? []) as WithId[]) m.set(v.id, v);
    }
    this.emit();
  }

  /** 全データを入れ替える（バックアップからの復元） */
  async replaceAll(snap: Snapshot) {
    const puts: EncRecord[] = [];
    for (const t of TABLES) for (const v of snap[t]) puts.push(await this.seal(t, v as never));
    await vdb.transaction('rw', vdb.records, async () => {
      await vdb.records.clear();
      await vdb.records.bulkPut(puts);
    });
    const data = emptyData();
    for (const t of TABLES) for (const v of snap[t]) (data[t] as Map<string, unknown>).set(v.id, v);
    this.data = data;
    this.emit();
  }

  snapshot(): Snapshot {
    return Object.fromEntries(TABLES.map((t) => [t, this.all(t)])) as unknown as Snapshot;
  }
}

export const store = new Store();

/** ストアの変更で再描画するフック */
export function useVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}

export function useTable<K extends TableName>(t: K): Tables[K][] {
  const v = useVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => store.all(t), [t, v]);
}

export function useSettings(): Settings {
  const v = useVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => store.settings(), [v]);
}
