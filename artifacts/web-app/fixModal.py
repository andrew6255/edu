import sys

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# Replace the whole modal block from <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center' }}>
# to the end of extractedQuestions mapping

start_idx = code.find("<div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center' }}>")
end_idx = code.find("                  <button \n                    onClick={async () => {", start_idx)

if start_idx == -1 or end_idx == -1:
    print("Not found modal")
    sys.exit(1)

new_block = """<div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center' }}>
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

              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                 <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>— OR —</div>
                 <button onClick={() => {
                    const newQ: any = {
                       id: `manual_${Date.now()}`,
                       promptRawText: '',
                       promptBlocks: [{ type: 'text', text: '' }],
                       interaction: { type: 'mcq', choices: ['', '', '', ''], correctChoiceIndex: 0 },
                       timeLimitSec: 0, iqDeltaCorrect: 0, iqDeltaWrong: 0
                    };
                    setExtractedQuestions([...(extractedQuestions || []), newQ]);
                 }} className="ll-btn" style={{ background: '#334155', color: 'white', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold' }}>
                    + Add Question Manually
                 </button>
              </div>

              {pdfError && (
                 <div style={{ padding: 16, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', borderRadius: 8, marginBottom: 20, border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                    {pdfError}
                 </div>
              )}

              {extractedQuestions && extractedQuestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <h3 style={{ color: 'white', margin: '10px 0' }}>Review Questions</h3>
                  <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10 }}>
                     ⚠️ Please review all questions and select the correct answer for each by clicking the letter circle.
                  </div>
                  
                  {extractedQuestions.map((q, qIndex) => (
                     <div key={qIndex} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 16, position: 'relative' }}>
                       <button 
                          onClick={() => {
                            if(window.confirm('Delete question?')) {
                              setExtractedQuestions((extractedQuestions || []).filter((_, i) => i !== qIndex));
                            }
                          }}
                          style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                       >🗑 Delete</button>
                       <textarea
                         value={q.promptRawText || (q.promptBlocks?.[0] as any)?.text || ''}
                         onChange={(e) => {
                            const nq = [...extractedQuestions];
                            const newText = e.target.value;
                            const existingImages = (q.promptBlocks || []).filter((b: any) => b.type === 'image');
                            nq[qIndex].promptRawText = newText;
                            nq[qIndex].promptBlocks = [{ type: 'text', text: newText }, ...existingImages] as any;
                            setExtractedQuestions(nq);
                         }}
                         onPaste={(e) => handlePasteImage(e, (b64) => {
                            const nq = [...extractedQuestions];
                            const blocks = nq[qIndex].promptBlocks || [{ type: 'text', text: nq[qIndex].promptRawText || '' }];
                            blocks.push({ type: 'image', url: b64 } as any);
                            nq[qIndex].promptBlocks = blocks as any;
                            setExtractedQuestions(nq);
                         })}
                         placeholder="Question Prompt... (Paste image to attach)"
                         style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', marginBottom: 12, outline: 'none' }}
                       />

                       <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                         {q.imageUrl && (
                           <div style={{ position: 'relative' }}>
                             <img src={q.imageUrl} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: '1px solid #475569' }} />
                           </div>
                         )}
                         {q.promptBlocks?.filter((b: any) => b.type === 'image').map((imgBlock: any, imgIdx: number) => (
                           <div key={imgIdx} style={{ position: 'relative' }}>
                             <img src={imgBlock.url} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: '1px solid #475569' }} />
                             <button 
                               onClick={() => {
                                 const nq = [...extractedQuestions];
                                 const blocks = (nq[qIndex].promptBlocks || []).filter((b: any) => b !== imgBlock);
                                 nq[qIndex].promptBlocks = blocks as any;
                                 setExtractedQuestions(nq);
                               }}
                               style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                             >✕</button>
                           </div>
                         ))}
                       </div>

                       {q.interaction.type === 'mcq' && (
                         <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                           {q.interaction.choices.map((choice, cIndex) => {
                             const isImage = choice.startsWith('data:image/') || choice.startsWith('http');
                             return (
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
                                 {isImage ? (
                                   <div style={{ position: 'relative', flex: 1, padding: 8, borderRadius: 8, background: '#1e293b', border: '1px solid #475569' }}>
                                     <img src={choice} style={{ maxWidth: 200, maxHeight: 100, borderRadius: 4 }} />
                                     <button 
                                       onClick={() => {
                                          const nq = [...extractedQuestions];
                                          if (nq[qIndex].interaction.type === 'mcq') {
                                            (nq[qIndex].interaction as any).choices[cIndex] = '';
                                            setExtractedQuestions(nq);
                                          }
                                       }}
                                       style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                                     >✕</button>
                                   </div>
                                 ) : (
                                   <input
                                     value={choice}
                                     onChange={(e) => {
                                        const nq = [...extractedQuestions];
                                        if (nq[qIndex].interaction.type === 'mcq') {
                                          (nq[qIndex].interaction as any).choices[cIndex] = e.target.value;
                                          setExtractedQuestions(nq);
                                        }
                                     }}
                                     onPaste={(e) => handlePasteImage(e, (b64) => {
                                        const nq = [...extractedQuestions];
                                        if (nq[qIndex].interaction.type === 'mcq') {
                                          (nq[qIndex].interaction as any).choices[cIndex] = b64;
                                          setExtractedQuestions(nq);
                                        }
                                     })}
                                     placeholder={`Option ${String.fromCharCode(65 + cIndex)} (Paste image here)`}
                                     style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 13 }}
                                   />
                                 )}
                                 <button 
                                   onClick={() => {
                                      const nq = [...extractedQuestions];
                                      if (nq[qIndex].interaction.type === 'mcq') {
                                         const arr = (nq[qIndex].interaction as any).choices;
                                         if (arr.length > 2) {
                                           arr.splice(cIndex, 1);
                                           if ((nq[qIndex].interaction as any).correctChoiceIndex === cIndex) {
                                              (nq[qIndex].interaction as any).correctChoiceIndex = -1;
                                           } else if ((nq[qIndex].interaction as any).correctChoiceIndex > cIndex) {
                                              (nq[qIndex].interaction as any).correctChoiceIndex--;
                                           }
                                           setExtractedQuestions(nq);
                                         }
                                      }
                                   }}
                                   style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}
                                   title="Remove Option"
                                 >×</button>
                               </div>
                             );
                           })}
                           <button 
                              onClick={() => {
                                 const nq = [...extractedQuestions];
                                 if (nq[qIndex].interaction.type === 'mcq') {
                                    (nq[qIndex].interaction as any).choices.push('');
                                    setExtractedQuestions(nq);
                                 }
                              }}
                              style={{ background: 'transparent', border: '1px dashed #475569', color: '#94a3b8', padding: '8px', borderRadius: 8, cursor: 'pointer', marginTop: 4, width: 'fit-content', fontSize: 13 }}
                           >
                             + Add Option
                           </button>
                         </div>
                       )}
                     </div>
                  ))}
"""

code = code[:start_idx] + new_block + code[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Modal fully fixed!")
