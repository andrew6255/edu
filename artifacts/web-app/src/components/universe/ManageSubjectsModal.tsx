import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  type PersonalSubject,
  listPersonalSubjects,
  createPersonalSubject,
  updatePersonalSubject,
  deletePersonalSubject
} from '@/lib/personalSubjectService';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ManageSubjectsModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<PersonalSubject[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [creating, setCreating] = useState(false);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    let alive = true;
    setLoading(true);
    listPersonalSubjects(user.uid).then(list => {
      if (alive) {
        setSubjects(list);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, [open, user]);

  if (!open || !user) return null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const existingEmojis = subjects.map(s => s.emoji).filter(Boolean);
      const created = await createPersonalSubject(user!.uid, newName, newEmoji, existingEmojis);
      setSubjects(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewEmoji('');
      window.dispatchEvent(new Event('ll:subjectsUpdated'));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) return;
    try {
      // Exclude emojis of all OTHER subjects (the one being edited can keep or change its emoji).
      const existingEmojis = subjects.filter(s => s.id !== id).map(s => s.emoji).filter(Boolean);
      const updated = await updatePersonalSubject(user!.uid, id, editName, editEmoji, existingEmojis);
      setSubjects(prev => prev.map(s => s.id === id ? updated : s).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingId(null);
      window.dispatchEvent(new Event('ll:subjectsUpdated'));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this subject? Your worksheets will become Uncategorized.')) return;
    try {
      await deletePersonalSubject(user!.uid, id);
      setSubjects(prev => prev.filter(s => s.id !== id));
      window.dispatchEvent(new Event('ll:subjectsUpdated'));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
      background: 'rgba(0,0,0,0.72)'
    }} onClick={onClose}>
      <div style={{
        width: 'min(600px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        background: 'var(--ll-surface-0)', borderRadius: 18, border: '2px solid var(--ll-border)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.65)'
      }} onClick={e => e.stopPropagation()}>
        
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--ll-border)', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 20, marginRight: 10 }}>📚</span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, flex: 1, color: 'var(--ll-text)' }}>My Subjects</h2>
          <button className="ll-btn" onClick={onClose} style={{ padding: '6px 10px', fontSize: 12 }}>✕ Close</button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          <form onSubmit={handleCreate} style={{
            display: 'flex', gap: 10, background: 'var(--ll-surface-1)',
            padding: 16, borderRadius: 12, border: '1px solid var(--ll-border)',
            marginBottom: 24, alignItems: 'center'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', width: 60 }}>
              <label style={{ fontSize: 11, color: 'var(--ll-text-muted)', marginBottom: 4 }}>Emoji</label>
              <input
                value={newEmoji} onChange={e => setNewEmoji(e.target.value)}
                placeholder="Auto"
                style={{
                  padding: '8px', borderRadius: 8, border: '1px solid var(--ll-border)',
                  background: 'var(--ll-surface-0)', color: 'var(--ll-text)', textAlign: 'center',
                  fontFamily: 'inherit'
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--ll-text-muted)', marginBottom: 4 }}>Subject Name</label>
              <input
                value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Mathematics"
                style={{
                  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--ll-border)',
                  background: 'var(--ll-surface-0)', color: 'var(--ll-text)', fontFamily: 'inherit'
                }}
              />
            </div>
            <button
              type="submit" disabled={creating || !newName.trim()}
              className="ll-btn ll-btn-primary"
              style={{ padding: '10px 16px', marginTop: 18 }}
            >
              Add
            </button>
          </form>

          {loading ? (
            <div style={{ color: 'var(--ll-text-muted)', textAlign: 'center' }}>Loading subjects...</div>
          ) : subjects.length === 0 ? (
            <div style={{ color: 'var(--ll-text-soft)', textAlign: 'center' }}>No subjects added yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {subjects.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  background: 'var(--ll-surface-1)', borderRadius: 12, border: '1px solid var(--ll-border)'
                }}>
                  {editingId === s.id ? (
                    <>
                      <input
                        value={editEmoji} onChange={e => setEditEmoji(e.target.value)}
                        style={{ width: 44, padding: '6px', borderRadius: 6, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)', textAlign: 'center' }}
                      />
                      <input
                        value={editName} onChange={e => setEditName(e.target.value)}
                        style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)' }}
                      />
                      <button className="ll-btn ll-btn-primary" onClick={() => handleSaveEdit(s.id)} style={{ padding: '6px 12px', fontSize: 11 }}>Save</button>
                      <button className="ll-btn" onClick={() => setEditingId(null)} style={{ padding: '6px 12px', fontSize: 11 }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 24, width: 32, textAlign: 'center' }}>{s.emoji}</div>
                      <div style={{ flex: 1, fontWeight: 'bold', fontSize: 14, color: 'var(--ll-text)' }}>{s.name}</div>
                      <button className="ll-btn" onClick={() => { setEditingId(s.id); setEditName(s.name); setEditEmoji(s.emoji); }} style={{ padding: '6px 12px', fontSize: 11 }}>Edit</button>
                      <button className="ll-btn" onClick={() => handleDelete(s.id)} style={{ padding: '6px 12px', fontSize: 11, borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}>Delete</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
