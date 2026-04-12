/**
 * Generic document store backed by Supabase.
 *
 * Two tables:
 *   user_docs (user_id, collection, doc_id, data jsonb)   – per-user subcollections
 *   global_docs (collection, doc_id, data jsonb)           – shared collections
 *
 * Provides get/set/update/delete/query/listen helpers.
 */

import { requireSupabase } from './supabase';

export type DocData = Record<string, unknown>;

// ─── User-scoped documents ──────────────────────────────────────────────────────

export async function getUserDoc(uid: string, col: string, docId: string): Promise<DocData | null> {
  const { data, error } = await requireSupabase()
    .from('user_docs')
    .select('data')
    .eq('user_id', uid)
    .eq('collection', col)
    .eq('doc_id', docId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.data as DocData) : null;
}

export async function setUserDoc(uid: string, col: string, docId: string, value: DocData, merge = false): Promise<void> {
  let final = value;
  if (merge) {
    const existing = await getUserDoc(uid, col, docId);
    if (existing) final = deepMerge(existing, value);
  }
  const { error } = await requireSupabase()
    .from('user_docs')
    .upsert({ user_id: uid, collection: col, doc_id: docId, data: final, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function updateUserDoc(uid: string, col: string, docId: string, patch: DocData): Promise<void> {
  const existing = await getUserDoc(uid, col, docId);
  if (!existing) throw new Error(`Document not found: user_docs/${uid}/${col}/${docId}`);
  const merged = applyPatch(existing, patch);
  const { error } = await requireSupabase()
    .from('user_docs')
    .upsert({ user_id: uid, collection: col, doc_id: docId, data: merged, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteUserDoc(uid: string, col: string, docId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('user_docs')
    .delete()
    .eq('user_id', uid)
    .eq('collection', col)
    .eq('doc_id', docId);
  if (error) throw error;
}

export async function listUserDocs(uid: string, col: string): Promise<Array<{ id: string; data: DocData }>> {
  const { data, error } = await requireSupabase()
    .from('user_docs')
    .select('doc_id, data')
    .eq('user_id', uid)
    .eq('collection', col);
  if (error) throw error;
  return (data ?? []).map(row => ({ id: row.doc_id, data: row.data as DocData }));
}

// ─── Global documents ───────────────────────────────────────────────────────────

export async function getGlobalDoc(col: string, docId: string): Promise<DocData | null> {
  const { data, error } = await requireSupabase()
    .from('global_docs')
    .select('data')
    .eq('collection', col)
    .eq('doc_id', docId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.data as DocData) : null;
}

export async function setGlobalDoc(col: string, docId: string, value: DocData, merge = false): Promise<void> {
  let final = value;
  if (merge) {
    const existing = await getGlobalDoc(col, docId);
    if (existing) final = deepMerge(existing, value);
  }
  const { error } = await requireSupabase()
    .from('global_docs')
    .upsert({ collection: col, doc_id: docId, data: final, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function updateGlobalDoc(col: string, docId: string, patch: DocData): Promise<void> {
  const existing = await getGlobalDoc(col, docId);
  if (!existing) throw new Error(`Document not found: global_docs/${col}/${docId}`);
  const merged = applyPatch(existing, patch);
  const { error } = await requireSupabase()
    .from('global_docs')
    .upsert({ collection: col, doc_id: docId, data: merged, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteGlobalDoc(col: string, docId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('global_docs')
    .delete()
    .eq('collection', col)
    .eq('doc_id', docId);
  if (error) throw error;
}

export async function queryGlobalDocs(
  col: string,
  filters?: Array<{ field: string; op: 'eq' | 'neq'; value: string }>,
  orderField?: string,
  ascending = true
): Promise<Array<{ id: string; data: DocData }>> {
  let q = requireSupabase()
    .from('global_docs')
    .select('doc_id, data')
    .eq('collection', col);

  if (filters) {
    for (const f of filters) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (f.op === 'eq') q = (q as any).eq(`data->>${f.field}`, f.value);
      else if (f.op === 'neq') q = (q as any).neq(`data->>${f.field}`, f.value);
    }
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(row => ({ id: row.doc_id, data: row.data as DocData }));
}

// ─── Realtime listeners ─────────────────────────────────────────────────────────

export function listenGlobalDoc(col: string, docId: string, cb: (data: DocData) => void): () => void {
  const supabase = requireSupabase();
  const channel = supabase
    .channel(`global:${col}:${docId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'global_docs',
      filter: `collection=eq.${col}`,
    }, (payload) => {
      const row = (payload.new ?? {}) as Record<string, unknown>;
      if (row.doc_id === docId && row.data) {
        cb(row.data as DocData);
      }
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function listenGlobalCollection(
  col: string,
  filters: Array<{ field: string; value: string }>,
  cb: (docs: Array<{ id: string; data: DocData }>) => void
): () => void {
  // Initial fetch
  const filterArgs = filters.map(f => ({ field: f.field, op: 'eq' as const, value: f.value }));
  queryGlobalDocs(col, filterArgs).then(cb).catch(err => console.warn('listenGlobalCollection initial fetch:', err));

  const supabase = requireSupabase();
  const channel = supabase
    .channel(`global_col:${col}:${JSON.stringify(filters)}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'global_docs',
      filter: `collection=eq.${col}`,
    }, () => {
      // Re-fetch on any change to this collection
      queryGlobalDocs(col, filterArgs).then(cb).catch(err => console.warn('listenGlobalCollection update:', err));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function listenUserDoc(uid: string, col: string, docId: string, cb: (data: DocData) => void): () => void {
  const supabase = requireSupabase();
  const channel = supabase
    .channel(`user:${uid}:${col}:${docId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'user_docs',
      filter: `user_id=eq.${uid}`,
    }, (payload) => {
      const row = (payload.new ?? {}) as Record<string, unknown>;
      if (row.collection === col && row.doc_id === docId && row.data) {
        cb(row.data as DocData);
      }
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ─── Transaction helper ─────────────────────────────────────────────────────────

export interface DocTx {
  getUserDoc(uid: string, col: string, docId: string): Promise<DocData | null>;
  getGlobalDoc(col: string, docId: string): Promise<DocData | null>;
  setUserDoc(uid: string, col: string, docId: string, data: DocData): void;
  updateUserDoc(uid: string, col: string, docId: string, patch: DocData): void;
  setGlobalDoc(col: string, docId: string, data: DocData): void;
  updateGlobalDoc(col: string, docId: string, patch: DocData): void;
}

export async function runDocTransaction(fn: (tx: DocTx) => Promise<void>): Promise<void> {
  const cache = new Map<string, DocData | null>();
  const writes: Array<() => Promise<void>> = [];

  const tx: DocTx = {
    async getUserDoc(uid, col, docId) {
      const key = `u:${uid}:${col}:${docId}`;
      if (!cache.has(key)) cache.set(key, await getUserDoc(uid, col, docId));
      return cache.get(key) ?? null;
    },
    async getGlobalDoc(col, docId) {
      const key = `g:${col}:${docId}`;
      if (!cache.has(key)) cache.set(key, await getGlobalDoc(col, docId));
      return cache.get(key) ?? null;
    },
    setUserDoc(uid, col, docId, data) {
      cache.set(`u:${uid}:${col}:${docId}`, data);
      writes.push(() => setUserDoc(uid, col, docId, data));
    },
    updateUserDoc(uid, col, docId, patch) {
      const key = `u:${uid}:${col}:${docId}`;
      const existing = cache.get(key);
      const merged = existing ? applyPatch(existing, patch) : patch;
      cache.set(key, merged);
      writes.push(() => setUserDoc(uid, col, docId, merged));
    },
    setGlobalDoc(col, docId, data) {
      cache.set(`g:${col}:${docId}`, data);
      writes.push(() => setGlobalDoc(col, docId, data));
    },
    updateGlobalDoc(col, docId, patch) {
      const key = `g:${col}:${docId}`;
      const existing = cache.get(key);
      const merged = existing ? applyPatch(existing, patch) : patch;
      cache.set(key, merged);
      writes.push(() => setGlobalDoc(col, docId, merged));
    },
  };

  await fn(tx);
  for (const w of writes) await w();
}

// ─── Merge / patch helpers ──────────────────────────────────────────────────────

function deepMerge(target: DocData, source: DocData): DocData {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(tv as DocData, sv as DocData);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

function applyPatch(existing: DocData, patch: DocData): DocData {
  const result = deepMerge({}, existing);
  for (const [key, value] of Object.entries(patch)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let current: any = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    } else {
      (result as any)[key] = value;
    }
  }
  return result;
}

/** Atomic increment helper — use in patch objects */
export function resolveIncrement(existing: DocData, field: string, delta: number): number {
  const current = typeof (existing as any)[field] === 'number' ? (existing as any)[field] : 0;
  return current + delta;
}

/** Array union helper — use in patch objects */
export function resolveArrayUnion(existing: DocData, field: string, ...elements: unknown[]): unknown[] {
  const parts = field.split('.');
  let current: any = existing;
  for (const p of parts) {
    current = current?.[p];
  }
  const arr = Array.isArray(current) ? [...current] : [];
  for (const el of elements) {
    if (!arr.includes(el)) arr.push(el);
  }
  return arr;
}
