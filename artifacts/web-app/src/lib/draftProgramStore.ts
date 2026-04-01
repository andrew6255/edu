import type { PublicProgram } from '@/lib/programMaps';

type DraftStore = {
  programs: Record<string, PublicProgram>;
};

function getStore(): DraftStore {
  const g = globalThis as any;
  if (!g.__llDraftStore) {
    g.__llDraftStore = { programs: {} } satisfies DraftStore;
  }
  return g.__llDraftStore as DraftStore;
}

export function setDraftProgram(key: string, program: PublicProgram): void {
  const store = getStore();
  store.programs[key] = program;
}

export function getDraftProgram(key: string): PublicProgram | null {
  const store = getStore();
  return store.programs[key] ?? null;
}

export function clearDraftProgram(key: string): void {
  const store = getStore();
  delete store.programs[key];
}
