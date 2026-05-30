import { useState, useEffect, useRef } from 'react';
import {
  listRooms,
  listParentRooms,
  getOrCreateRoom,
  getMessages,
  sendMessage,
  subscribeToRoom,
  type ChatRoomWithMeta,
  type ChatMessage,
} from '@/lib/chatService';

interface ChatWidgetProps {
  /** Current user's id */
  userId: string;
  /** Current user's username */
  username: string;
  /** For teacher/TA: class_id to scope rooms. Null for parent mode. */
  classId?: string | null;
  /** For parent mode: the student_id to find rooms. */
  studentId?: string | null;
  /** Accent color */
  color?: string;
  /** Called when user wants to close the chat */
  onClose: () => void;
}

const cardStyle: React.CSSProperties = {
  background: '#1e293b', borderRadius: 10, border: '1px solid #334155',
};

export default function ChatWidget({ userId, username, classId, studentId, color = '#3b82f6', onClose }: ChatWidgetProps) {
  const [rooms, setRooms] = useState<ChatRoomWithMeta[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoomWithMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => { loadRooms(); return () => { unsubRef.current?.(); }; }, []);

  async function loadRooms() {
    setLoadingRooms(true);
    try {
      if (studentId) {
        setRooms(await listParentRooms(studentId));
      } else if (classId) {
        setRooms(await listRooms(classId));
      }
    } catch (e) { console.error(e); }
    finally { setLoadingRooms(false); }
  }

  async function openRoom(room: ChatRoomWithMeta) {
    unsubRef.current?.();
    setSelectedRoom(room);
    setLoadingMsgs(true);
    try {
      setMessages(await getMessages(room.id));
    } catch (e) { console.error(e); }
    finally { setLoadingMsgs(false); }
    // realtime
    unsubRef.current = subscribeToRoom(room.id, (msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, { ...msg, sender_username: msg.sender_id === userId ? username : '' }];
      });
    });
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function handleSend() {
    if (!selectedRoom || !newMsg.trim() || sending) return;
    setSending(true);
    try {
      const sent = await sendMessage(selectedRoom.id, userId, newMsg.trim());
      setMessages(prev => {
        if (prev.some(m => m.id === sent.id)) return prev;
        return [...prev, { ...sent, sender_username: username }];
      });
      setNewMsg('');
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  }

  // ─── Chat Room View ────────────────────────────────────────────────────

  if (selectedRoom) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
        {/* header */}
        <div style={{ padding: '10px 16px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => { unsubRef.current?.(); setSelectedRoom(null); }} style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
            background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer',
          }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>
              💬 {selectedRoom.student_username}
            </div>
            <div style={{ color: '#64748b', fontSize: 10 }}>{selectedRoom.class_name}</div>
          </div>
        </div>

        {/* messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loadingMsgs ? (
            <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading messages...</div>
          ) : messages.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30, fontSize: 13 }}>
              No messages yet. Start the conversation!
            </div>
          ) : (
            messages.map(m => {
              const isMe = m.sender_id === userId;
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '75%', padding: '8px 12px', borderRadius: 12,
                    background: isMe ? `${color}22` : '#1e293b',
                    border: `1px solid ${isMe ? `${color}44` : '#334155'}`,
                  }}>
                    {!isMe && m.sender_username && (
                      <div style={{ color, fontSize: 10, fontWeight: 'bold', marginBottom: 2 }}>{m.sender_username}</div>
                    )}
                    <div style={{ color: 'white', fontSize: 13, lineHeight: 1.5 }}>{m.message}</div>
                    <div style={{ color: '#475569', fontSize: 9, textAlign: 'right', marginTop: 2 }}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* input */}
        <div style={{ padding: '10px 16px', background: '#1e293b', borderTop: '1px solid #334155', flexShrink: 0, display: 'flex', gap: 8 }}>
          <input
            value={newMsg}
            onChange={e => setNewMsg(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message..."
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #475569',
              background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!newMsg.trim() || sending}
            style={{
              padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
              background: `${color}22`, border: `1px solid ${color}55`, color,
              cursor: !newMsg.trim() || sending ? 'default' : 'pointer',
              opacity: !newMsg.trim() || sending ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  // ─── Rooms List ────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      <div style={{ padding: '10px 16px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, color: 'white', fontSize: 15 }}>💬 Chat Rooms</h3>
        <button onClick={onClose} style={{
          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
          background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer',
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loadingRooms ? (
          <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading...</div>
        ) : rooms.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
            <div>No chat rooms yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rooms.map(room => (
              <button
                key={room.id}
                onClick={() => openRoom(room)}
                style={{
                  ...cardStyle, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: `hsl(${(room.student_username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 'bold', color: 'white', fontSize: 14,
                }}>
                  {(room.student_username[0] || '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{room.student_username}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>
                    {studentId ? room.class_name : ''}
                    {room.last_message ? (studentId && room.class_name ? ' · ' : '') + room.last_message.slice(0, 40) + (room.last_message.length > 40 ? '…' : '') : 'No messages yet'}
                  </div>
                </div>
                {room.last_message_at && (
                  <div style={{ color: '#475569', fontSize: 10, flexShrink: 0 }}>
                    {new Date(room.last_message_at).toLocaleDateString()}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
