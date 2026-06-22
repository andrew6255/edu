import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Inject handlePasteImage right after saveNodeEdits
helper_func = """
  const handlePasteImage = async (e: React.ClipboardEvent, onBase64: (b64: string) => void) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result) onBase64(ev.target.result as string);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };
"""
code = re.sub(r'(async function saveNodeEdits.*?finally \{.*?\n  \})', r'\1\n' + helper_func, code, flags=re.DOTALL)

# 2. Update the main questions rendering block
# We have a <textarea>... <img /> ... {q.interaction.type === 'mcq' && ... choices.map...}
# I will use regex to find and replace this entire block.
old_question_block = r"""                      <textarea
                        value=\{q\.promptRawText \|\| \(q\.promptBlocks\?\.\[0\] as any\)\?\.text \|\| ''\}
                        onChange=\{\(e\) => \{
                          const newQ = \[\.\.\.questions\];
                          newQ\[qIndex\] = \{ \.\.\.q, promptRawText: e\.target\.value, promptBlocks: \[\{ type: 'text', text: e\.target\.value \}\] \};
                          setQuestions\(newQ\);
                        \}\}
                        onBlur=\{\(\) => saveQuestionsList\(questions\)\}
                        placeholder="Question Prompt\.\.\."
                        style=\{\{ width: '100%', minHeight: 80, padding: 14, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', marginBottom: 16, outline: 'none', fontSize: 15 \}\}
                      />

                      \{\/\* Display image if present \*\/\}
                      \{q\.promptBlocks\?\.find\(b => b\.type === 'image'\) && \(
                         <div style=\{\{ marginBottom: 16 \}\}>
                           <img src=\{\(q\.promptBlocks\.find\(b => b\.type === 'image'\) as any\)\.url\} style=\{\{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 \}\} />
                         </div>
                      \)\}
                      
                      \{q\.interaction\.type === 'mcq' && \(
                        <div style=\{\{ display: 'flex', flexDirection: 'column', gap: 10 \}\}>
                          \{q\.interaction\.choices\.map\(\(choice, cIndex\) => \(
                            <div key=\{cIndex\} style=\{\{ display: 'flex', alignItems: 'center', gap: 12 \}\}>
                              <button
                                onClick=\{\(\) => \{
                                  const newQ = \[\.\.\.questions\];
                                  if \(newQ\[qIndex\]\.interaction\.type === 'mcq'\) \{
                                    \(newQ\[qIndex\]\.interaction as any\)\.correctChoiceIndex = cIndex;
                                    saveQuestionsList\(newQ\);
                                  \}
                                \}\}
                                title="Click to mark as correct answer"
                                style=\{\{
                                  width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
                                  background: q\.interaction\.type === 'mcq' && q\.interaction\.correctChoiceIndex === cIndex \? '#22c55e' : '#334155',
                                  color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: 14,
                                  transition: 'background 0\.2s'
                                \}\}
                              >
                                \{String\.fromCharCode\(65 \+ cIndex\)\}
                              </button>
                              <input
                                value=\{choice\}
                                onChange=\{\(e\) => \{
                                   const newQ = \[\.\.\.questions\];
                                   if \(newQ\[qIndex\]\.interaction\.type === 'mcq'\) \{
                                     \(newQ\[qIndex\]\.interaction as any\)\.choices\[cIndex\] = e\.target\.value;
                                     setQuestions\(newQ\);
                                   \}
                                \}\}
                                onBlur=\{\(\) => saveQuestionsList\(questions\)\}
                                placeholder=\{`Option \$\{String\.fromCharCode\(65 \+ cIndex\)\}`\}
                                style=\{\{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 14 \}\}
                              />
                            </div>
                          \)\)\}
                        </div>
                      \)\}"""

new_question_block = """                      <textarea
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
                              </div>
                            );
                          })}
                        </div>
                      )}"""

code = re.sub(old_question_block, new_question_block, code, flags=re.DOTALL)

