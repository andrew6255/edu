import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserDoc } from '@/lib/supabaseDocStore';
import { 
  type PersonalProgramMeta, 
  type PersonalProgramData,
  updatePersonalProgramData 
} from '@/lib/personalProgramService';

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string | null;
}

export default function EditProgramModal({ open, onClose, jobId }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [title, setTitle] = useState('');
  const [coverEmoji, setCoverEmoji] = useState('📄');
  const [programData, setProgramData] = useState<PersonalProgramData | null>(null);

  useEffect(() => {
    if (!open || !jobId || !user) return;
    let alive = true;
    
    async function load() {
      setLoading(true);
      try {
        const doc = await getUserDoc(user!.uid, 'personal_programs', jobId!);
        if (alive && doc) {
          const meta = doc as unknown as PersonalProgramMeta;
          setTitle(meta.title || '');
          setCoverEmoji(meta.coverEmoji || '📄');
          if (meta.programData) {
            // deep clone so we can mutate safely
            setProgramData(JSON.parse(JSON.stringify(meta.programData)));
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    
    return () => { alive = false; };
  }, [open, jobId, user]);

  if (!open) return null;

  async function handleSave() {
    if (!user || !jobId || !programData) return;
    setSaving(true);
    try {
      // Sync the title down to programData as well
      const updatedData = { ...programData, title };
      await updatePersonalProgramData(user.uid, jobId, title, coverEmoji, updatedData);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  function handleAddTopic(chIdx: number) {
    const newData = { ...programData! };
    if (!newData.chapters[chIdx]) {
      newData.chapters.push({ id: 'ch_' + crypto.randomUUID(), title: title || 'Chapter 1', topics: [] });
    }
    const topicId = 'topic_' + crypto.randomUUID();
    if (!newData.chapters[chIdx].topics) newData.chapters[chIdx].topics = [];
    newData.chapters[chIdx].topics!.push({
      id: topicId,
      title: 'New Question Type',
      questionTypeTitle: 'New Question Type',
      questionIds: []
    });
    setProgramData(newData);
  }

  function handleRemoveTopic(chIdx: number, tIdx: number) {
    if (!confirm('Remove this question type?')) return;
    const newData = { ...programData! };
    newData.chapters[chIdx].topics!.splice(tIdx, 1);
    setProgramData(newData);
  }

  function handleAddQuestion(chIdx: number, tIdx: number) {
    const newData = { ...programData! };
    const qId = 'q_' + crypto.randomUUID();
    newData.questions.push({
      id: qId,
      rawText: 'New question text...',
      page: 1,
      difficulty: 'medium',
      questionLabel: ''
    });
    if (!newData.chapters[chIdx].topics![tIdx].questionIds) {
      newData.chapters[chIdx].topics![tIdx].questionIds = [];
    }
    newData.chapters[chIdx].topics![tIdx].questionIds!.push(qId);
    setProgramData(newData);
  }

  function handleRemoveQuestion(chIdx: number, tIdx: number, qId: string) {
    if (!confirm('Remove this question?')) return;
    const newData = { ...programData! };
    const qIds = newData.chapters[chIdx].topics![tIdx].questionIds!;
    newData.chapters[chIdx].topics![tIdx].questionIds = qIds.filter(id => id !== qId);
    setProgramData(newData);
  }

  return (
    <div className="epm-overlay">
      <div className="epm-modal" onClick={e => e.stopPropagation()}>
        <div className="epm-header">
          <h2>Edit Program</h2>
          <button className="epm-close" onClick={onClose}>✕</button>
        </div>
        
        <div className="epm-body">
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ll-text-muted)' }}>Loading...</div>
          ) : !programData ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#ef4444' }}>Program data not found or still processing.</div>
          ) : (
            <div className="epm-form">
              {/* Basic Info */}
              <div className="epm-section">
                <label>Program Emoji & Title</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <input 
                    className="epm-input" 
                    value={coverEmoji} 
                    onChange={e => setCoverEmoji(e.target.value)} 
                    style={{ width: 60, textAlign: 'center', fontSize: 24 }}
                  />
                  <input 
                    className="epm-input" 
                    value={title} 
                    onChange={e => setTitle(e.target.value)} 
                    style={{ flex: 1, fontWeight: 'bold' }}
                  />
                </div>
              </div>

              {/* Chapters & Topics */}
              <div className="epm-section">
                <label>Question Types & Questions</label>
                {programData.chapters.length === 0 && (
                  <button className="ll-btn" onClick={() => {
                    const newData = { ...programData };
                    newData.chapters.push({ id: 'ch_' + crypto.randomUUID(), title: 'Chapter 1', topics: [] });
                    setProgramData(newData);
                  }}>
                    + Initialize Chapter
                  </button>
                )}
                {programData.chapters.map((chapter, chIdx) => (
                  <div key={chapter.id} className="epm-chapter">
                    {(chapter.topics || []).map((topic, tIdx) => (
                      <div key={topic.id} className="epm-topic">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <span style={{ color: '#8b5cf6', fontSize: 18 }}>🧠</span>
                          <input 
                            className="epm-input epm-input-topic"
                            value={topic.questionTypeTitle || topic.title}
                            onChange={e => {
                              const val = e.target.value;
                              const newData = { ...programData };
                              newData.chapters[chIdx].topics![tIdx].questionTypeTitle = val;
                              newData.chapters[chIdx].topics![tIdx].title = val;
                              setProgramData(newData);
                            }}
                            placeholder="Question Type Name"
                          />
                          <button 
                            className="epm-btn-danger"
                            onClick={() => handleRemoveTopic(chIdx, tIdx)}
                            title="Remove Question Type"
                          >
                            ✕
                          </button>
                        </div>
                        
                        <div className="epm-questions">
                          {(topic.questionIds || []).map((qId, qIdx) => {
                            const qIndex = programData.questions.findIndex(q => q.id === qId);
                            if (qIndex === -1) return null;
                            const question = programData.questions[qIndex];
                            
                            return (
                              <div key={qId} className="epm-question">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--ll-text-muted)' }}>
                                    Q{question.questionLabel || (qIdx + 1)}
                                  </div>
                                  <button 
                                    className="epm-btn-danger epm-btn-danger-small"
                                    onClick={() => handleRemoveQuestion(chIdx, tIdx, qId)}
                                    title="Remove Question"
                                  >
                                    ✕
                                  </button>
                                </div>
                                <textarea
                                  className="epm-textarea"
                                  value={question.rawText}
                                  onChange={e => {
                                    const newData = { ...programData };
                                    newData.questions[qIndex].rawText = e.target.value;
                                    setProgramData(newData);
                                  }}
                                  rows={3}
                                />
                              </div>
                            );
                          })}
                          
                          <button 
                            className="epm-btn-add"
                            onClick={() => handleAddQuestion(chIdx, tIdx)}
                          >
                            + Add Question
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    <button 
                      className="epm-btn-add-topic"
                      onClick={() => handleAddTopic(chIdx)}
                    >
                      + Add New Question Type
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="epm-footer">
          <button className="ll-btn" onClick={onClose} style={{ background: 'var(--ll-surface-2)' }}>Cancel</button>
          <button className="ll-btn ll-btn-primary" onClick={handleSave} disabled={loading || saving || !programData}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
      
      <style>{`
        .epm-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          z-index: 4000;
        }
        .epm-modal {
          background: radial-gradient(120% 120% at 50% 0%, var(--ll-surface-1) 0%, var(--ll-surface-0) 100%);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px;
          width: 90vw; max-width: 800px; max-height: 85vh;
          display: flex; flex-direction: column;
          box-shadow: 0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
          overflow: hidden;
        }
        .epm-header {
          padding: 24px 32px; border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex; align-items: center; justify-content: space-between;
          background: rgba(0,0,0,0.2);
        }
        .epm-header h2 { 
          margin: 0; font-size: 20px; font-weight: 800;
          background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .epm-close {
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); 
          color: var(--ll-text); border-radius: 50%; width: 32px; height: 32px;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; cursor: pointer; transition: all 0.2s;
        }
        .epm-close:hover { background: rgba(255,255,255,0.1); transform: scale(1.05); }
        .epm-body {
          padding: 32px; overflow-y: auto; flex: 1;
        }
        .epm-body::-webkit-scrollbar { width: 8px; }
        .epm-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .epm-section { margin-bottom: 40px; }
        .epm-section > label {
          display: block; font-size: 13px; font-weight: 800; color: #a5b4fc;
          text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px;
        }
        .epm-input {
          background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);
          color: var(--ll-text); padding: 14px 20px; border-radius: 12px;
          font-family: inherit; font-size: 15px; outline: none; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }
        .epm-input:focus, .epm-textarea:focus { 
          border-color: #8b5cf6; 
          background: rgba(139,92,246,0.05);
          box-shadow: 0 0 0 4px rgba(139,92,246,0.1), inset 0 2px 4px rgba(0,0,0,0.1);
        }
        .epm-input-topic { font-weight: 700; color: #c4b5fd; flex: 1; font-size: 16px; }
        .epm-topic {
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
          border-radius: 20px; padding: 24px; margin-bottom: 24px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        }
        .epm-questions { display: flex; flex-direction: column; gap: 16px; }
        .epm-question {
          background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);
          border-radius: 16px; padding: 16px; position: relative;
          transition: transform 0.2s;
        }
        .epm-question:hover { border-color: rgba(255,255,255,0.1); transform: translateY(-2px); }
        .epm-textarea {
          width: 100%; background: transparent; border: none;
          color: var(--ll-text-soft); font-family: inherit; font-size: 14px;
          line-height: 1.6; resize: vertical; outline: none; margin-top: 8px;
        }
        .epm-footer {
          padding: 24px 32px; border-top: 1px solid rgba(255,255,255,0.05);
          display: flex; justify-content: flex-end; gap: 16px; background: rgba(0,0,0,0.3);
        }
        .epm-btn-danger {
          background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2);
          color: #fca5a5; width: 32px; height: 32px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s; font-size: 14px;
        }
        .epm-btn-danger:hover { background: rgba(239, 68, 68, 0.2); transform: scale(1.05); }
        .epm-btn-danger-small { width: 24px; height: 24px; font-size: 10px; border-radius: 6px; }
        .epm-btn-add {
          background: rgba(96, 165, 250, 0.1); border: 1px dashed rgba(96, 165, 250, 0.3);
          color: #93c5fd; padding: 12px; border-radius: 12px; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.2s; text-align: center;
        }
        .epm-btn-add:hover { background: rgba(96, 165, 250, 0.15); border-color: rgba(96, 165, 250, 0.5); }
        .epm-btn-add-topic {
          background: rgba(139, 92, 246, 0.1); border: 1px dashed rgba(139, 92, 246, 0.3);
          color: #c4b5fd; padding: 16px; border-radius: 16px; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.2s; text-align: center; width: 100%; margin-top: 8px;
        }
        .epm-btn-add-topic:hover { background: rgba(139, 92, 246, 0.15); border-color: rgba(139, 92, 246, 0.5); }
      `}</style>
    </div>
  );
}
