import { getUserDoc, setUserDoc, listUserDocs, deleteUserDoc, type DocData } from './supabaseDocStore';

export interface PersonalSubject {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
}

const COLLECTION = 'personal_subjects';

// ─── AI Emoji Picker ──────────────────────────────────────────────────────────
// Cache to avoid redundant API calls for the same subject name.
const _emojiCache = new Map<string, string>();

/**
 * Uses the Groq LLM to pick the single most fitting emoji for the given subject
 * name. Works for any language (e.g. "Français", "Physik", "数学").
 * Pass `excludedEmojis` to prevent the AI from reusing an emoji already in use.
 * Falls back to 📘 silently if the API key is missing or the call fails.
 */
export async function getEmojiForSubject(name: string, excludedEmojis: string[] = []): Promise<string> {
  // Cache key includes excluded emojis so different exclusion sets don't collide.
  const key = name.trim().toLowerCase() + '|' + excludedEmojis.sort().join('');
  if (_emojiCache.has(key)) return _emojiCache.get(key)!;

  const apiKey = (import.meta.env.VITE_GROQ_API_KEY as string | undefined)?.trim();
  if (!apiKey) return '📘';

  const exclusionLine = excludedEmojis.length > 0
    ? `\nDo NOT use any of these emojis (they are already taken): ${excludedEmojis.join(' ')}.`
    : '';

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `You are a creative emoji selector for school subjects. The user gives you a subject name (in any language). You must pick ONE emoji that is:
- DISTINCTIVE and SPECIFIC to that subject (not generic)
- CULTURALLY meaningful when the subject is a language or culture (e.g. Arabic → 🕌, Japanese → ⛩️, French → 🗼)
- VISUALLY evocative of the field (e.g. Physics → ⚛️, Biology → 🧬, Music → 🎵)
- NEVER a plain book, pencil, or writing emoji (📚 📖 📝 ✏️ 📓 📒 📔) unless absolutely nothing else exists
- Reply with ONLY the single emoji character. No words, spaces, or punctuation.${exclusionLine}`,
          },
          { role: 'user', content: name.trim() },
        ],
        temperature: 0.5,
        max_tokens: 5,
      }),
    });

    if (!res.ok) return '📘';

    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content?.trim() ?? '';
    // Extract the first emoji-like character from the response
    const match = raw.match(/\p{Emoji}/u);
    const emoji = match ? match[0] : '📘';

    _emojiCache.set(key, emoji);
    return emoji;
  } catch {
    return '📘';
  }
}

export async function listPersonalSubjects(uid: string): Promise<PersonalSubject[]> {
  const docs = await listUserDocs(uid, COLLECTION);
  return docs.map(d => d.data as unknown as PersonalSubject)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createPersonalSubject(uid: string, name: string, emoji?: string, excludedEmojis: string[] = []): Promise<PersonalSubject> {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
  // Use user-provided emoji if given, otherwise ask the AI (passing existing emojis to avoid duplicates).
  const finalEmoji = emoji?.trim() || await getEmojiForSubject(name, excludedEmojis);

  const subject: PersonalSubject = {
    id,
    name: name.trim(),
    emoji: finalEmoji,
    createdAt: new Date().toISOString()
  };

  await setUserDoc(uid, COLLECTION, id, subject as unknown as DocData);
  return subject;
}

export async function updatePersonalSubject(uid: string, id: string, name: string, emoji: string, excludedEmojis: string[] = []): Promise<PersonalSubject> {
  const existing = await getUserDoc(uid, COLLECTION, id);
  if (!existing) throw new Error('Subject not found');

  // If the emoji field was cleared, ask the AI for a fresh one (avoiding duplicates).
  const finalEmoji = emoji.trim() || await getEmojiForSubject(name, excludedEmojis);

  const updated: PersonalSubject = {
    ...(existing as unknown as PersonalSubject),
    name: name.trim(),
    emoji: finalEmoji,
  };

  await setUserDoc(uid, COLLECTION, id, updated as unknown as DocData);
  return updated;
}

export async function deletePersonalSubject(uid: string, id: string): Promise<void> {
  await deleteUserDoc(uid, COLLECTION, id);
}