# 3. Add "Add manually" button inside the AddQuestions modal
# The upload box is:
add_manual_btn = """              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                 <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>— OR —</div>
                 <button onClick={() => {
                    const newQ: any = {
                       id: `manual_${Date.now()}`,
                       promptRawText: '',
                       promptBlocks: [{ type: 'text', text: '' }],
                       interaction: { type: 'mcq', choices: ['', '', '', ''], correctChoiceIndex: 0 },
                       timeLimitSec: 0, iqDeltaCorrect: 0, iqDeltaWrong: 0
                    };
                    setExtractedQuestions([...extractedQuestions, newQ]);
                 }} className="ll-btn" style={{ background: '#334155', color: 'white', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold' }}>
                    + Add Question Manually
                 </button>
              </div>"""

upload_box = r"""                    </div>
                  </>
                \)}
              </div>"""
# We just append it after the dropzone box in the modal, which is before `extractedQuestions.length > 0`
# Let's be precise.
#           {extractedQuestions.length === 0 ? (
#              ...
#           ) : (
#              ...
#           )}
code = re.sub(r'(\s*)\{extractedQuestions\.length === 0 \? \(', r'\1{extractedQuestions.length === 0 ? (', code)
# Actually the dropzone ends at:
#                    </div>
#                  </>
#                )}
#              </div>
#            ) : (

code = code.replace(
"""                    </div>
                  </>
                )}
              </div>
            ) : (""",
"""                    </div>
                  </>
                )}
              </div>
""" + add_manual_btn + """
            ) : (""")

# 4. Now replace the question block in extractedQuestions mapping
# It is very similar. Let's find the textarea for extractedQuestions
old_extract_q_block = r"""                      <textarea
                        value=\{q\.promptRawText \|\| \(q\.promptBlocks\?\.\[0\] as any\)\?\.text \|\| ''\}
                        onChange=\{\(e\) => \{
                          const newQ = \[\.\.\.extractedQuestions\];
                          newQ\[qIndex\] = \{ \.\.\.q, promptRawText: e\.target\.value, promptBlocks: \[\{ type: 'text', text: e\.target\.value \}\] \};
                          setExtractedQuestions\(newQ\);
                        \}\}
                        placeholder="Question Prompt\.\.\."
                        style=\{\{ width: '100%', minHeight: 80, padding: 14, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', marginBottom: 16, outline: 'none', fontSize: 15 \}\}
                      />

                      \{\/\* Display image if it exists \*\/\}
                      \{q\.imageUrl && \(
                        <div style=\{\{ marginBottom: 16 \}\}>
                          <img src=\{q\.imageUrl\} style=\{\{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 \}\} />
                        </div>
                      \)\}

                      \{q\.interaction\.type === 'mcq' && \(
                        <div style=\{\{ display: 'flex', flexDirection: 'column', gap: 10 \}\}>
                          \{q\.interaction\.choices\.map\(\(choice: string, cIndex: number\) => \(
                            <div key=\{cIndex\} style=\{\{ display: 'flex', alignItems: 'center', gap: 12 \}\}>
                              <button
                                onClick=\{\(\) => \{
                                  const newQ = \[\.\.\.extractedQuestions\];
                                  if \(newQ\[qIndex\]\.interaction\.type === 'mcq'\) \{
                                    \(newQ\[qIndex\]\.interaction as any\)\.correctChoiceIndex = cIndex;
                                    setExtractedQuestions\(newQ\);
                                  \}
                                \}\}
                                title="Click to mark as correct answer"
                                style=\{\{
                                  width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
                                  background: q\.interaction\.type === 'mcq' && q\.interaction\.correctChoiceIndex === cIndex \? '#22c55e' : '#334155',
                                  color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: 14,
                                  transition: 'background 0\.2s'
                                \}\}
                              >
                                \{String\.fromCharCode\(65 \+ cIndex\)\}
                              </button>
                              <input
                                value=\{choice\}
                                onChange=\{\(e\) => \{
                                   const newQ = \[\.\.\.extractedQuestions\];
                                   if \(newQ\[qIndex\]\.interaction\.type === 'mcq'\) \{
                                     \(newQ\[qIndex\]\.interaction as any\)\.choices\[cIndex\] = e\.target\.value;
                                     setExtractedQuestions\(newQ\);
                                   \}
                                \}\}
                                placeholder=\{`Option \$\{String\.fromCharCode\(65 \+ cIndex\)\}`\}
                                style=\{\{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 14 \}\}
                              />
                            </div>
                          \)\)\}
                        </div>
                      \)\}"""

