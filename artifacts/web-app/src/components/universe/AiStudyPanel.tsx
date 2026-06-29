/**
 * AiStudyPanel
 *
 * Full-screen overlay for 3 Groq-powered AI study modes:
 *   study_sheet  — Streams a one-page summary of all program content
 *   test_me      — Multi-turn quiz: 10 progressively harder questions with scoring
 *   feynman      — Socratic loop: explain → get corrected → re-explain until mastered
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type AiStudyMode = 'study_sheet' | 'test_me' | 'feynman';

export interface AiStudyPanelProps {
  open: boolean;
  onClose: () => void;
  mode: AiStudyMode;
  programTitle: string;
  contentSummary: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Mode Config ────────────────────────────────────────────────────────────────

const MODE_CONFIG = {
  study_sheet: {
    emoji: '📚',
    title: 'Learn How to Solve',
    subtitle: 'Step-by-step walkthrough of the key example question',
    accentColor: '#10b981',
    gradientFrom: '#065f46',
    gradientTo: '#022c22',
  },
  test_me: {
    emoji: '🎯',
    title: 'Test Me Until I Master It',
    subtitle: '10 progressively harder questions — find out what you actually know',
    accentColor: '#f59e0b',
    gradientFrom: '#b45309',
    gradientTo: '#78350f',
  },
  feynman: {
    emoji: '🌀',
    title: 'Feynman Technique',
    subtitle: "If you can't explain it simply, you don't understand it yet",
    accentColor: '#a78bfa',
    gradientFrom: '#7c3aed',
    gradientTo: '#4c1d95',
  },
} as const;

// ─── Groq Helpers ───────────────────────────────────────────────────────────────

async function callGroq(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1200,
): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.5,
      max_tokens: maxTokens,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices[0].message.content as string;
}

async function callGroqStream(
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: string) => void,
  maxTokens = 2000,
): Promise<void> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.4,
      max_tokens: maxTokens,
      stream: true,
    }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error?.message || 'Groq API error');
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

// ─── System Prompts ─────────────────────────────────────────────────────────────

function buildSystemPrompt(mode: AiStudyMode, programTitle: string, contentSummary: string): string {
  const base = `You are an expert tutor. The student is studying: "${programTitle}".

Here is the content of their study material:
---
${contentSummary}
---`;

  if (mode === 'study_sheet') {
    return `${base}

You are teaching the student HOW to solve this type of question. Pick the single BEST representative example from the material above — one that illustrates the core method most clearly.

Use EXACTLY this markdown format:

## 📌 Example Question
[Write the chosen question here, clearly and completely]

## Step-by-Step Solution

### Step 1: [Short action title — what you do]
[Explain what you do in this step and WHY. Be practical, not abstract.]
**Result:** [What changes / what you now have after this step]

### Step 2: [Short action title]
[Explain clearly.]
**Result:** [What you get]

[Continue with as many steps as the solution requires...]

## ✅ Final Answer
[State the complete final answer clearly]

## 💡 Key Insight
[One sentence: the single most important thing to remember when solving this type of question]

Rules: be concise and practical. Show the METHOD, not just arithmetic. Every step must have a clear title, explanation, and result.`;
  }

  if (mode === 'test_me') {
    return `${base}

You are a strict examiner. Your job is to ask the student 10 questions, starting easy and getting progressively harder, to assess how well they understood this material.

RULES:
- Ask ONE question at a time. Wait for the student's answer.
- After each answer: give a score (e.g. "Score: 8/10"), explain what was correct, and clarify what was wrong or missing.
- After 10 questions: give a final grade (e.g. "Final Grade: 74/100") with a summary of strengths and gaps.
- Be honest and precise. Don't be too lenient.
- Keep your questions grounded in the actual material above.

Start now by asking Question 1.`;
  }

  // feynman
  return `${base}

You are testing the student's CONCEPTUAL understanding. Do NOT ask computation or plug-in-numbers questions. Ask questions that require genuine understanding of CONCEPTS, PRINCIPLES, and RELATIONSHIPS.

Good examples:
- "What is the fundamental difference between [X] and [Y] in this topic?"
- "Why does this method work for this type of problem? When would it fail?"
- "If [a specific condition] changed, how and why would the answer be different?"
- "What underlying principle connects these different question types?"
- "Explain the steps to solve this type of question as if teaching a younger student."

RULES:
1. Ask ONE conceptual question at a time
2. After the student answers: evaluate their depth of understanding (not just correctness), gently correct any misconceptions, then ask the next concept
3. Probe until you are satisfied they truly understand — not just memorised
4. When an explanation is excellent: "✅ Perfect understanding!" then move to the next concept

Start by asking your first theoretical question about a key concept from this material.`;
}

// ─── Markdown Renderer (for Study Sheet) ────────────────────────────────────────

function renderMarkdown(text: string, accentColor: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let keyCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = keyCounter++;

    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={key} style={{
          fontSize: 20, fontWeight: 900, color: '#fff',
          margin: '0 0 16px', lineHeight: 1.3,
          borderBottom: `2px solid ${accentColor}40`,
          paddingBottom: 12,
        }}>
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key} style={{
          fontSize: 13, fontWeight: 800, color: accentColor,
          margin: '20px 0 8px', textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.slice(2);
      const parts = content.split(/(\*\*[^*]+\*\*)/g);
      elements.push(
        <div key={key} style={{
          display: 'flex', gap: 8, alignItems: 'flex-start',
          marginBottom: 6, paddingLeft: 4,
        }}>
          <span style={{ color: accentColor, flexShrink: 0, marginTop: 2 }}>▸</span>
          <span style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 }}>
            {parts.map((p, pi) =>
              p.startsWith('**') && p.endsWith('**')
                ? <strong key={pi} style={{ color: '#fff', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
                : p
            )}
          </span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={key} style={{ height: 4 }} />);
    } else {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      elements.push(
        <p key={key} style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.7, margin: '4px 0' }}>
          {parts.map((p, pi) =>
            p.startsWith('**') && p.endsWith('**')
              ? <strong key={pi} style={{ color: '#fff', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
              : p
          )}
        </p>
      );
    }
  }

  return <div>{elements}</div>;
}

// ─── Chat Bubble ────────────────────────────────────────────────────────────────

function ChatBubble({ msg, accentColor }: { msg: ChatMessage; accentColor: string }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: `${accentColor}22`,
          border: `1px solid ${accentColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0, marginRight: 8, alignSelf: 'flex-end',
        }}>
          🤖
        </div>
      )}
      <div style={{
        maxWidth: '75%',
        background: isUser ? `${accentColor}18` : 'rgba(255,255,255,0.05)',
        border: `1px solid ${isUser ? `${accentColor}40` : 'rgba(255,255,255,0.08)'}`,
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '12px 16px',
        fontSize: 14,
        color: '#e2e8f0',
        lineHeight: 1.7,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
      {isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: `${accentColor}22`,
          border: `1px solid ${accentColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0, marginLeft: 8, alignSelf: 'flex-end',
        }}>
          🧑
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function AiStudyPanel({
  open,
  onClose,
  mode,
  programTitle,
  contentSummary,
}: AiStudyPanelProps) {
  const cfg = MODE_CONFIG[mode];

  const [sheetContent, setSheetContent] = useState('');
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [copied, setCopied] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<boolean>(false);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  useEffect(() => {
    if (open && mode !== 'study_sheet') {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    abortRef.current = false;

    if (mode === 'study_sheet') {
      setSheetContent('');
      setSheetError('');
      setSheetLoading(true);
      const sysPrompt = buildSystemPrompt(mode, programTitle, contentSummary);
      callGroqStream(
        [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: 'Generate the study sheet now.' },
        ],
        (chunk) => {
          if (abortRef.current) return;
          setSheetContent(prev => prev + chunk);
        },
        2000,
      )
        .catch(err => {
          if (!abortRef.current) setSheetError(err.message || 'Failed to generate study sheet.');
        })
        .finally(() => {
          if (!abortRef.current) setSheetLoading(false);
        });
    } else {
      setMessages([]);
      setInputText('');
      setChatError('');
      setChatLoading(true);
      const sysPrompt = buildSystemPrompt(mode, programTitle, contentSummary);
      callGroq(
        [{ role: 'system', content: sysPrompt }],
        800,
      )
        .then(reply => {
          if (!abortRef.current) {
            setMessages([{ role: 'assistant', content: reply }]);
          }
        })
        .catch(err => {
          if (!abortRef.current) setChatError(err.message || 'Failed to connect to AI.');
        })
        .finally(() => {
          if (!abortRef.current) setChatLoading(false);
        });
    }

    return () => {
      abortRef.current = true;
    };
  }, [open, mode]);

  const handleSendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || chatLoading) return;

    const sysPrompt = buildSystemPrompt(mode, programTitle, contentSummary);
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInputText('');
    setChatLoading(true);
    setChatError('');

    try {
      const groqMessages = [
        { role: 'system', content: sysPrompt },
        ...newMessages.map(m => ({ role: m.role, content: m.content })),
      ];
      const reply = await callGroq(groqMessages, 1000);
      if (!abortRef.current) {
        setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      }
    } catch (err: unknown) {
      if (!abortRef.current) {
        setChatError(err instanceof Error ? err.message : 'AI error. Please try again.');
      }
    } finally {
      if (!abortRef.current) {
        setChatLoading(false);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }
  }, [inputText, chatLoading, messages, mode, programTitle, contentSummary]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sheetContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '90vw', maxWidth: 760,
          height: '88vh', maxHeight: 720,
          background: 'radial-gradient(120% 100% at 50% 0%, #1e1b4b 0%, #0f0f1a 100%)',
          border: `1px solid ${cfg.accentColor}30`,
          borderRadius: 24,
          display: 'flex', flexDirection: 'column',
          boxShadow: `0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px ${cfg.accentColor}15, inset 0 1px 0 rgba(255,255,255,0.05)`,
          overflow: 'hidden',
          animation: 'slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '20px 24px 16px',
          background: `linear-gradient(135deg, ${cfg.gradientFrom}40, ${cfg.gradientTo}20)`,
          borderBottom: `1px solid ${cfg.accentColor}20`,
          flexShrink: 0,
          display: 'flex', alignItems: 'flex-start', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: `${cfg.accentColor}18`,
            border: `1px solid ${cfg.accentColor}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
            boxShadow: `0 0 20px ${cfg.accentColor}20`,
          }}>
            {cfg.emoji}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 3 }}>
              {cfg.title}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
              {cfg.subtitle}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {mode === 'study_sheet' && sheetContent && !sheetLoading && (
              <button
                onClick={handleCopy}
                style={{
                  background: copied ? `${cfg.accentColor}20` : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${copied ? cfg.accentColor : 'rgba(255,255,255,0.1)'}`,
                  color: copied ? cfg.accentColor : '#94a3b8',
                  borderRadius: 10, padding: '7px 14px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.2s', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8', borderRadius: '50%',
                width: 34, height: 34,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 14, transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
                (e.currentTarget as HTMLButtonElement).style.color = '#fff';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
                (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8';
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        {mode === 'study_sheet' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 24px' }}>
            {sheetError ? (
              <div style={{
                color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 12, padding: '16px 20px', fontSize: 14,
              }}>
                ❌ {sheetError}
              </div>
            ) : sheetContent ? (
              <>
                {renderMarkdown(sheetContent, cfg.accentColor)}
                {sheetLoading && (
                  <span style={{
                    display: 'inline-block', width: 8, height: 16,
                    background: cfg.accentColor,
                    borderRadius: 2, animation: 'blink 1s step-end infinite',
                    marginLeft: 2, verticalAlign: 'middle',
                  }} />
                )}
              </>
            ) : sheetLoading ? (
              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                height: '60%', gap: 16,
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  border: `3px solid ${cfg.accentColor}30`,
                  borderTopColor: cfg.accentColor,
                  animation: 'spin 0.8s linear infinite',
                }} />
                <div style={{ color: '#94a3b8', fontSize: 14 }}>
                  Generating your study sheet...
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {/* Chat messages */}
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: '20px 24px 8px',
              display: 'flex', flexDirection: 'column',
            }}>
              {chatError && (
                <div style={{
                  color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 12, padding: '12px 16px', fontSize: 13,
                  marginBottom: 12,
                }}>
                  ❌ {chatError}
                </div>
              )}

              {messages.length === 0 && chatLoading && (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  flex: 1, gap: 14,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    border: `3px solid ${cfg.accentColor}30`,
                    borderTopColor: cfg.accentColor,
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>
                    Preparing your session...
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <ChatBubble key={i} msg={msg} accentColor={cfg.accentColor} />
              ))}

              {chatLoading && messages.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: `${cfg.accentColor}22`,
                    border: `1px solid ${cfg.accentColor}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16,
                  }}>
                    🤖
                  </div>
                  <div style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '18px 18px 18px 4px',
                    padding: '12px 16px',
                    display: 'flex', gap: 5, alignItems: 'center',
                  }}>
                    {[0, 1, 2].map(dotIdx => (
                      <span key={dotIdx} style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: cfg.accentColor,
                        display: 'inline-block',
                        animation: 'bounce 1.2s ease infinite',
                        animationDelay: `${dotIdx * 0.2}s`,
                      }} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Chat input */}
            <div style={{
              padding: '12px 20px 16px',
              borderTop: `1px solid ${cfg.accentColor}15`,
              background: 'rgba(0,0,0,0.2)',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your answer... (Enter to send, Shift+Enter for new line)"
                  disabled={chatLoading && messages.length === 0}
                  rows={2}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.05)',
                    border: `1px solid ${inputText ? cfg.accentColor + '60' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 14, padding: '12px 16px',
                    color: '#e2e8f0', fontSize: 14, fontFamily: 'inherit',
                    resize: 'none', outline: 'none', lineHeight: 1.5,
                    transition: 'border-color 0.2s',
                    maxHeight: 120,
                  }}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputText.trim() || chatLoading}
                  style={{
                    width: 44, height: 44, flexShrink: 0,
                    borderRadius: 12, border: 'none',
                    background: (!inputText.trim() || chatLoading)
                      ? 'rgba(255,255,255,0.05)'
                      : `linear-gradient(135deg, ${cfg.accentColor}, ${cfg.accentColor}aa)`,
                    color: (!inputText.trim() || chatLoading) ? '#475569' : '#fff',
                    fontSize: 18, cursor: (!inputText.trim() || chatLoading) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                    boxShadow: (!inputText.trim() || chatLoading) ? 'none' : `0 4px 12px ${cfg.accentColor}40`,
                  }}
                >
                  ↑
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 6, paddingLeft: 2 }}>
                Press{' '}
                <kbd style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 4, padding: '1px 5px', fontSize: 10,
                }}>
                  Enter
                </kbd>{' '}
                to send
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(24px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0) }
          40% { transform: translateY(-5px) }
        }
      `}</style>
    </div>
  );
}
