/**
 * TestMeModal
 *
 * Flow:
 *  1. Picking — choose Full Question or MCQ (blocked if 0 answered questions)
 *  2. Generating — Groq produces test questions based on answered worksheet questions
 *  3a. Full Question — one question at a time, user works on paper, then sees answer
 *  3b. MCQ — 4 options, immediate feedback after each selection
 *  4. Results — score / per-question breakdown
 */

import { useState, useCallback } from 'react';
import type { PersonalProgramQuestion } from '@/lib/personalProgramService';
import LatexMarkdown from '@/components/ui/LatexMarkdown';
import FullScreenWorkspace from '@/components/FullScreenWorkspace';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface TestQuestion {
  questionText: string;
  correctAnswer: string;
  explanation: string;
  /** shuffled display choices for MCQ */
  displayChoices: string[];
  /** index within displayChoices that is the correct answer */
  correctIdx: number;
  gradeScore?: number;
  gradeText?: string;
}

type TestPhase =
  | { name: 'picking' }
  | { name: 'generating' }
  | { name: 'error'; message: string }
  | { name: 'full_question_workspace'; questions: TestQuestion[]; idx: number }
  | { name: 'full_question_review'; questions: TestQuestion[]; idx: number }
  | { name: 'mcq'; questions: TestQuestion[]; idx: number; selected: number | null; correct: boolean[] }
  | { name: 'results_full'; questions: TestQuestion[] }
  | { name: 'results_mcq'; questions: TestQuestion[]; correct: boolean[] };

export interface TestMeModalProps {
  open: boolean;
  onClose: () => void;
  answeredQuestions: PersonalProgramQuestion[];
  programTitle: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function generateTestQuestions(
  answeredQuestions: PersonalProgramQuestion[],
  programTitle: string,
  count: number,
  mode: 'full' | 'mcq'
): Promise<TestQuestion[]> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set');

  const questionList = answeredQuestions
    .map((q, i) => `Q${i + 1}: ${q.rawText}`)
    .join('\n\n');

  const modeInstruction = mode === 'mcq'
    ? 'CRITICAL: For multi-step math/physics problems, DO NOT ask for the final answer. Instead, present the problem, show the first step(s), and ask the student to identify the CORRECT NEXT STEP. Provide the next logical step as the correct choice.'
    : 'CRITICAL: The student will solve this on a piece of paper. Ask the FULL question that requires the full final answer. Provide the full final answer as the correct choice.';

