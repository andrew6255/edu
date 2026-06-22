function LogicGamesAdmin() {
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
  const [addModalTab, setAddModalTab] = useState<'manual' | 'pdf'>('manual');
  
  // Manual Question Form
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualChoices, setManualChoices] = useState<string[]>(['', '', '', '']);
  const [manualCorrectIndex, setManualCorrectIndex] = useState(0);

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
      const pub = await listPublishedLogicGameNodes();
      setNodes(pub);
      if (!selectedNodeId && pub.length > 0) setSelectedNodeId(pub[0].id);
      if (selectedNodeId && pub.every((n) => n.id !== selectedNodeId)) {
        setSelectedNodeId(pub[0]?.id ?? null);
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
      const doc = await getPublishedLogicGameQuestions(selectedNodeId);
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
      await upsertPublishedLogicGameNode(node);
      await upsertPublishedLogicGameQuestions(id, { questions: [], updatedAt: new Date().toISOString() });

      setNodes((prev) => {
        const next = prev.some((n) => n.id === node.id) ? prev : [...prev, node];
        return next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      });
      setSelectedNodeId(id);
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
      await upsertPublishedLogicGameNode({ ...n, label });
      setNodes((prev) => prev.map((x) => (x.id === nodeId ? { ...x, label } : x)));
      setStatus('✅ Renamed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setNodeIq(nodeId: string, nextIqRaw: string) {
    const nextIq = Number(nextIqRaw);
    if (!Number.isFinite(nextIq)) return;
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    setSaving(true);
    try {
      await upsertPublishedLogicGameNode({ ...n, iq: nextIq });
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
      await deletePublishedLogicGameNode(nodeId);
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
      await upsertPublishedLogicGameQuestions(selectedNodeId, {
        questions: newQuestions,
        updatedAt: new Date().toISOString()
      });
      setQuestions(newQuestions);
      setStatus('✅ Questions saved');
    } catch(e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddManualQuestion() {
    if (!manualPrompt.trim() || manualChoices.some(c => !c.trim())) {
      window.alert("Please fill in the prompt and all choices.");
      return;
    }
    const newQ: LogicGameQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      promptBlocks: [{ type: 'text', text: manualPrompt }],
      promptRawText: manualPrompt,
      interaction: {
        type: 'mcq',
        choices: [...manualChoices],
        correctChoiceIndex: manualCorrectIndex
      },
      timeLimitSec: 60,
      iqDeltaCorrect: 5,
      iqDeltaWrong: -3
    };
    await saveQuestionsList([...questions, newQ]);
    setAddModalOpen(false);
    setManualPrompt('');
    setManualChoices(['', '', '', '']);
    setManualCorrectIndex(0);
  }

  async function handleExtractFromPdf() {
    if (!pdfFile) return;
    setPdfExtracting(true);
    setPdfError(null);
    try {
      // 1. Run local OCR
      const ocrRes = await runPhase1Ocr(pdfFile, pdfFile.name, (msg) => {
        setPdfError(msg); // Use pdfError state to temporarily show progress to user
      });

      setPdfError('OCR complete. Extracting questions using AI...');

      // 2. Pass extracted text to our new endpoint
      const aiRes = await fetch('/api/program-ingestion/extract-mcq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ocrRes.rawText })
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`AI Extraction failed: ${errText}`);
      }

      const aiData = await aiRes.json();
      
      if (!aiData.questions || !Array.isArray(aiData.questions)) {
        throw new Error('Invalid response from AI extraction.');
      }

      const formattedQuestions = aiData.questions.map((q: any) => ({
        id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        promptBlocks: [{ type: 'text', text: q.promptRawText || '' }],
        promptRawText: q.promptRawText || '',
        interaction: q.interaction,
        timeLimitSec: 60,
        iqDeltaCorrect: 5,
        iqDeltaWrong: -3
      }));

      setExtractedQuestions(formattedQuestions);
      setPdfError(null); // Clear progress message
    } catch(e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfExtracting(false);
    }
  }

  if (!userData || userData.role !== 'superadmin') return null;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, flexShrink: 0 }}>
        <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>🧠 IQ Games</h3>
        <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>
          ↺ Refresh
        </button>
      </div>

      {err && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10, flexShrink: 0 }}>{err}</div>}
      {status && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10, flexShrink: 0 }}>{status}</div>}

      {/* Main layout */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* Left Panel: Levels */}
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Levels</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{nodes.length}</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nodes.map((n) => {
              const active = n.id === selectedNodeId;
              return (
                <div key={n.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={() => setSelectedNodeId(n.id)}
                    className="ll-btn"
                    style={{
                      flex: 1, textAlign: 'left', padding: '10px', borderRadius: 8,
                      background: active ? 'rgba(168,85,247,0.15)' : 'rgba(15,23,42,0.5)',
                      border: active ? '1px solid rgba(168,85,247,0.5)' : '1px solid #334155',
                      color: active ? '#d8b4fe' : 'white', fontWeight: 900
                    }}
                  >
                    {n.label}
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 'normal', marginTop: 2 }}>IQ Threshold: {n.iq}</div>
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button className="ll-btn" title="Edit" onClick={() => renameNode(n.id)} style={{ padding: '4px', borderRadius: 6, fontSize: 12 }}>✎</button>
                    <button className="ll-btn" title="Delete" onClick={() => deleteNode(n.id)} style={{ padding: '4px', borderRadius: 6, fontSize: 12, color: '#fca5a5' }}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #334155' }}>
             <button onClick={addNode} disabled={saving} className="ll-btn ll-btn-primary" style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 'bold' }}>
               + Add New Level
             </button>
          </div>
        </div>

        {/* Right Panel: Questions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
          {selectedNodeId ? (
             <>
               <div style={{ padding: 12, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}>
                  <div>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 14 }}>
                      {nodes.find(n => n.id === selectedNodeId)?.label} Questions
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{questions.length} questions</div>
                  </div>
                  <button onClick={() => setAddModalOpen(true)} className="ll-btn ll-btn-primary" style={{ padding: '8px 16px', fontSize: 13, fontWeight: 'bold' }}>
                    + Add Questions
                  </button>
               </div>
               
               <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                 {questionsLoading ? (
                   <div style={{ color: '#94a3b8' }}>Loading questions...</div>
                 ) : questions.length === 0 ? (
                   <div style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>No questions in this level yet.</div>
                 ) : (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                     {questions.map((q, qIndex) => (
                       <div key={q.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                           <div style={{ color: '#94a3b8', fontWeight: 'bold', fontSize: 12 }}>Question {qIndex + 1}</div>
                           <button 
                             onClick={() => {
                               if(window.confirm('Delete question?')) {
                                 saveQuestionsList(questions.filter(x => x.id !== q.id));
                               }
                             }}
                             className="ll-btn" style={{ padding: '4px 8px', fontSize: 12, color: '#fca5a5' }}
                           >
                             🗑 Delete
                           </button>
                         </div>
                         
                         {/* Edit Prompt */}
                         <textarea
                           value={q.promptRawText || q.promptBlocks?.[0]?.text || ''}
                           onChange={(e) => {
                             const newQ = [...questions];
                             newQ[qIndex] = { ...q, promptRawText: e.target.value, promptBlocks: [{ type: 'text', text: e.target.value }] };
                             setQuestions(newQ);
                           }}
                           onBlur={() => saveQuestionsList(questions)}
                           style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', marginBottom: 12, outline: 'none' }}
                         />
                         
                         {/* Edit Choices & Correct Answer */}
                         {q.interaction.type === 'mcq' && (
                           <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                             {q.interaction.choices.map((choice, cIndex) => (
                               <div key={cIndex} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                 <button
                                   onClick={() => {
                                     const newQ = [...questions];
                                     if (newQ[qIndex].interaction.type === 'mcq') {
                                       (newQ[qIndex].interaction as any).correctChoiceIndex = cIndex;
                                       saveQuestionsList(newQ);
                                     }
                                   }}
                                   style={{
                                     width: 32, height: 32, borderRadius: '50%', border: 'none',
                                     background: q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex === cIndex ? '#22c55e' : '#334155',
                                     color: 'white', fontWeight: 'bold', cursor: 'pointer'
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
                                   style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none' }}
                                 />
                               </div>
                             ))}
                           </div>
                         )}
                         
                         <div style={{ display: 'flex', gap: 16, marginTop: 16, borderTop: '1px solid #334155', paddingTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#94a3b8', fontSize: 12 }}>Time Limit (s):</span>
                              <input 
                                type="number" value={q.timeLimitSec}
                                onChange={(e) => {
                                  const newQ = [...questions];
                                  newQ[qIndex].timeLimitSec = Number(e.target.value);
                                  setQuestions(newQ);
                                }}
                                onBlur={() => saveQuestionsList(questions)}
                                style={{ width: 60, padding: 4, borderRadius: 4, background: '#0f172a', border: '1px solid #475569', color: 'white' }}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#94a3b8', fontSize: 12 }}>IQ Correct:</span>
                              <input 
                                type="number" value={q.iqDeltaCorrect}
                                onChange={(e) => {
                                  const newQ = [...questions];
                                  newQ[qIndex].iqDeltaCorrect = Number(e.target.value);
                                  setQuestions(newQ);
                                }}
                                onBlur={() => saveQuestionsList(questions)}
                                style={{ width: 60, padding: 4, borderRadius: 4, background: '#0f172a', border: '1px solid #475569', color: 'white' }}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#94a3b8', fontSize: 12 }}>IQ Wrong:</span>
                              <input 
                                type="number" value={q.iqDeltaWrong}
                                onChange={(e) => {
                                  const newQ = [...questions];
                                  newQ[qIndex].iqDeltaWrong = Number(e.target.value);
                                  setQuestions(newQ);
                                }}
                                onBlur={() => saveQuestionsList(questions)}
                                style={{ width: 60, padding: 4, borderRadius: 4, background: '#0f172a', border: '1px solid #475569', color: 'white' }}
                              />
                            </div>
                         </div>
                       </div>
                     ))}
                   </div>
                 )}
               </div>
             </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
              Select a level to view or add questions.
            </div>
          )}
        </div>
      </div>
      
      {/* ADD QUESTIONS MODAL */}
      {addModalOpen && (
        <>
          <div onClick={() => setAddModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', border: '1px solid #475569', borderRadius: 16, width: 'min(800px, 95vw)',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column', zIndex: 1001
          }}>
            <div style={{ padding: 16, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'white', fontSize: 18 }}>Add Questions</h3>
              <button onClick={() => setAddModalOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #334155' }}>
              <button 
                onClick={() => setAddModalTab('manual')}
                style={{ flex: 1, padding: 12, background: addModalTab === 'manual' ? 'rgba(168,85,247,0.1)' : 'transparent', color: addModalTab === 'manual' ? '#c084fc' : '#94a3b8', border: 'none', borderBottom: addModalTab === 'manual' ? '2px solid #c084fc' : '2px solid transparent', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Manual Entry
              </button>
              <button 
                onClick={() => setAddModalTab('pdf')}
                style={{ flex: 1, padding: 12, background: addModalTab === 'pdf' ? 'rgba(168,85,247,0.1)' : 'transparent', color: addModalTab === 'pdf' ? '#c084fc' : '#94a3b8', border: 'none', borderBottom: addModalTab === 'pdf' ? '2px solid #c084fc' : '2px solid transparent', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Upload PDF
              </button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {addModalTab === 'manual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', color: '#cbd5e1', marginBottom: 8, fontWeight: 'bold' }}>Question Prompt</label>
                    <textarea 
                      value={manualPrompt} onChange={(e) => setManualPrompt(e.target.value)}
                      placeholder="Type the question text here..."
                      style={{ width: '100%', minHeight: 100, padding: 12, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', resize: 'vertical' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#cbd5e1', marginBottom: 8, fontWeight: 'bold' }}>Choices & Correct Answer</label>
                    {manualChoices.map((choice, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                        <input 
                          type="radio" name="manualCorrect" checked={manualCorrectIndex === idx}
                          onChange={() => setManualCorrectIndex(idx)}
                          style={{ width: 18, height: 18, cursor: 'pointer' }}
                        />
                        <div style={{ color: '#94a3b8', fontWeight: 'bold', width: 20 }}>{String.fromCharCode(65 + idx)}</div>
                        <input 
                          value={choice} onChange={(e) => {
                            const nc = [...manualChoices];
                            nc[idx] = e.target.value;
                            setManualChoices(nc);
                          }}
                          placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white' }}
                        />
                      </div>
                    ))}
                    <button 
                      onClick={() => setManualChoices([...manualChoices, ''])}
                      style={{ background: 'none', border: '1px dashed #475569', color: '#94a3b8', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', marginTop: 4 }}
                    >
                      + Add Option
                    </button>
                  </div>
                  
                  <button onClick={handleAddManualQuestion} className="ll-btn ll-btn-primary" style={{ padding: '12px', fontSize: 15, fontWeight: 'bold', marginTop: 10 }}>
                    Add Question
                  </button>
                </div>
              )}
              
              {addModalTab === 'pdf' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {!extractedQuestions ? (
                    <>
                      <div style={{ background: '#0f172a', border: '2px dashed #475569', borderRadius: 12, padding: 40, textAlign: 'center' }}>
                         <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
                         <div style={{ color: 'white', fontWeight: 'bold', marginBottom: 8 }}>Upload Olympiad PDF</div>
                         <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>We will automatically extract all MCQ questions and answers.</div>
                         
                         <input 
                           type="file" accept="application/pdf"
                           onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                           style={{ display: 'none' }} id="pdf-upload"
                         />
                         <label htmlFor="pdf-upload" className="ll-btn ll-btn-primary" style={{ display: 'inline-block', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold' }}>
                           {pdfFile ? pdfFile.name : 'Choose File'}
                         </label>
                      </div>
                      
                      {pdfError && <div style={{ color: '#fca5a5', padding: 12, background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{pdfError}</div>}
                      
                      <button 
                        onClick={handleExtractFromPdf}
                        disabled={!pdfFile || pdfExtracting}
                        className="ll-btn ll-btn-primary" 
                        style={{ padding: '12px', fontSize: 15, fontWeight: 'bold', opacity: (!pdfFile || pdfExtracting) ? 0.5 : 1 }}
                      >
                        {pdfExtracting ? 'Extracting questions (this may take a minute)...' : 'Extract Questions'}
                      </button>
                    </>
                  ) : (
                    <>
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div style={{ color: '#34d399', fontWeight: 'bold' }}>✅ Extracted {extractedQuestions.length} questions</div>
                         <button onClick={() => { setExtractedQuestions(null); setPdfFile(null); }} className="ll-btn">Start Over</button>
                       </div>
                       
                       <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                         {extractedQuestions.map((q, qIndex) => (
                           <div key={qIndex} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
                             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                               <div style={{ color: '#94a3b8', fontWeight: 'bold', fontSize: 12 }}>Extracted Question {qIndex + 1}</div>
                               <button 
                                 onClick={() => setExtractedQuestions(extractedQuestions.filter((_, i) => i !== qIndex))}
                                 className="ll-btn" style={{ padding: '4px 8px', fontSize: 12, color: '#fca5a5' }}
                               >
                                 🗑 Remove
                               </button>
                             </div>
                             
                             <textarea
                               value={q.promptRawText || q.promptBlocks?.[0]?.text || ''}
                               onChange={(e) => {
                                 const nq = [...extractedQuestions];
                                 nq[qIndex].promptRawText = e.target.value;
                                 nq[qIndex].promptBlocks = [{ type: 'text', text: e.target.value }];
                                 setExtractedQuestions(nq);
                               }}
                               style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', marginBottom: 12, outline: 'none' }}
                             />
                             
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
                                         width: 28, height: 28, borderRadius: '50%', border: 'none',
                                         background: q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex === cIndex ? '#22c55e' : '#334155',
                                         color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: 12
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
                                       style={{ flex: 1, padding: '6px 10px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 13 }}
                                     />
                                   </div>
                                 ))}
                               </div>
                             )}
                           </div>
                         ))}
                       </div>
                       
                       <button 
                         onClick={async () => {
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
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
