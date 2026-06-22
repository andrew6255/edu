import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

start_idx = code.find("function LogicGamesAdmin() {")
if start_idx == -1:
    print("Could not find LogicGamesAdmin")
    exit(1)

end_idx = code.find("\nfunction ProgramsAdmin() {")
if end_idx == -1:
    end_idx = code.find("\nexport default function SuperAdminPage")

if end_idx == -1:
    print("Could not find end of LogicGamesAdmin")
    exit(1)

new_component = """function LogicGamesAdmin() {
  const { userData } = useAuth();
  const [, setLocation] = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [nodes, setNodes] = useState<LogicGameNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [questions, setQuestions] = useState<LogicGameQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);

  // Add Question Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  
  // PDF Upload Flow
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [extractedQuestions, setExtractedQuestions] = useState<LogicGameQuestion[] | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const pub = await listLogicGameNodes();
      
      // Auto-create level 1 if empty
      if (pub.length === 0) {
         const id = `iq-80`;
         const initialNode: LogicGameNode = { id, iq: 80, order: 0, label: `Level 1` };
         await upsertLogicGameNode(initialNode);
         setNodes([initialNode]);
      } else {
         setNodes(pub);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadQuestions() {
    if (!selectedNodeId) {
      setQuestions([]);
      return;
    }
    setQuestionsLoading(true);
    try {
      const doc = await getLogicGameQuestions(selectedNodeId);
      setQuestions(doc ? doc.questions : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQuestionsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadQuestions();
  }, [selectedNodeId]);

  async function addNode() {
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const nextOrder = nodes.length > 0 ? Math.max(...nodes.map((n) => n.order ?? 0)) + 1 : 0;
      const nextIq = nodes.length > 0 ? (nodes[nodes.length - 1].iq ?? 80) + 10 : 80;
      const id = `iq-${nextIq}`;
      const node: LogicGameNode = { id, iq: nextIq, order: nextOrder, label: `Level ${nodes.length + 1}` };
      await upsertLogicGameNode(node);

      setNodes((prev) => {
        const next = prev.some((n) => n.id === node.id) ? prev : [...prev, node];
        return next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      });
      setStatus('✅ Level added');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function renameNode(nodeId: string) {
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    const next = window.prompt('Enter level name', n.label ?? '') ?? '';
    const label = next.trim();
    if (!label) return;

    setSaving(true);
    try {
      await upsertLogicGameNode({ ...n, label });
      setNodes((prev) => prev.map((x) => (x.id === nodeId ? { ...x, label } : x)));
      setStatus('✅ Renamed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setNodeIq(nodeId: string) {
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    const nextRaw = window.prompt('Enter IQ Threshold', n.iq?.toString() ?? '80') ?? '';
    const nextIq = Number(nextRaw.trim());
    if (!Number.isFinite(nextIq)) return;

    setSaving(true);
    try {
      await upsertLogicGameNode({ ...n, iq: nextIq });
      setNodes((prev) =>
        prev
          .map((x) => (x.id === nodeId ? { ...x, iq: nextIq } : x))
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
      setStatus('✅ IQ threshold saved');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteNode(nodeId: string) {
    if (!window.confirm('Delete this level and all its questions? This cannot be undone.')) return;
    setSaving(true);
    try {
      await deleteLogicGameNode(nodeId);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      await load();
      setStatus('✅ Level deleted');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveQuestionsList(newQuestions: LogicGameQuestion[]) {
    if (!selectedNodeId) return;
    setSaving(true);
    try {
      await upsertLogicGameQuestions(selectedNodeId, {
        questions: newQuestions,
        updatedAt: new Date().toISOString()
      });
      setQuestions(newQuestions);
      setStatus('✅ Auto-saved');
    } catch(e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleExtractFromPdf() {
    if (!pdfFile) return;
    setPdfExtracting(true);
    setPdfError(null);
    try {
      setPdfError('Uploading PDF for extraction...');

      const apiUrl = import.meta.env.VITE_API_SERVER_URL || '';
      const formData = new FormData();
      formData.append('file', pdfFile);

      const aiRes = await fetch(`${apiUrl}/api/program-ingestion/extract-iq-pdf`, {
        method: 'POST',
        body: formData,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`AI Extraction failed: ${errText}`);
      }

      const data = await aiRes.json();
      if (!data.questions || data.questions.length === 0) {
        throw new Error("No questions could be found in this PDF.");
      }

      const formatted = data.questions.map((q: any, i: number) => {
        const blocks: any[] = [];
        if (q.promptRawText) blocks.push({ type: 'text', text: q.promptRawText });
        if (q.imageUrl) blocks.push({ type: 'image', url: q.imageUrl });

        return {
          id: `q_${Date.now()}_${i}`,
          promptBlocks: blocks,
          promptRawText: q.promptRawText,
          interaction: {
            type: 'mcq',
            choices: q.interaction?.choices || [],
            // Default to no answer selected if -1 or missing
            correctChoiceIndex: typeof q.interaction?.correctChoiceIndex === 'number' && q.interaction.correctChoiceIndex >= 0 
                ? q.interaction.correctChoiceIndex 
                : -1
          },
          timeLimitSec: 60,
          iqDeltaCorrect: 5,
          iqDeltaWrong: -3
        };
      });

      setExtractedQuestions(formatted);
      setPdfError(null);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfExtracting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 20 }}>
      {err && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10, flexShrink: 0 }}>{err}</div>}
      {status && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10, flexShrink: 0 }}>{status}</div>}

      <div style={{ display: 'flex', justifyContent: 'center', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px' }}>
        {!selectedNodeId ? (
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }}>
            {nodes.map((n) => (
              <div key={n.id} 
                   onClick={() => setSelectedNodeId(n.id)}
                   style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', cursor: 'pointer', transition: 'all 0.2s' }}
                   onMouseEnter={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                   onMouseLeave={(e) => e.currentTarget.style.borderColor = '#334155'}
              >
                <div>
                   <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>{n.label}</div>
                   <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
                     IQ Threshold: <span style={{ color: '#d8b4fe', fontWeight: 'bold' }}>{n.iq}</span>
                   </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="ll-btn" title="Edit Level" onClick={(e) => { e.stopPropagation(); renameNode(n.id); setNodeIq(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.05)', color: 'white' }}>✎ Edit</button>
                  <button className="ll-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}>🗑 Delete</button>
                </div>
              </div>
            ))}
            
            <button onClick={addNode} disabled={saving} className="ll-btn ll-btn-primary" style={{ padding: '16px', fontSize: 15, fontWeight: 'bold', alignSelf: 'center', marginTop: 10, borderRadius: 12 }}>
                + Add New Level
            </button>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 1000, display: 'flex', flexDirection: 'column', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden', margin: '0 auto', height: '100%' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button onClick={() => setSelectedNodeId(null)} className="ll-btn" style={{ padding: '8px 14px', fontSize: 14, background: 'rgba(255,255,255,0.1)' }}>
                  ← Back to Levels
                </button>
                <div>
                  <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>
                    {nodes.find(n => n.id === selectedNodeId)?.label}
                  </div>
                  <div style={{ color: '#a855f7', fontSize: 13, fontWeight: 'bold' }}>{questions.length} questions</div>
                </div>
              </div>
              <button onClick={() => setAddModalOpen(true)} className="ll-btn ll-btn-primary" style={{ padding: '10px 20px', fontSize: 14, fontWeight: 'bold' }}>
                + Add Questions
              </button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {questionsLoading ? (
                <div style={{ color: '#94a3b8', textAlign: 'center' }}>Loading questions...</div>
              ) : questions.length === 0 ? (
                <div style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>No questions in this level yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {questions.map((q, qIndex) => (
                    <div key={q.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ color: '#94a3b8', fontWeight: 'bold', fontSize: 14 }}>Question {qIndex + 1}</div>
                        <button 
                          onClick={() => {
                            if(window.confirm('Delete question?')) {
                              saveQuestionsList(questions.filter(x => x.id !== q.id));
                            }
                          }}
                          className="ll-btn" style={{ padding: '6px 10px', fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}
                        >
                          🗑 Delete
                        </button>
                      </div>
                      
                      <textarea
                        value={q.promptRawText || (q.promptBlocks?.[0] as any)?.text || ''}
                        onChange={(e) => {
                          const newQ = [...questions];
                          newQ[qIndex] = { ...q, promptRawText: e.target.value, promptBlocks: [{ type: 'text', text: e.target.value }] };
                          setQuestions(newQ);
                        }}
                        onBlur={() => saveQuestionsList(questions)}
                        placeholder="Question Prompt..."
                        style={{ width: '100%', minHeight: 80, padding: 14, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', marginBottom: 16, outline: 'none', fontSize: 15 }}
                      />

                      {/* Display image if present */}
                      {q.promptBlocks?.find(b => b.type === 'image') && (
                         <div style={{ marginBottom: 16 }}>
                           <img src={(q.promptBlocks.find(b => b.type === 'image') as any).url} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
                         </div>
                      )}
                      
                      {q.interaction.type === 'mcq' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {q.interaction.choices.map((choice, cIndex) => (
                            <div key={cIndex} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <button
                                onClick={() => {
                                  const newQ = [...questions];
                                  if (newQ[qIndex].interaction.type === 'mcq') {
                                    (newQ[qIndex].interaction as any).correctChoiceIndex = cIndex;
                                    saveQuestionsList(newQ);
                                  }
                                }}
                                title="Click to mark as correct answer"
                                style={{
                                  width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
                                  background: q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex === cIndex ? '#22c55e' : '#334155',
                                  color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: 14,
                                  transition: 'background 0.2s'
                                }}
                              >
                                {String.fromCharCode(65 + cIndex)}
                              </button>
                              <input
                                value={choice}
                                onChange={(e) => {
                                   const newQ = [...questions];
                                   if (newQ[qIndex].interaction.type === 'mcq') {
                                     (newQ[qIndex].interaction as any).choices[cIndex] = e.target.value;
                                     setQuestions(newQ);
                                   }
                                }}
                                onBlur={() => saveQuestionsList(questions)}
                                placeholder={`Option ${String.fromCharCode(65 + cIndex)}`}
                                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 14 }}
                              />
                              <button 
                                onClick={() => {
                                   const newQ = [...questions];
                                   if (newQ[qIndex].interaction.type === 'mcq') {
                                      const arr = (newQ[qIndex].interaction as any).choices;
                                      if (arr.length > 2) {
                                        arr.splice(cIndex, 1);
                                        // adjust correct index
                                        if ((newQ[qIndex].interaction as any).correctChoiceIndex === cIndex) {
                                           (newQ[qIndex].interaction as any).correctChoiceIndex = -1;
                                        } else if ((newQ[qIndex].interaction as any).correctChoiceIndex > cIndex) {
                                           (newQ[qIndex].interaction as any).correctChoiceIndex--;
                                        }
                                        saveQuestionsList(newQ);
                                      }
                                   }
                                }}
                                style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}
                                title="Remove Option"
                              >×</button>
                            </div>
                          ))}
                          <button 
                             onClick={() => {
                                const newQ = [...questions];
                                if (newQ[qIndex].interaction.type === 'mcq') {
                                   (newQ[qIndex].interaction as any).choices.push('');
                                   setQuestions(newQ);
                                }
                             }}
                             style={{ background: 'transparent', border: '1px dashed #475569', color: '#94a3b8', padding: '8px', borderRadius: 8, cursor: 'pointer', marginTop: 4, width: 'fit-content' }}
                          >
                            + Add Option
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Questions Modal */}
      {addModalOpen && (
        <>
          <div onClick={() => !pdfExtracting && setAddModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 16, border: '1px solid #475569',
            zIndex: 1001, width: 'min(800px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: 'white', margin: 0, fontSize: 18 }}>Extract PDF Questions</h2>
              <button onClick={() => !pdfExtracting && setAddModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24 }}>×</button>
            </div>
            
            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center' }}>
                <input 
                  type="file" accept=".pdf" 
                  onChange={e => setPdfFile(e.target.files?.[0] || null)}
                  style={{ flex: 1, padding: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #334155', color: 'white' }}
                />
                <button 
                  onClick={handleExtractFromPdf} 
                  disabled={!pdfFile || pdfExtracting}
                  className="ll-btn ll-btn-primary" 
                  style={{ padding: '14px 24px', fontWeight: 'bold' }}
                >
                  {pdfExtracting ? 'Extracting...' : 'Extract MCQs'}
                </button>
              </div>

              {pdfError && (
                 <div style={{ padding: 16, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', borderRadius: 8, marginBottom: 20, border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                    {pdfError}
                 </div>
              )}

              {extractedQuestions && extractedQuestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <h3 style={{ color: 'white', margin: '10px 0' }}>Review Extracted Questions</h3>
                  <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10 }}>
                     ⚠️ Please review all questions and select the correct answer for each by clicking the letter circle.
                  </div>
                  
                  {extractedQuestions.map((q, qIndex) => (
                     <div key={qIndex} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
                       <textarea
                         value={q.promptRawText}
                         onChange={(e) => {
                            const nq = [...extractedQuestions];
                            nq[qIndex].promptRawText = e.target.value;
                            nq[qIndex].promptBlocks = [{ type: 'text', text: e.target.value }];
                            setExtractedQuestions(nq);
                         }}
                         style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', marginBottom: 12, outline: 'none' }}
                       />

                       {q.promptBlocks?.find(b => b.type === 'image') && (
                         <div style={{ marginBottom: 16 }}>
                           <img src={(q.promptBlocks.find(b => b.type === 'image') as any).url} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
                         </div>
                       )}

                       {q.interaction.type === 'mcq' && (
                         <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                           {q.interaction.choices.map((choice, cIndex) => (
                             <div key={cIndex} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                               <button
                                 onClick={() => {
                                   const nq = [...extractedQuestions];
                                   if (nq[qIndex].interaction.type === 'mcq') {
                                     (nq[qIndex].interaction as any).correctChoiceIndex = cIndex;
                                     setExtractedQuestions(nq);
                                   }
                                 }}
                                 style={{
                                   width: 32, height: 32, borderRadius: '50%', border: 'none', flexShrink: 0,
                                   background: q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex === cIndex ? '#22c55e' : '#334155',
                                   color: 'white', fontWeight: 'bold', cursor: 'pointer'
                                 }}
                               >
                                 {String.fromCharCode(65 + cIndex)}
                               </button>
                               <input
                                 value={choice}
                                 onChange={(e) => {
                                    const nq = [...extractedQuestions];
                                    if (nq[qIndex].interaction.type === 'mcq') {
                                      (nq[qIndex].interaction as any).choices[cIndex] = e.target.value;
                                      setExtractedQuestions(nq);
                                    }
                                 }}
                                 style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 13 }}
                               />
                             </div>
                           ))}
                         </div>
                       )}
                     </div>
                  ))}
                  
                  <button 
                    onClick={async () => {
                      // Check if any question is missing a correct answer
                      const missingAns = extractedQuestions.some(q => q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex < 0);
                      if (missingAns) {
                         if (!window.confirm("Some questions do not have a correct answer selected. Add them anyway?")) return;
                      }

                      await saveQuestionsList([...questions, ...extractedQuestions]);
                      setAddModalOpen(false);
                      setExtractedQuestions(null);
                      setPdfFile(null);
                    }} 
                    className="ll-btn ll-btn-primary" 
                    style={{ padding: '14px', fontSize: 15, fontWeight: 'bold', marginTop: 20 }}
                  >
                    Add All {extractedQuestions.length} Questions to Level
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
"""

new_code = code[:start_idx] + new_component + code[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_code)

print("Updated successfully")