  const systemPrompt = `You are a test generator for the subject "${programTitle}". The student has answered the following questions from their worksheet:\n\n${questionList}\n\nGenerate exactly ${count} NEW test questions that are SIMILAR but DIFFERENT variations — change specific values (numbers, variables, names, scenarios) while keeping the same mathematical/conceptual structure and difficulty. Each question must be solvable with the same method as the original it is based on.\n\n${modeInstruction}\n\nCRITICAL: Any math equations, expressions, variables, or notations in the questionText, correctAnswer, explanation, and choices MUST be formatted in proper LaTeX wrapped in $ (inline) or $$ (block). Fix any broken powers (e.g. e^{3x} instead of e3x).\n\nCRITICAL: Generate the test questions, correct answers, explanations, and choices in the EXACT SAME LANGUAGE as the provided questions. Do not translate.\n\nFor each question ALSO generate 3 plausible but WRONG answer choices (so 4 total, first is always correct).\n\nReturn ONLY a JSON array with no other text:\n[\n  {\n    "questionText": "...",\n    "correctAnswer": "...",\n    "explanation": "Step-by-step: ...",\n    "choices": ["correct answer text", "wrong option 2", "wrong option 3", "wrong option 4"]\n  }\n]`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate ${count} test questions now. Return ONLY the JSON array.` },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq API error');

  const raw = data.choices[0].message.content as string;
  // Extract JSON array from response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('AI returned unexpected format. Please try again.');
  const parsed = JSON.parse(match[0]) as Array<{
    questionText: string;
    correctAnswer: string;
    explanation: string;
    choices: string[];
  }>;

  return parsed.map(q => {
    const choices = q.choices?.length >= 4 ? q.choices : [q.correctAnswer, 'Option B', 'Option C', 'Option D'];
    const shuffled = shuffle(choices);
    const correctIdx = shuffled.indexOf(choices[0]);
    return {
      questionText: q.questionText,
      correctAnswer: choices[0],
      explanation: q.explanation,
      displayChoices: shuffled,
      correctIdx,
    };
  });
}

// ─── Small UI helpers ────────────────────────────────────────────────────────────

const ACCENT = '#f59e0b';

function Spinner() {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%',
      border: `3px solid ${ACCENT}30`,
      borderTopColor: ACCENT,
      animation: 'testme-spin 0.8s linear infinite',
    }} />
  );
}

function ChoiceButton({
  label, text, onClick, state,
}: {
  label: string;
  text: string;
  onClick: () => void;
  state: 'default' | 'correct' | 'wrong' | 'revealed-correct';
}) {
  const bg = state === 'correct' ? '#10b98122'
    : state === 'wrong' ? '#ef444422'
    : state === 'revealed-correct' ? '#10b98115'
    : 'rgba(255,255,255,0.04)';
  const border = state === 'correct' ? '#10b981'
    : state === 'wrong' ? '#ef4444'
    : state === 'revealed-correct' ? '#10b98160'
    : 'rgba(255,255,255,0.1)';
  const icon = state === 'correct' ? '✓' : state === 'wrong' ? '✗' : state === 'revealed-correct' ? '✓' : '';

  return (
    <button
      onClick={state === 'default' ? onClick : undefined}
      style={{
        width: '100%', textAlign: 'left', background: bg,
        border: `1.5px solid ${border}`, borderRadius: 12,
        padding: '14px 16px', cursor: state === 'default' ? 'pointer' : 'default',
        fontFamily: 'inherit', color: '#e2e8f0', fontSize: 14, lineHeight: 1.5,
        display: 'flex', gap: 12, alignItems: 'flex-start', transition: 'all 0.2s',
      }}
    >
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: state === 'default' ? 'rgba(255,255,255,0.06)'
            : state === 'correct' ? '#10b981'
            : state === 'wrong' ? '#ef4444'
            : '#10b981',
          color: state === 'default' ? '#94a3b8' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 13,
        }}>
          {icon || label}
        </div>
        <LatexMarkdown content={text} className="flex-1" />
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function TestMeModal({ open, onClose, answeredQuestions, programTitle }: TestMeModalProps) {
  const [phase, setPhase] = useState<TestPhase>({ name: 'picking' });
  const [isGrading, setIsGrading] = useState(false);

  const n = Math.min(answeredQuestions.length, 5);
  const hasEnough = answeredQuestions.length > 0;

  // Reset to picking on close/reopen
  const handleClose = useCallback(() => {
    setPhase({ name: 'picking' });
    onClose();
  }, [onClose]);

  const startTest = useCallback(async (mode: 'full' | 'mcq') => {
    setPhase({ name: 'generating' });
    try {
      const questions = await generateTestQuestions(answeredQuestions, programTitle, n, mode);
      if (mode === 'full') {
        setPhase({ name: 'full_question_workspace', questions, idx: 0 });
      } else {
        setPhase({ name: 'mcq', questions, idx: 0, selected: null, correct: [] });
      }
    } catch (err: unknown) {
      setPhase({ name: 'error', message: err instanceof Error ? err.message : 'Failed to generate questions.' });
    }
  }, [answeredQuestions, programTitle, n]);

  if (!open) return null;

  // ─── Picking ────────────────────────────────────────────────────────────────────
  const renderPicking = () => (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={handleClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'radial-gradient(120% 100% at 50% 0%, #1c1710 0%, #0f0f1a 100%)',
        border: `1px solid ${ACCENT}30`,
        borderRadius: 24, padding: '32px 28px', width: '90vw', maxWidth: 460,
        boxShadow: `0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px ${ACCENT}15`,
        animation: 'testme-up 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎯</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
            Test Me Until I Master It
          </div>
          {hasEnough ? (
            <div style={{ fontSize: 13, color: '#94a3b8' }}>
              Test based on your{' '}
              <span style={{ color: ACCENT, fontWeight: 700 }}>{answeredQuestions.length} answered question{answeredQuestions.length !== 1 ? 's' : ''}</span>
              {' '}— {n} new questions will be generated
            </div>
          ) : (
            <div style={{
              fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px',
              marginTop: 8,
            }}>
              ⚠️ You need to complete at least one question first.
              Mark a question as ✓ done to unlock the test.
            </div>
          )}
        </div>

        {hasEnough && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <button
              onClick={() => startTest('full')}
              style={{
                flex: 1, background: `${ACCENT}12`, border: `1px solid ${ACCENT}40`,
                borderRadius: 16, padding: '20px 12px', cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s', color: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = `${ACCENT}22`; el.style.borderColor = `${ACCENT}70`; el.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = `${ACCENT}12`; el.style.borderColor = `${ACCENT}40`; el.style.transform = ''; }}
            >
              <span style={{ fontSize: 28 }}>📝</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>Full Question</span>
              <span style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 1.4 }}>
                Work on paper, then check the solution
              </span>
            </button>
            <button
              onClick={() => startTest('mcq')}
              style={{
                flex: 1, background: '#a78bfa12', border: '1px solid #a78bfa40',
                borderRadius: 16, padding: '20px 12px', cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s', color: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = '#a78bfa22'; el.style.borderColor = '#a78bfa70'; el.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = '#a78bfa12'; el.style.borderColor = '#a78bfa40'; el.style.transform = ''; }}
            >
              <span style={{ fontSize: 28 }}>🅐🅑🅒🅓</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>Multiple Choice</span>
              <span style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 1.4 }}>
                4 options, instant feedback
              </span>
            </button>
          </div>
        )}

        <button
          onClick={handleClose}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12, padding: '10px', cursor: 'pointer',
            fontFamily: 'inherit', color: '#64748b', fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
      <TestMeStyles />
    </div>
  );

  // ─── Generating ──────────────────────────────────────────────────────────────────
  const renderGenerating = () => (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      <Spinner />
      <div style={{ color: '#94a3b8', fontSize: 14 }}>Generating your personalised test questions...</div>
      <div style={{ color: '#475569', fontSize: 12 }}>Creating {n} variations of your answered questions</div>
      <TestMeStyles />
    </div>
  );

  // ─── Error ────────────────────────────────────────────────────────────────────
  if (phase.name === 'error') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#0f0f1a', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 20, padding: '28px 24px', maxWidth: 400, textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <div style={{ color: '#fca5a5', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>{phase.message}</div>
          <button onClick={() => setPhase({ name: 'picking' })} style={{
            background: `${ACCENT}15`, border: `1px solid ${ACCENT}40`, borderRadius: 10,
            padding: '10px 20px', cursor: 'pointer', fontFamily: 'inherit', color: ACCENT, fontSize: 13,
          }}>← Try Again</button>
        </div>
        <TestMeStyles />
      </div>
    );
  }

  // ─── Full Question Workspace ─────────────────────────────────────────────────────────────
  const renderFullWorkspace = (p: Extract<TestPhase, { name: 'full_question_workspace' }>) => {
    const q = p.questions[p.idx];
    const mockQuestion = {
      id: `test_q_${p.idx}`,
      rawText: q.questionText,
      page: 1,
    };

    const handleGrade = async () => {
      setIsGrading(true);
      try {
        const canvases = document.querySelectorAll('.fsw-page canvas');
        const images: string[] = [];
        canvases.forEach(c => images.push((c as HTMLCanvasElement).toDataURL('image/jpeg', 0.8)));
        
        if (images.length === 0) {
          throw new Error("Couldn't capture handwriting.");
        }

        const apiKey = import.meta.env.VITE_GROQ_API_KEY;
        if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set');

        // We use llama-3.2-90b-vision-preview to read the canvas and grade it.
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'llama-3.2-90b-vision-preview',
            messages: [
              { 
                role: 'system', 
                content: `You are an expert math/physics grader. The student has provided a handwritten solution (see images). 
Question: ${q.questionText}
Correct Answer/Explanation: ${q.correctAnswer} ${q.explanation}

Grade the student's handwritten work out of 10. Give a very brief feedback (1-2 sentences) and the final score.
Return ONLY JSON: {"score": 8, "feedback": "Good attempt, but missing final unit."}`
              },
              { 
                role: 'user', 
                content: [
                  { type: 'text', text: 'Grade my work.' },
                  ...images.map(url => ({ type: 'image_url', image_url: { url } }))
                ] 
              }
            ],
            temperature: 0.2
          })
        });

        if (!res.ok) throw new Error('Vision API error');
        const data = await res.json();
        const content = data.choices[0]?.message?.content;
        const match = content.match(/\{[\s\S]*\}/) || [content];
        const result = JSON.parse(match[0]);
        
        const newQuestions = [...p.questions];
        newQuestions[p.idx] = { ...q, gradeScore: result.score, gradeText: result.feedback };
        setPhase({ ...p, questions: newQuestions });
      } catch (err: any) {
        alert("Grading failed: " + err.message);
      } finally {
        setIsGrading(false);
      }
    };

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 6000, background: '#0a0a14' }}>
        {/* TOP BAR */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6001, height: 52,
          padding: '0 20px', background: 'rgba(24,24,27,0.92)', backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7', background: 'rgba(168,85,247,0.15)', borderRadius: 8, padding: '5px 12px' }}>
              Question {p.idx + 1} of {p.questions.length}
            </div>
            {q.gradeScore !== undefined && (
              <span style={{ color: '#ef4444', fontWeight: 'bold' }}>Grade: {q.gradeScore}/10</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {q.gradeText ? (
              <button 
                onClick={() => setPhase({ name: 'full_question_review', questions: p.questions, idx: p.idx })} 
                style={{ background: 'linear-gradient(135deg, #10b981, #34d399)', color: 'white', fontWeight: 600, border: 'none', padding: '8px 20px', borderRadius: 10, cursor: 'pointer' }}
              >
                See Model Solution →
              </button>
            ) : (
              <button 
                onClick={handleGrade} 
                disabled={isGrading}
                style={{ background: 'linear-gradient(135deg, #10b981, #34d399)', color: 'white', fontWeight: 600, border: 'none', padding: '8px 20px', borderRadius: 10, cursor: isGrading ? 'not-allowed' : 'pointer', opacity: isGrading ? 0.7 : 1 }}
              >
                {isGrading ? 'Grading...' : '✅ Done'}
              </button>
            )}
          </div>
        </div>

        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, bottom: 0 }}>
          <FullScreenWorkspace
            isTestMode={true}
            showAiSwitch={!!q.gradeText}
            testGrade={q.gradeText}
            currentQuestion={mockQuestion as any}
            onClose={() => setPhase({ name: 'full_question_review', questions: p.questions, idx: p.idx })}
          />
        </div>
      </div>
    );
  };

  // ─── Full Question Review ─────────────────────────────────────────────────────────────
  const renderFullReview = (p: Extract<TestPhase, { name: 'full_question_review' }>) => {
    const q = p.questions[p.idx];
    const isLast = p.idx === p.questions.length - 1;

    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: '#0a0a14',
        display: 'flex', flexDirection: 'column',
        animation: 'testme-fade 0.2s ease',
      }}>
        {/* Top bar */}
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
            Review {p.idx + 1} of {p.questions.length}
          </div>
          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${((p.idx + 1) / p.questions.length) * 100}%`, height: '100%', background: ACCENT, borderRadius: 2, transition: '0.4s' }} />
          </div>
        </div>

        {/* Question body */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '40px 20px 20px' }}>
          <div style={{ width: '100%', maxWidth: 680 }}>
            {/* A4-style question card */}
            <div style={{
              background: '#fff', color: '#1e1e2e',
              borderRadius: 12, padding: '40px 48px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
              minHeight: 240,
              fontSize: 16, lineHeight: 1.8, fontFamily: 'Georgia, serif',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 20, fontFamily: 'sans-serif' }}>
                Test Question {p.idx + 1}
              </div>
              <div style={{ color: '#1e293b', fontSize: 16, lineHeight: 1.9 }}>
                <LatexMarkdown content={q.questionText} />
              </div>
            </div>

            {/* Answer & Explanation */}
            <div style={{
              marginTop: 20, background: '#10b98112',
              border: '1px solid #10b98130', borderRadius: 14, padding: '20px 24px',
              animation: 'testme-fade 0.3s ease',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Model Solution
              </div>
              <div style={{ fontSize: 15, color: '#a7f3d0', fontWeight: 600, marginBottom: 14, lineHeight: 1.5 }}>
                <LatexMarkdown content={q.correctAnswer} />
              </div>
              <div style={{ fontSize: 13, color: '#6ee7b7', lineHeight: 1.7 }}>
                <LatexMarkdown content={q.explanation} />
              </div>
            </div>

            <button
              onClick={() => {
                if (isLast) {
                  setPhase({ name: 'results_full', questions: p.questions });
                } else {
                  setPhase({ name: 'full_question_workspace', questions: p.questions, idx: p.idx + 1 });
                }
              }}
              style={{
                marginTop: 12, width: '100%',
                background: isLast ? 'rgba(239,68,68,0.12)' : `${ACCENT}20`,
                border: `1px solid ${isLast ? 'rgba(239,68,68,0.3)' : `${ACCENT}50`}`,
                borderRadius: 14, padding: '14px',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 700,
                color: isLast ? '#fca5a5' : ACCENT,
                transition: 'all 0.2s', animation: 'testme-fade 0.3s ease',
              }}
            >
              {isLast ? '🏁 See Final Results' : 'Next Question →'}
            </button>
          </div>
        </div>
        <TestMeStyles />
      </div>
    );
  };

  // ─── MCQ ──────────────────────────────────────────────────────────────────────
  const renderMCQ = (p: Extract<TestPhase, { name: 'mcq' }>) => {
    const q = p.questions[p.idx];
    const isLast = p.idx === p.questions.length - 1;
    const answered = p.selected !== null;
    const choiceLabels = ['A', 'B', 'C', 'D'];

    const handleSelect = (idx: number) => {
      if (answered) return;
      const isCorrect = idx === q.correctIdx;
      setPhase({ ...p, selected: idx, correct: [...p.correct, isCorrect] });
    };

    const handleNext = () => {
      if (isLast) {
        setPhase({ name: 'results_mcq', questions: p.questions, correct: p.correct });
      } else {
        setPhase({ ...p, idx: p.idx + 1, selected: null });
      }
    };

    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: '#0a0a14',
        display: 'flex', flexDirection: 'column',
        animation: 'testme-fade 0.2s ease',
      }}>
        {/* Top bar */}
        <div style={{
          padding: '14px 20px', background: '#12121e',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#a78bfa',
            background: '#a78bfa15', border: '1px solid #a78bfa30',
            borderRadius: 8, padding: '5px 12px',
          }}>
            Q {p.idx + 1} / {p.questions.length}
          </div>
          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${((p.idx) / p.questions.length) * 100}%`, height: '100%', background: '#a78bfa', borderRadius: 2, transition: '0.4s' }} />
          </div>
          <button
            onClick={() => setPhase({ name: 'results_mcq', questions: p.questions, correct: p.correct })}
            style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
              fontFamily: 'inherit', color: '#fca5a5', fontSize: 12,
            }}
          >
            Finish Test
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '36px 20px 20px' }}>
          <div style={{ width: '100%', maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Question */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '24px 28px',
            }}>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                Multiple Choice
              </div>
              <div style={{ fontSize: 16, color: '#e2e8f0', lineHeight: 1.8 }}>
                <LatexMarkdown content={q.questionText} />
              </div>
            </div>

            {/* Choices */}
            {q.displayChoices.map((choice, idx) => {
              let state: 'default' | 'correct' | 'wrong' | 'revealed-correct' = 'default';
              if (answered) {
                if (idx === q.correctIdx) state = 'correct';
                else if (idx === p.selected && idx !== q.correctIdx) state = 'wrong';
              }
              return (
                <ChoiceButton
                  key={idx}
                  label={choiceLabels[idx]}
                  text={choice}
                  onClick={() => handleSelect(idx)}
                  state={state}
                />
              );
            })}

            {/* Feedback + explanation */}
            {answered && (
              <div style={{
                background: p.selected === q.correctIdx ? '#10b98112' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${p.selected === q.correctIdx ? '#10b98130' : 'rgba(239,68,68,0.2)'}`,
                borderRadius: 12, padding: '16px 20px',
                animation: 'testme-fade 0.3s ease',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: p.selected === q.correctIdx ? '#10b981' : '#fca5a5' }}>
                  {p.selected === q.correctIdx ? '✅ Correct!' : `❌ Incorrect — Correct: ${q.displayChoices[q.correctIdx]}`}
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7 }}>
                  <LatexMarkdown content={q.explanation} />
                </div>
              </div>
            )}

            {answered && (
              <button
                onClick={handleNext}
                style={{
                  background: isLast ? 'rgba(239,68,68,0.12)' : '#a78bfa20',
                  border: `1px solid ${isLast ? 'rgba(239,68,68,0.3)' : '#a78bfa50'}`,
                  borderRadius: 14, padding: '14px',
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700,
                  color: isLast ? '#fca5a5' : '#a78bfa',
                  transition: 'all 0.2s', animation: 'testme-fade 0.3s ease',
                  width: '100%',
                }}
              >
                {isLast ? '🏁 See Final Results' : 'Next Question →'}
              </button>
            )}
          </div>
        </div>
        <TestMeStyles />
      </div>
    );
  };

  // ─── Results Full ──────────────────────────────────────────────────────────────
  const renderResultsFull = (p: Extract<TestPhase, { name: 'results_full' }>) => (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000,
      background: '#0a0a14',
      display: 'flex', flexDirection: 'column',
      animation: 'testme-fade 0.2s ease',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '40px 20px 40px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏁</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', marginBottom: 6 }}>Test Complete!</div>
            <div style={{ fontSize: 14, color: '#94a3b8' }}>
              You completed {p.questions.length} question{p.questions.length !== 1 ? 's' : ''}. Review the answers below.
            </div>
          </div>

          {/* Question review */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {p.questions.map((q, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, overflow: 'hidden',
              }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
                    Question {i + 1}
                  </div>
                  <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.7 }}>{q.questionText}</div>
                </div>
                <div style={{ padding: '14px 20px', background: '#10b98108' }}>
                  <div style={{ fontSize: 11, color: '#10b981', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                    ✓ Correct Answer
                  </div>
                  <div style={{ fontSize: 13, color: '#a7f3d0', fontWeight: 600, marginBottom: 10, lineHeight: 1.5 }}>
                    {q.correctAnswer}
                  </div>
                  <div style={{ fontSize: 12, color: '#6ee7b7', lineHeight: 1.7 }}>{q.explanation}</div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleClose}
            style={{
              marginTop: 28, width: '100%',
              background: `${ACCENT}15`, border: `1px solid ${ACCENT}40`,
              borderRadius: 14, padding: '16px',
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 15, fontWeight: 700, color: ACCENT,
            }}
          >
            ← Back to Program
          </button>
        </div>
      </div>
      <TestMeStyles />
    </div>
  );

  // ─── Results MCQ ──────────────────────────────────────────────────────────────
  const renderResultsMcq = (p: Extract<TestPhase, { name: 'results_mcq' }>) => {
    const score = p.correct.filter(Boolean).length;
    const total = p.questions.length;
    const pct = Math.round((score / total) * 100);
    const grade = pct >= 90 ? '🌟 Excellent!' : pct >= 70 ? '✅ Good job!' : pct >= 50 ? '📈 Keep practising' : '💪 More review needed';

    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: '#0a0a14',
        display: 'flex', flexDirection: 'column',
        animation: 'testme-fade 0.2s ease',
      }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '40px 20px 40px' }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            {/* Score header */}
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{pct >= 70 ? '🎉' : pct >= 50 ? '📊' : '💪'}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', marginBottom: 4 }}>{grade}</div>
              <div style={{
                fontSize: 48, fontWeight: 900, marginBottom: 6,
                color: pct >= 70 ? '#10b981' : pct >= 50 ? ACCENT : '#ef4444',
              }}>
                {score}/{total}
              </div>
              <div style={{ fontSize: 14, color: '#94a3b8' }}>{pct}% correct</div>
            </div>

            {/* Score bar */}
            <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden', marginBottom: 28 }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 4,
                background: pct >= 70 ? '#10b981' : pct >= 50 ? ACCENT : '#ef4444',
                transition: '0.8s ease',
              }} />
            </div>

            {/* Per-question breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {p.questions.map((q, i) => (
                <div key={i} style={{
                  background: p.correct[i] ? '#10b98108' : 'rgba(239,68,68,0.06)',
                  border: `1px solid ${p.correct[i] ? '#10b98125' : 'rgba(239,68,68,0.15)'}`,
                  borderRadius: 12, padding: '14px 18px',
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{p.correct[i] ? '✅' : '❌'}</span>
                  <div>
                    <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, marginBottom: 4 }}>
                      {q.questionText.length > 100 ? q.questionText.slice(0, 100) + '...' : q.questionText}
                    </div>
                    {!p.correct[i] && (
                      <div style={{ fontSize: 12, color: '#10b981' }}>
                        Correct: {q.displayChoices[q.correctIdx]}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleClose}
              style={{
                width: '100%',
                background: `${ACCENT}15`, border: `1px solid ${ACCENT}40`,
                borderRadius: 14, padding: '16px',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 15, fontWeight: 700, color: ACCENT,
              }}
            >
              ← Back to Program
            </button>
          </div>
        </div>
        <TestMeStyles />
      </div>
    );
  };

  // ─── Router ───────────────────────────────────────────────────────────────────
  if (phase.name === 'picking') return renderPicking();
  if (phase.name === 'generating') return renderGenerating();
  if (phase.name === 'full_question_workspace') return renderFullWorkspace(phase);
  if (phase.name === 'full_question_review') return renderFullReview(phase);
  if (phase.name === 'mcq') return renderMCQ(phase);
  if (phase.name === 'results_full') return renderResultsFull(phase);
  if (phase.name === 'results_mcq') return renderResultsMcq(phase);
  return null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function TestMeStyles() {
  return (
    <style>{`
      @keyframes testme-spin { to { transform: rotate(360deg) } }
      @keyframes testme-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes testme-up {
        from { opacity: 0; transform: translateY(20px) scale(0.97) }
        to { opacity: 1; transform: translateY(0) scale(1) }
      }
    `}</style>
  );
}
