import { requireSupabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatRoom {
  id: string;
  class_id: string;
  student_id: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  sender_username?: string;
  message: string;
  created_at: string;
}

export interface ChatRoomWithMeta extends ChatRoom {
  class_name: string;
  student_username: string;
  last_message?: string;
  last_message_at?: string;
}

// ─── Get or Create Room ──────────────────────────────────────────────────────

export async function getOrCreateRoom(classId: string, studentId: string): Promise<ChatRoom> {
  const supabase = requireSupabase();
  // try to find existing
  const { data: existing } = await supabase
    .from('chat_rooms')
    .select('*')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (existing) return existing as ChatRoom;

  // create new
  const id = 'cr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const { data, error } = await supabase
    .from('chat_rooms')
    .insert({ id, class_id: classId, student_id: studentId, created_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data as ChatRoom;
}

// ─── List Rooms (with metadata) ──────────────────────────────────────────────

export async function listRooms(classId: string): Promise<ChatRoomWithMeta[]> {
  const supabase = requireSupabase();
  const { data: rooms, error } = await supabase
    .from('chat_rooms')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!rooms || rooms.length === 0) return [];

  // get student profiles
  const studentIds = [...new Set((rooms as { student_id: string }[]).map(r => r.student_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', studentIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  // get class name
  const { data: cls } = await supabase.from('classes').select('name').eq('id', classId).single();
  const className = (cls as Record<string, unknown> | null)?.name as string ?? '';

  // get last message per room
  const roomIds = (rooms as { id: string }[]).map(r => r.id);
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('room_id, message, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: false });

  const lastMsgMap = new Map<string, { message: string; created_at: string }>();
  (messages ?? []).forEach((m: Record<string, unknown>) => {
    const rid = String(m.room_id);
    if (!lastMsgMap.has(rid)) lastMsgMap.set(rid, { message: String(m.message), created_at: String(m.created_at) });
  });

  return (rooms as Record<string, unknown>[]).map(r => {
    const rid = String(r.id);
    const last = lastMsgMap.get(rid);
    return {
      id: rid,
      class_id: String(r.class_id),
      student_id: String(r.student_id),
      created_at: String(r.created_at),
      class_name: className,
      student_username: pMap.get(String(r.student_id)) ?? String(r.student_id),
      last_message: last?.message,
      last_message_at: last?.created_at,
    };
  });
}

// ─── List Rooms for Parent (across all classes) ──────────────────────────────

export async function listParentRooms(studentId: string): Promise<ChatRoomWithMeta[]> {
  const supabase = requireSupabase();
  const { data: rooms, error } = await supabase
    .from('chat_rooms')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!rooms || rooms.length === 0) return [];

  const classIds = [...new Set((rooms as { class_id: string }[]).map(r => r.class_id))];
  const { data: classes } = await supabase.from('classes').select('id, name').in('id', classIds);
  const cMap = new Map((classes ?? []).map((c: Record<string, unknown>) => [String(c.id), String(c.name ?? '')]));

  const { data: profile } = await supabase.from('profiles').select('username').eq('id', studentId).single();
  const studentUsername = String((profile as Record<string, unknown> | null)?.username ?? '');

  const roomIds = (rooms as { id: string }[]).map(r => r.id);
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('room_id, message, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: false });

  const lastMsgMap = new Map<string, { message: string; created_at: string }>();
  (messages ?? []).forEach((m: Record<string, unknown>) => {
    const rid = String(m.room_id);
    if (!lastMsgMap.has(rid)) lastMsgMap.set(rid, { message: String(m.message), created_at: String(m.created_at) });
  });

  return (rooms as Record<string, unknown>[]).map(r => {
    const rid = String(r.id);
    const last = lastMsgMap.get(rid);
    return {
      id: rid,
      class_id: String(r.class_id),
      student_id: String(r.student_id),
      created_at: String(r.created_at),
      class_name: cMap.get(String(r.class_id)) ?? '',
      student_username: studentUsername,
      last_message: last?.message,
      last_message_at: last?.created_at,
    };
  });
}

// ─── Messages ────────────────────────────────────────────────────────────────

export async function getMessages(roomId: string): Promise<ChatMessage[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  // resolve sender usernames
  const senderIds = [...new Set((data ?? []).map((m: Record<string, unknown>) => String(m.sender_id)))];
  const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', senderIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  return (data ?? []).map((m: Record<string, unknown>) => ({
    id: String(m.id),
    room_id: String(m.room_id),
    sender_id: String(m.sender_id),
    sender_username: pMap.get(String(m.sender_id)) ?? '',
    message: String(m.message),
    created_at: String(m.created_at),
  }));
}

export async function sendMessage(roomId: string, senderId: string, message: string): Promise<ChatMessage> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ room_id: roomId, sender_id: senderId, message, created_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return {
    id: String((data as Record<string, unknown>).id),
    room_id: roomId,
    sender_id: senderId,
    message,
    created_at: String((data as Record<string, unknown>).created_at),
  };
}

// ─── Realtime subscription ───────────────────────────────────────────────────

export function subscribeToRoom(roomId: string, onMessage: (msg: ChatMessage) => void): () => void {
  const supabase = requireSupabase();
  const channel = supabase
    .channel(`chat:${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
      (payload: { new: Record<string, unknown> }) => {
        const m = payload.new;
        onMessage({
          id: String(m.id),
          room_id: String(m.room_id),
          sender_id: String(m.sender_id),
          message: String(m.message),
          created_at: String(m.created_at),
        });
      })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
