import { getUserDoc, setUserDoc, listUserDocs, deleteUserDoc, type DocData } from './supabaseDocStore';

export interface PersonalSubject {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
}

const COLLECTION = 'personal_subjects';

const DEFAULT_EMOJIS: Record<string, string> = {
  math: '📐',
  mathematics: '📐',
  algebra: '🧮',
  geometry: '🔺',
  calculus: '📈',
  science: '🔬',
  physics: '⚛️',
  chemistry: '🧪',
  biology: '🧬',
  english: '📚',
  literature: '📖',
  history: '🏛️',
  geography: '🌍',
  art: '🎨',
  music: '🎵',
  computer: '💻',
  coding: '⌨️',
  programming: '👨‍💻',
  language: '🗣️',
  spanish: '🇪🇸',
  french: '🇫🇷',
};

export function getFallbackEmoji(name: string): string {
  const normalized = name.toLowerCase().trim();
  for (const [key, emoji] of Object.entries(DEFAULT_EMOJIS)) {
    if (normalized.includes(key)) return emoji;
  }
  return '📘';
}

export async function listPersonalSubjects(uid: string): Promise<PersonalSubject[]> {
  const docs = await listUserDocs(uid, COLLECTION);
  return docs.map(d => d.data as unknown as PersonalSubject)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createPersonalSubject(uid: string, name: string, emoji?: string): Promise<PersonalSubject> {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
  const finalEmoji = emoji?.trim() || getFallbackEmoji(name);
  
  const subject: PersonalSubject = {
    id,
    name: name.trim(),
    emoji: finalEmoji,
    createdAt: new Date().toISOString()
  };

  await setUserDoc(uid, COLLECTION, id, subject as unknown as DocData);
  return subject;
}

export async function updatePersonalSubject(uid: string, id: string, name: string, emoji: string): Promise<PersonalSubject> {
  const existing = await getUserDoc(uid, COLLECTION, id);
  if (!existing) throw new Error('Subject not found');

  const updated: PersonalSubject = {
    ...(existing as unknown as PersonalSubject),
    name: name.trim(),
    emoji: emoji.trim() || getFallbackEmoji(name),
  };

  await setUserDoc(uid, COLLECTION, id, updated as unknown as DocData);
  return updated;
}

export async function deletePersonalSubject(uid: string, id: string): Promise<void> {
  await deleteUserDoc(uid, COLLECTION, id);
}