new_extract_q_block = """                      <textarea
                        value={q.promptRawText || (q.promptBlocks?.[0] as any)?.text || ''}
                        onChange={(e) => {
                          const newQ = [...extractedQuestions];
                          const newText = e.target.value;
                          const existingImages = (q.promptBlocks || []).filter((b: any) => b.type === 'image');
                          newQ[qIndex] = { ...q, promptRawText: newText, promptBlocks: [{ type: 'text', text: newText }, ...existingImages] as any };
                          setExtractedQuestions(newQ);
                        }}
                        onPaste={(e) => handlePasteImage(e, (b64) => {
                          const newQ = [...extractedQuestions];
                          const blocks = newQ[qIndex].promptBlocks || [{ type: 'text', text: newQ[qIndex].promptRawText || '' }];
                          blocks.push({ type: 'image', url: b64 } as any);
                          newQ[qIndex] = { ...q, promptBlocks: blocks as any };
                          setExtractedQuestions(newQ);
                        })}
                        placeholder="Question Prompt... (Paste image to attach)"
                        style={{ width: '100%', minHeight: 80, padding: 14, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', marginBottom: 16, outline: 'none', fontSize: 15 }}
                      />

                      {/* Display image from extraction or manual paste */}
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
                                const newQ = [...extractedQuestions];
                                const blocks = (newQ[qIndex].promptBlocks || []).filter((b: any) => b !== imgBlock);
                                newQ[qIndex] = { ...q, promptBlocks: blocks as any };
                                setExtractedQuestions(newQ);
                              }}
                              style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                            >✕</button>
                          </div>
                        ))}
                      </div>

                      {q.interaction.type === 'mcq' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {q.interaction.choices.map((choice: string, cIndex: number) => {
                            const isImage = choice.startsWith('data:image/') || choice.startsWith('http');
                            return (
                              <div key={cIndex} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <button
                                  onClick={() => {
                                    const newQ = [...extractedQuestions];
                                    if (newQ[qIndex].interaction.type === 'mcq') {
                                      (newQ[qIndex].interaction as any).correctChoiceIndex = cIndex;
                                      setExtractedQuestions(newQ);
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
                                         const newQ = [...extractedQuestions];
                                         if (newQ[qIndex].interaction.type === 'mcq') {
                                           (newQ[qIndex].interaction as any).choices[cIndex] = '';
                                           setExtractedQuestions(newQ);
                                         }
                                      }}
                                      style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                                    >✕</button>
                                  </div>
                                ) : (
                                  <input
                                    value={choice}
                                    onChange={(e) => {
                                       const newQ = [...extractedQuestions];
                                       if (newQ[qIndex].interaction.type === 'mcq') {
                                         (newQ[qIndex].interaction as any).choices[cIndex] = e.target.value;
                                         setExtractedQuestions(newQ);
                                       }
                                    }}
                                    onPaste={(e) => handlePasteImage(e, (b64) => {
                                       const newQ = [...extractedQuestions];
                                       if (newQ[qIndex].interaction.type === 'mcq') {
                                         (newQ[qIndex].interaction as any).choices[cIndex] = b64;
                                         setExtractedQuestions(newQ);
                                       }
                                    })}
                                    placeholder={`Option ${String.fromCharCode(65 + cIndex)} (Paste image here)`}
                                    style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 14 }}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}"""

code = re.sub(old_extract_q_block, new_extract_q_block, code, flags=re.DOTALL)


# Also add a general "Add Question" to the top right of extracted review (to let user keep adding manual ones if desired)
code = code.replace(
"""                <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>""",
"""                <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                     <button onClick={() => {
                        const newQ: any = {
                           id: `manual_${Date.now()}`,
                           promptRawText: '',
                           promptBlocks: [{ type: 'text', text: '' }],
                           interaction: { type: 'mcq', choices: ['', '', '', ''], correctChoiceIndex: 0 },
                           timeLimitSec: 0, iqDeltaCorrect: 0, iqDeltaWrong: 0
                        };
                        setExtractedQuestions([...extractedQuestions, newQ]);
                     }} className="ll-btn ll-btn-primary" style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold' }}>
                        + Add Question Manually
                     </button>
                  </div>"""
)


with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated script to support images and manual questions successfully!")
