import { useState, useEffect, useRef } from 'react';
import LatexMarkdown from '@/components/ui/LatexMarkdown';

export type AiStudyMode = 'study_sheet' | 'test_me' | 'feynman';

export interface AiStudyPanelProps {
  open: boolean;
  onClose: () => void;
  mode: AiStudyMode;
  programTitle: string;
  contentSummary: string;
}

const ACCENT = '#10b981';

interface Step {
  title: string;
  current_equation: string;
  explanation: string;
}

interface LearnData {
  question: string;
  steps: Step[];
}

async function fetchLearnData(programTitle: string, contentSummary: string): Promise<LearnData> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set');

  const systemPrompt = `You are an expert tutor. The student is studying: "${programTitle}".
Here is the content of their study material:
---
${contentSummary}
---

You are teaching the student HOW to solve this type of question. Pick the single BEST representative example from the material above.

Return ONLY a JSON object with this exact structure:
{
  "question": "The chosen example question, formatted clearly with latex if needed.",
  "steps": [
    {
      "title": "Step 1: Short title of the action",
      "current_equation": "The current state of the math problem/equation at this step (formatted in latex).",
      "explanation": "Detailed explanation of what to do and why, using markdown and latex."
    }
  ]
}
CRITICAL: Generate all content (including titles, questions, and explanations) in the EXACT SAME LANGUAGE as the programTitle and contentSummary. Do not translate.
NO OTHER TEXT OR MARKDOWN OUTSIDE THE JSON.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    }),
  });
  
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq API error');
  
  const content = data.choices[0].message.content as string;
  const parsed = JSON.parse(content) as LearnData;
  return parsed;
}

export default function AiStudyPanel({
  open,
  onClose,
  mode,
  programTitle,
  contentSummary,
}: AiStudyPanelProps) {
  const [data, setData] = useState<LearnData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const abortRef = useRef<boolean>(false);

  useEffect(() => {
    if (!open) return;
    if (mode !== 'study_sheet') return; // Fallback in case old modes are passed

    abortRef.current = false;
    setLoading(true);
    setError('');
    setData(null);
    setExpandedSteps({});

    fetchLearnData(programTitle, contentSummary)
      .then(res => {
        if (!abortRef.current) setData(res);
      })
      .catch(err => {
        if (!abortRef.current) setError(err.message || 'Failed to generate learning steps.');
      })
      .finally(() => {
        if (!abortRef.current) setLoading(false);
      });

    return () => {
      abortRef.current = true;
    };
  }, [open, mode, programTitle, contentSummary]);

  const toggleStep = (idx: number) => {
    setExpandedSteps(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000,
      background: 'rgba(10,10,20,0.95)', backdropFilter: 'blur(10px)',
      display: 'flex', flexDirection: 'column',
      animation: 'fadeIn 0.2s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px', background: 'rgba(0,0,0,0.2)',
        borderBottom: `1px solid ${ACCENT}20`,
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, flexShrink: 0,
          background: `${ACCENT}18`, border: `1px solid ${ACCENT}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, boxShadow: `0 0 20px ${ACCENT}20`,
        }}>
          📚
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 3 }}>
            Learn How to Solve
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
            Step-by-step walkthrough of the key example question
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#94a3b8', borderRadius: '50%', width: 34, height: 34,
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
        >✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 20px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 700 }}>
          {error && (
            <div style={{
              color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 12, padding: '16px 20px', fontSize: 14,
            }}>
              ❌ {error}
            </div>
          )}

          {loading && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '60%', gap: 16,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                border: `3px solid ${ACCENT}30`, borderTopColor: ACCENT,
                animation: 'spin 0.8s linear infinite',
              }} />
              <div style={{ color: '#94a3b8', fontSize: 14 }}>
                Preparing step-by-step solution...
              </div>
            </div>
          )}

          {data && !loading && (
            <div style={{ animation: 'slideUp 0.3s ease' }}>
              {/* Example Question */}
              <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: '24px 32px', marginBottom: 32,
                textAlign: 'center'
              }}>
                <div style={{
                  fontSize: 12, color: ACCENT, fontWeight: 800, textTransform: 'uppercase',
                  letterSpacing: '0.1em', marginBottom: 12
                }}>
                  Example Question
                </div>
                <div style={{ fontSize: 18, color: '#f8fafc', lineHeight: 1.7, fontWeight: 500 }}>
                  <LatexMarkdown content={data.question} />
                </div>
              </div>

              {/* Steps */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {data.steps.map((step, idx) => {
                  const isExpanded = !!expandedSteps[idx];
                  return (
                    <div key={idx} style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 12, overflow: 'hidden',
                      transition: 'all 0.3s ease'
                    }}>
                      <div
                        onClick={() => toggleStep(idx)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '16px 20px', cursor: 'pointer',
                          background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                        }}
                      >
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%',
                            background: `${ACCENT}20`, color: ACCENT,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 800
                          }}>
                            {idx + 1}
                          </div>
                          <LatexMarkdown content={step.title} />
                        </div>
                        <button style={{
                          background: `${ACCENT}20`, color: ACCENT, border: `1px solid ${ACCENT}50`,
                          padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                          cursor: 'pointer',
                        }}>
                          {isExpanded ? 'Hide' : 'Explain'}
                        </button>
                      </div>

                      {/* The actual math state for this step */}
                      {step.current_equation && (
                        <div style={{
                          padding: '0 24px 16px 60px',
                          fontSize: 16, color: '#f8fafc', fontWeight: 600,
                        }}>
                          <LatexMarkdown content={step.current_equation} />
                        </div>
                      )}
                      
                      {isExpanded && (
                        <div style={{
                          padding: '20px 24px 24px 60px',
                          borderTop: '1px solid rgba(255,255,255,0.05)',
                          background: 'rgba(0,0,0,0.2)',
                        }}>
                          <div style={{ fontSize: 15, color: '#cbd5e1', lineHeight: 1.8 }}>
                            <LatexMarkdown content={step.explanation} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(24px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}
