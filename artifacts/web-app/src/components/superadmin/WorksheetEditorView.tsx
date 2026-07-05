import { useState } from 'react';
import type { BuilderNode, BuilderQuestionTypeFile, BuilderQuestion } from '@/lib/programBuilder';
import { makeStableId } from '@/lib/programBuilder';
import katex from 'katex';

const LatexRenderer = ({ content }: { content?: string }) => {
  if (!content) return null;
  const parts = content.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const math = part.slice(2, -2);
          try { return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: true }) }} />; }
          catch { return <span key={i}>{part}</span>; }
        }
        if (part.startsWith('$') && part.endsWith('$')) {
          const math = part.slice(1, -1);
          try { return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: false }) }} />; }
          catch { return <span key={i}>{part}</span>; }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

interface WorksheetEditorViewProps {
  worksheetNode: BuilderNode;
  onUpdate: (updater: (n: BuilderNode) => BuilderNode) => void;
  onClose: () => void;
}

export default function WorksheetEditorView({ worksheetNode, onUpdate, onClose }: WorksheetEditorViewProps) {
  const [selectedQtId, setSelectedQtId] = useState<string | null>(null);
  const [editingQtId, setEditingQtId] = useState<string | null>(null);

  // Parse questions for selected QT
  const selectedQt = worksheetNode.questionTypes.find(qt => qt.id === selectedQtId);
  let questions: BuilderQuestion[] = [];
  if (selectedQt) {
    try {
      questions = JSON.parse(selectedQt.jsonText) || [];
    } catch {
      questions = [];
    }
  }

  function handleAddQuestionType() {
    const id = makeStableId('qt');
    const newQt: BuilderQuestionTypeFile = {
      id,
      title: 'New Question Type',
      jsonText: '[]'
    };
    onUpdate(n => ({
      ...n,
      questionTypes: [...n.questionTypes, newQt]
    }));
    setSelectedQtId(id);
    setEditingQtId(id);
  }

  function handleDeleteQt(id: string) {
    if (!window.confirm('Delete this question type and all its questions?')) return;
    if (selectedQtId === id) setSelectedQtId(null);
    onUpdate(n => ({
      ...n,
      questionTypes: n.questionTypes.filter(qt => qt.id !== id)
    }));
  }

  function handleRenameQt(id: string, newTitle: string) {
    onUpdate(n => ({
      ...n,
      questionTypes: n.questionTypes.map(qt => qt.id === id ? { ...qt, title: newTitle } : qt)
    }));
  }

  function handleSaveQuestions(newQuestions: BuilderQuestion[]) {
    if (!selectedQtId) return;
    onUpdate(n => ({
      ...n,
      questionTypes: n.questionTypes.map(qt => qt.id === selectedQtId ? { ...qt, jsonText: JSON.stringify(newQuestions, null, 2) } : qt)
    }));
  }

  function handleAddQuestion() {
    const newQ: BuilderQuestion = {
      id: makeStableId('q'),
      question: '',
      options: [],
      correct_option_index: 0,
      difficulty: 'medium',
      promptBlocks: [{ type: 'text', text: 'New question text...' }],
      interaction: { type: 'freeform', grading: 'ai' },
      modelAnswer: 'Model answer...'
    };
    handleSaveQuestions([...questions, newQ]);
  }

  function handleUpdateQuestion(index: number, updates: Partial<BuilderQuestion>) {
    const nextQ = [...questions];
    nextQ[index] = { ...nextQ[index], ...updates };
    handleSaveQuestions(nextQ);
  }

  function handleUpdateQuestionText(index: number, text: string) {
    const nextQ = [...questions];
    const q = nextQ[index];
    if (q.promptBlocks && q.promptBlocks.length > 0 && q.promptBlocks[0].type === 'text') {
      q.promptBlocks[0].text = text;
    } else {
      q.promptBlocks = [{ type: 'text', text }];
    }
    handleSaveQuestions(nextQ);
  }

  function handleDeleteQuestion(index: number) {
    if (!window.confirm('Delete this question?')) return;
    const nextQ = [...questions];
    nextQ.splice(index, 1);
    handleSaveQuestions(nextQ);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #475569', color: '#94a3b8', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
            ← Back
          </button>
          <div>
            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>Worksheet Editor</div>
            <div style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>{worksheetNode.title}</div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Sidebar: Question Types */}
        <div style={{ width: 320, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 14, color: 'white' }}>Question Types</h3>
            <button onClick={handleAddQuestionType} style={{ padding: '4px 10px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.4)', color: '#c4b5fd', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
              + Add
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {worksheetNode.questionTypes.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', fontSize: 12, padding: '20px 0' }}>No question types yet.</div>
            ) : worksheetNode.questionTypes.map(qt => {
              const isSelected = qt.id === selectedQtId;
              let qCount = 0;
              try { qCount = JSON.parse(qt.jsonText).length; } catch {}
              
              return (
                <div 
                  key={qt.id}
                  onClick={() => setSelectedQtId(qt.id)}
                  style={{ background: isSelected ? 'rgba(59,130,246,0.1)' : 'transparent', border: `1px solid ${isSelected ? 'rgba(59,130,246,0.3)' : 'transparent'}`, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {editingQtId === qt.id ? (
                      <input 
                        autoFocus
                        defaultValue={qt.title}
                        onClick={e => e.stopPropagation()}
                        onBlur={e => { handleRenameQt(qt.id, e.target.value.trim() || qt.title); setEditingQtId(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        style={{ flex: 1, background: '#1e293b', color: 'white', border: '1px solid #3b82f6', borderRadius: 4, padding: '2px 6px', fontSize: 13, outline: 'none' }}
                      />
                    ) : (
                      <div style={{ color: isSelected ? '#93c5fd' : 'white', fontSize: 13, fontWeight: 'bold' }}>{qt.title}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{qCount} question{qCount !== 1 ? 's' : ''}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={e => { e.stopPropagation(); setEditingQtId(qt.id); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                      <button onClick={e => { e.stopPropagation(); handleDeleteQt(qt.id); }} style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>Del</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Content: Questions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#020617' }}>
          {!selectedQt ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontSize: 14 }}>
              Select a Question Type to edit questions
            </div>
          ) : (
            <>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16, color: 'white' }}>{selectedQt.title}</h3>
                <button onClick={handleAddQuestion} style={{ padding: '6px 14px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#93c5fd', borderRadius: 6, fontSize: 12, fontWeight: 'bold', cursor: 'pointer' }}>
                  + Add Question
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {questions.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13, padding: '40px 0' }}>No questions in this type yet.</div>
                ) : questions.map((q, idx) => {
                  const firstBlock = q.promptBlocks?.[0];
                  const rawText = (firstBlock && firstBlock.type === 'text') ? firstBlock.text : '';
                  return (
                    <div key={q.id || idx} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>Question {idx + 1}</div>
                        <button onClick={() => handleDeleteQuestion(idx)} style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>Delete</button>
                      </div>
                      
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1', fontSize: 12, marginBottom: 6 }}>
                          <span>Question Text (LaTeX supported via $$)</span>
                        </label>
                        <div style={{ background: 'rgba(15,23,42,0.5)', padding: 12, borderRadius: '8px 8px 0 0', border: '1px solid #334155', borderBottom: 'none', color: '#e2e8f0', fontSize: 14 }}>
                          <LatexRenderer content={rawText} />
                        </div>
                        <textarea
                          value={rawText}
                          onChange={e => handleUpdateQuestionText(idx, e.target.value)}
                          style={{ width: '100%', minHeight: 80, background: '#1e293b', border: '1px solid #334155', borderRadius: '0 0 8px 8px', padding: 12, color: '#94a3b8', fontFamily: 'monospace', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                        />
                      </div>
                      
                      <div>
                        <label style={{ display: 'block', color: '#cbd5e1', fontSize: 12, marginBottom: 6 }}>Model Answer</label>
                        <div style={{ background: 'rgba(15,23,42,0.5)', padding: 12, borderRadius: '8px 8px 0 0', border: '1px solid #334155', borderBottom: 'none', color: '#10b981', fontSize: 14 }}>
                          <LatexRenderer content={q.modelAnswer || 'No model answer provided.'} />
                        </div>
                        <textarea
                          value={q.modelAnswer || ''}
                          onChange={e => handleUpdateQuestion(idx, { modelAnswer: e.target.value })}
                          style={{ width: '100%', minHeight: 60, background: '#1e293b', border: '1px solid #334155', borderRadius: '0 0 8px 8px', padding: 12, color: '#94a3b8', fontFamily: 'monospace', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
