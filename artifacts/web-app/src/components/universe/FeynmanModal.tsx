import { useState, useCallback, useEffect } from 'react';
import type { PersonalProgramQuestion } from '@/lib/personalProgramService';
import LatexMarkdown from '@/components/ui/LatexMarkdown';

interface FeynmanModalProps {
  open: boolean;
  onClose: () => void;
  answeredQuestions: PersonalProgramQuestion[];
  programTitle: string;
}

const ACCENT = '#ec4899'; // pink for Feynman

export default function FeynmanModal({ open, onClose, answeredQuestions, programTitle }: FeynmanModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userText, setUserText] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [formattedQuestion, setFormattedQuestion] = useState('');

  const q = answeredQuestions[currentIndex];

  useEffect(() => {
    if (!q) return;
    setFormattedQuestion(q.rawText); // default
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!apiKey) return;

    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'system',
          content: 'You are a LaTeX formatter. Format the provided raw OCR text into a beautiful math problem using LaTeX ($ and $$). Fix any broken superscripts or math notation (e.g., e3x to e^{3x}, dx, dy). CRITICAL: DO NOT TRANSLATE ANY TEXT. KEEP THE EXACT ORIGINAL LANGUAGE AND CHARACTERS. DO NOT solve the problem, DO NOT add any extra text, JUST output the formatted question.'
        }, {
          role: 'user',
          content: q.rawText
        }],
        temperature: 0.1,
        max_tokens: 300,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.choices?.[0]?.message?.content) {
          setFormattedQuestion(data.choices[0].message.content);
        }
      })
      .catch(console.error);
  }, [q]);

  if (!open) return null;

  if (answeredQuestions.length === 0) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(10,10,20,0.95)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ background: '#12121e', padding: 32, borderRadius: 16, border: '1px solid #333', maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🧑‍🏫</div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginBottom: 8 }}>No Questions Yet</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24 }}>
            Solve some questions first so you can explain them!
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none',
            padding: '10px 24px', borderRadius: 8, cursor: 'pointer',
          }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!userText.trim()) return;
    setLoading(true);
    setFeedback('');
    setError('');

    try {
      const apiKey = import.meta.env.VITE_GROQ_API_KEY;
      if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set');

      const systemPrompt = `You are a strict evaluator for the Feynman Technique. The user is trying to explain the solution to a specific math/physics problem.
Topic: ${programTitle}
Question: ${q.rawText}

Your instructions:
1. STRICTLY evaluate ONLY their explanation.
2. If they are correct, confirm it and briefly highlight why it's a good explanation.
3. If they are incorrect, gently correct them and point out the gap in their understanding.
4. If their input is IRRELEVANT or off-topic, strictly reply: "This is not relevant to the question. Please explain how to solve the problem."
5. Use markdown and latex ($ and $$) for any math notation.`;

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Error communicating with AI');
      setFeedback(data.choices[0].message.content);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    setUserText('');
    setFeedback('');
    setCurrentIndex((prev) => Math.min(prev + 1, answeredQuestions.length - 1));
  };

  const handlePrev = () => {
    setUserText('');
    setFeedback('');
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000,
      background: '#0a0a14',
      display: 'flex', flexDirection: 'column',
      animation: 'feynman-fade 0.2s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', background: '#12121e',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: ACCENT,
          background: `${ACCENT}15`, border: `1px solid ${ACCENT}30`,
          borderRadius: 8, padding: '5px 12px',
        }}>
          Feynman Mode ({currentIndex + 1} / {answeredQuestions.length})
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: currentIndex === 0 ? 'rgba(255,255,255,0.2)' : '#fff',
              padding: '4px 12px', borderRadius: 6, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            ← Prev
          </button>
          <button
            onClick={handleNext}
            disabled={currentIndex === answeredQuestions.length - 1}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: currentIndex === answeredQuestions.length - 1 ? 'rgba(255,255,255,0.2)' : '#fff',
              padding: '4px 12px', borderRadius: 6, cursor: currentIndex === answeredQuestions.length - 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
            fontFamily: 'inherit', color: '#fca5a5', fontSize: 12,
          }}
        >
          Exit
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '36px 20px 20px' }}>
        <div style={{ width: '100%', maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Question Display */}
          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16, padding: '24px 28px',
          }}>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
              Question
            </div>
            <div style={{ fontSize: 16, color: '#e2e8f0', lineHeight: 1.8 }}>
              <LatexMarkdown content={formattedQuestion} />
            </div>
          </div>

          {/* User Explanation Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
              Explain it as if to a 10-year-old:
            </div>
            <textarea
              value={userText}
              onChange={(e) => setUserText(e.target.value)}
              placeholder="Start typing your explanation..."
              disabled={loading || !!feedback}
              style={{
                width: '100%', minHeight: 140, padding: 16, borderRadius: 12,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 15, lineHeight: 1.6, resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            
            {!feedback && (
              <button
                onClick={handleSubmit}
                disabled={loading || !userText.trim()}
                style={{
                  background: loading || !userText.trim() ? 'rgba(255,255,255,0.05)' : `${ACCENT}20`,
                  color: loading || !userText.trim() ? '#666' : ACCENT,
                  border: `1px solid ${loading || !userText.trim() ? 'rgba(255,255,255,0.1)' : `${ACCENT}50`}`,
                  padding: '12px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: loading || !userText.trim() ? 'not-allowed' : 'pointer',
                  transition: '0.2s'
                }}
              >
                {loading ? 'Evaluating...' : 'Submit Explanation'}
              </button>
            )}

            {error && (
              <div style={{ color: '#ef4444', fontSize: 13, background: '#ef444415', padding: 12, borderRadius: 8 }}>
                {error}
              </div>
            )}
          </div>

          {/* AI Feedback */}
          {feedback && (
            <div style={{
              background: '#10b98110', border: '1px solid #10b98130',
              borderRadius: 12, padding: '20px 24px',
              animation: 'feynman-fade 0.3s ease',
              marginBottom: 40
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                AI Feedback
              </div>
              <div style={{ fontSize: 15, color: '#e2e8f0', lineHeight: 1.7 }}>
                <LatexMarkdown content={feedback} />
              </div>
              
              <button
                onClick={() => {
                  setUserText('');
                  setFeedback('');
                }}
                style={{
                  marginTop: 16, background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)', padding: '8px 16px', borderRadius: 8,
                  fontSize: 13, cursor: 'pointer'
                }}
              >
                Try Again
              </button>
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes feynman-fade {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
