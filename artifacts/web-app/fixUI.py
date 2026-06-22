import sys
import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

start_idx = code.find("{questions.map((q, qIndex) => (")
if start_idx == -1:
    print("Could not find start")
    sys.exit(1)

# Find the end by looking for the end of the `questionsLoading` block
# The block ends with:
#                 </div>
#               )}
#             </div>
#           </div>
#         )}
#       </div>

end_idx = code.find("              )}", start_idx)
if end_idx == -1:
    print("Could not find end")
    sys.exit(1)
end_idx += len("              )}")

new_block = """{questions.map((q, qIndex) => (
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
                          const newText = e.target.value;
                          const existingImages = (q.promptBlocks || []).filter(b => b.type === 'image');
                          newQ[qIndex] = { ...q, promptRawText: newText, promptBlocks: [{ type: 'text', text: newText }, ...existingImages] as any };
                          setQuestions(newQ);
                        }}
                        onBlur={() => saveQuestionsList(questions)}
                        onPaste={(e) => handlePasteImage(e, (b64) => {
                          const newQ = [...questions];
                          const blocks = newQ[qIndex].promptBlocks || [{ type: 'text', text: newQ[qIndex].promptRawText || '' }];
                          blocks.push({ type: 'image', url: b64 } as any);
                          newQ[qIndex] = { ...q, promptBlocks: blocks as any };
                          setQuestions(newQ);
                          saveQuestionsList(newQ);
                        })}
                        placeholder="Question Prompt... (Paste image to attach)"
                        style={{ width: '100%', minHeight: 80, padding: 14, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', marginBottom: 16, outline: 'none', fontSize: 15 }}
                      />

                      {/* Display images */}
                      {q.promptBlocks?.filter(b => b.type === 'image').length > 0 && (
                         <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                           {q.promptBlocks.filter(b => b.type === 'image').map((imgBlock: any, imgIdx: number) => (
                              <div key={imgIdx} style={{ position: 'relative' }}>
                                <img src={imgBlock.url} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: '1px solid #475569' }} />
                                <button 
                                  onClick={() => {
                                    const newQ = [...questions];
                                    const blocks = (newQ[qIndex].promptBlocks || []).filter(b => b !== imgBlock);
                                    newQ[qIndex] = { ...q, promptBlocks: blocks as any };
                                    setQuestions(newQ);
                                    saveQuestionsList(newQ);
                                  }}
                                  style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                                >✕</button>
                              </div>
                           ))}
                         </div>
                      )}
                      
                      {q.interaction.type === 'mcq' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {q.interaction.choices.map((choice, cIndex) => {
                            const isImage = choice.startsWith('data:image/') || choice.startsWith('http');
                            return (
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
                                
                                {isImage ? (
                                  <div style={{ position: 'relative', flex: 1, padding: 8, borderRadius: 8, background: '#0f172a', border: '1px solid #475569' }}>
                                    <img src={choice} style={{ maxWidth: 200, maxHeight: 100, borderRadius: 4 }} />
                                    <button 
                                      onClick={() => {
                                         const newQ = [...questions];
                                         if (newQ[qIndex].interaction.type === 'mcq') {
                                           (newQ[qIndex].interaction as any).choices[cIndex] = '';
                                           setQuestions(newQ);
                                           saveQuestionsList(newQ);
                                         }
                                      }}
                                      style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                                    >✕</button>
                                  </div>
                                ) : (
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
                                    onPaste={(e) => handlePasteImage(e, (b64) => {
                                       const newQ = [...questions];
                                       if (newQ[qIndex].interaction.type === 'mcq') {
                                         (newQ[qIndex].interaction as any).choices[cIndex] = b64;
                                         setQuestions(newQ);
                                         saveQuestionsList(newQ);
                                       }
                                    })}
                                    placeholder={`Option ${String.fromCharCode(65 + cIndex)} (Paste image here)`}
                                    style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 14 }}
                                  />
                                )}
                                <button 
                                  onClick={() => {
                                     const newQ = [...questions];
                                     if (newQ[qIndex].interaction.type === 'mcq') {
                                        const arr = (newQ[qIndex].interaction as any).choices;
                                        if (arr.length > 2) {
                                          arr.splice(cIndex, 1);
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
                            );
                          })}
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
              )}"""

code = code[:start_idx] + new_block + code[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Fixed main questions mapping again!")
