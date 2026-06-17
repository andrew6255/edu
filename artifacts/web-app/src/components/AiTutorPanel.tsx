/**
 * AiTutorPanel — Bottom collapsible AI assistant panel
 *
 * 3 Modes:
 *   correct_me  — Analyzes student's handwritten work and lists corrections inline
 *   plan        — Shows a step-by-step plan checklist the student follows freely
 *   solve       — Shows the full worked solution with per-step expand + explain
 *
 * Pre-loads a full question analysis (plan + fullSolution + scoringScheme) in one
 * LLM call the moment the panel opens, so all 3 modes feel instant.
 */

import { useState, useCallback, useEffect } from 'react';
import katex from 'katex';
import type { PersonalProgramQuestion } from '@/lib/personalProgramService';

/* ─────────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────────── */

interface ConvertedBlock {
  id: string; text: string; latex: string;
  x: number; y: number; width: number; height: number; fontSize: number;
}

interface PageData { id: string; strokes: any[]; annotations: any[]; }

interface SolutionStep {
  title: string; body: string;
  expanded?: boolean;
  explanation?: string;
  loadingExplanation?: boolean;
}

interface Correction {
  label: string; wrongText: string; correctedText: string;
  briefNote: string; explanation: string;
  expanded?: boolean;
}

interface RubricItem { criterion: string; points: number; }

interface QuestionAnalysis {
  plan: string[];
  fullSolution: SolutionStep[];
  scoringScheme: { totalPoints: number; rubric: RubricItem[] };
}

interface GradingResult {
  totalScore: number; totalPoints: number;
  breakdown: Array<{ criterion: string; earned: number; max: number; comment: string }>;
  overallFeedback: string;
}

type AiMode = 'correct_me' | 'plan' | 'solve';

export interface AiTutorPanelProps {
  currentQuestion: PersonalProgramQuestion | string | undefined;
  pages: PageData[];
  fetchMyScriptBlocks: (strokes: any[]) => Promise<ConvertedBlock[]>;
  hasStrokes: boolean;
  isOpen: boolean;
  onClose: () => void;
}

/* ─────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────── */

function LatexRenderer({ content, display = false }: { content: string; display?: boolean }) {
  // Normalise all 4 delimiter styles into a single pass:
  //  $$...$$  \[...\]   →  display mode
  //  $...$    \(...\)   →  inline mode
  const normalised = content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, math) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, math) => `$${math}$`);

  const parts = normalised.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);

  return (
    <span style={{ lineHeight: 1.75 }}>
      {parts.map((part, i) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const math = part.slice(2, -2).trim();
          try {
            return (
              <span
                key={i}
                style={{ display: 'block', textAlign: 'center', margin: '6px 0' }}
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(math, { displayMode: true, throwOnError: false }),
                }}
              />
            );
          } catch { return <span key={i}>{part}</span>; }
        }
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          const math = part.slice(1, -1).trim();
          try {
            return (
              <span
                key={i}
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(math, { displayMode: false, throwOnError: false }),
                }}
              />
            );
          } catch { return <span key={i}>{part}</span>; }
        }
        // Plain text — preserve newlines
        return (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
        );
      })}
    </span>
  );
}

async function callGroq(messages: Array<{ role: string; content: string }>, maxTokens = 600): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY not found in .env.local');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.2, max_tokens: maxTokens }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices[0].message.content;
}

function parseJSON(text: string): any {
  return JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
}

/* ─────────────────────────────────────────────────────────────────
   Spinner component
───────────────────────────────────────────────────────────────── */

function Spin({ color = '#8b5cf6', size = 12 }: { color?: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, border: `2px solid ${color}`,
      borderTopColor: 'transparent', borderRadius: '50%',
      display: 'inline-block', animation: 'ai-spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  );
}

/* ─────────────────────────────────────────────────────────────────
   Main Component
───────────────────────────────────────────────────────────────── */

export default function AiTutorPanel({
  currentQuestion, pages, fetchMyScriptBlocks, hasStrokes, isOpen, onClose,
}: AiTutorPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeMode, setActiveMode] = useState<AiMode>('plan');

  // Pre-loaded analysis
  const [analysis, setAnalysis] = useState<QuestionAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisQuestionKey, setAnalysisQuestionKey] = useState<string>('');

  // Plan mode
  const [planChecked, setPlanChecked] = useState<boolean[]>([]);

  // Solve mode
  const [solutionSteps, setSolutionSteps] = useState<SolutionStep[]>([]);

  // Correct Me mode
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loadingCorrections, setLoadingCorrections] = useState(false);
  const [correctionsError, setCorrectionsError] = useState<string | null>(null);
  const [noMistakesFound, setNoMistakesFound] = useState(false);

  // Grade
  const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [showGradeModal, setShowGradeModal] = useState(false);

  // ── Pre-load analysis when panel opens or question changes ──
  const questionText = typeof currentQuestion === 'string'
    ? currentQuestion
    : (currentQuestion as PersonalProgramQuestion)?.rawText || '';

  useEffect(() => {
    if (!isOpen || !questionText) return;
    // Don't re-fetch if we already have analysis for this question
    if (analysisQuestionKey === questionText && analysis) return;

    setLoadingAnalysis(true);
    setAnalysisError(null);
    setAnalysis(null);
    setAnalysisQuestionKey(questionText);

    callGroq([
      {
        role: 'system',
        content: `You are an expert math tutor. Given a math question, return a single JSON object with exactly these fields:
{
  "plan": ["step 1 description", "step 2 description"],
  "fullSolution": [
    { "title": "Step 1: Find the derivative", "body": "Using the power rule, $f'(x) = 2x$." }
  ],
  "scoringScheme": {
    "totalPoints": 10,
    "rubric": [
      { "criterion": "Correct setup", "points": 3 },
      { "criterion": "Correct computation", "points": 4 },
      { "criterion": "Correct final answer", "points": 3 }
    ]
  }
}
Keep plan to 3-6 concise steps. Keep solution steps clear and focused.
CRITICAL: Double-escape all LaTeX backslashes. Output ONLY the raw JSON object, no markdown fences.`,
      },
      { role: 'user', content: `Question: ${questionText}` },
    ], 1400)
      .then(text => {
        const parsed = parseJSON(text) as QuestionAnalysis;
        setAnalysis(parsed);
        setPlanChecked(new Array(parsed.plan.length).fill(false));
        setSolutionSteps(parsed.fullSolution.map(s => ({ ...s, expanded: false })));
      })
      .catch(err => setAnalysisError(err.message))
      .finally(() => setLoadingAnalysis(false));
  }, [isOpen, questionText]);

  // ── Collect student work as text ──
  const getStudentWork = useCallback(async (): Promise<string> => {
    const parts: string[] = [];
    for (const page of pages) {
      if (page.strokes.length === 0 && page.annotations.length === 0) continue;
      const blocks = await fetchMyScriptBlocks(page.strokes);
      blocks.sort((a: ConvertedBlock, b: ConvertedBlock) => a.y - b.y);
      const inkText = blocks.map((b: ConvertedBlock) => b.latex || b.text).filter(Boolean).join('\n');
      const annText = page.annotations.filter((a: any) => a.text).map((a: any) => a.text).join('\n');
      if (inkText || annText) parts.push([inkText, annText].filter(Boolean).join('\n'));
    }
    return parts.join('\n\n');
  }, [pages, fetchMyScriptBlocks]);

  // ── Correct Me ──
  const handleCorrectMe = useCallback(async () => {
    setLoadingCorrections(true);
    setCorrectionsError(null);
    setCorrections([]);
    setNoMistakesFound(false);

    try {
      const studentWork = await getStudentWork();
      if (!studentWork.trim()) {
        setCorrectionsError('Please write something on the whiteboard first.');
        return;
      }

      const fullSolutionText = analysis?.fullSolution
        .map((s, i) => `Step ${i + 1} — ${s.title}: ${s.body}`).join('\n') || '';

      const raw = await callGroq([
        {
          role: 'system',
          content: `You are a math teacher reviewing a student's work. Identify mistakes and return ONLY a JSON object:
{
  "corrections": [
    {
      "label": "brief label like 'sign mistake', 'wrong formula', 'calculation error', 'wrong technique', 'irrelevant step'",
      "wrongText": "the exact snippet the student wrote that is wrong",
      "correctedText": "the corrected version",
      "briefNote": "one concise sentence naming the error",
      "explanation": "detailed explanation of why this is wrong and the correct approach"
    }
  ]
}
If the student's work is fully correct, return { "corrections": [] }.
CRITICAL: Double-escape LaTeX backslashes. Output ONLY raw JSON.`,
        },
        {
          role: 'user',
          content: `Question: ${questionText}\n\nReference solution:\n${fullSolutionText}\n\nStudent's work:\n${studentWork}`,
        },
      ], 900);

      const parsed = parseJSON(raw);
      if (!parsed.corrections?.length) {
        setNoMistakesFound(true);
      } else {
        setCorrections(parsed.corrections.map((c: any) => ({ ...c, expanded: false })));
      }
    } catch (err) {
      setCorrectionsError(err instanceof Error ? err.message : 'Failed to analyze work');
    } finally {
      setLoadingCorrections(false);
    }
  }, [questionText, analysis, getStudentWork]);

  // ── Toggle correction explanation ──
  const handleToggleCorrection = useCallback((idx: number) => {
    setCorrections(prev => prev.map((c, i) => i === idx ? { ...c, expanded: !c.expanded } : c));
  }, []);

  // ── Expand/collapse solution step ──
  const handleToggleSolutionStep = useCallback((idx: number) => {
    setSolutionSteps(prev => prev.map((s, i) => i === idx ? { ...s, expanded: !s.expanded } : s));
  }, []);

  // ── Explain a solution step ──
  const handleExplainStep = useCallback(async (idx: number) => {
    const step = solutionSteps[idx];
    if (!step || step.loadingExplanation) return;
    setSolutionSteps(prev => prev.map((s, i) => i === idx ? { ...s, loadingExplanation: true, expanded: true } : s));
    try {
      const explanation = await callGroq([
        { role: 'system', content: 'You are an expert math tutor. Explain a specific solution step clearly and thoroughly in 3–5 sentences. Use LaTeX for math. Double-escape backslashes.' },
        { role: 'user', content: `Question: ${questionText}\n\nExplain this step:\n${step.title}\n${step.body}` },
      ], 350);
      setSolutionSteps(prev => prev.map((s, i) => i === idx ? { ...s, explanation, loadingExplanation: false } : s));
    } catch {
      setSolutionSteps(prev => prev.map((s, i) => i === idx ? { ...s, loadingExplanation: false } : s));
    }
  }, [solutionSteps, questionText]);

  // ── Grade ──
  const handleGrade = useCallback(async () => {
    setIsGrading(true);
    try {
      const studentWork = await getStudentWork();
      const rubricText = analysis?.scoringScheme.rubric
        .map(r => `- ${r.criterion}: ${r.points} pts`).join('\n')
        || `- Complete correct answer: ${analysis?.scoringScheme.totalPoints ?? 10} pts`;
      const totalPts = analysis?.scoringScheme.totalPoints ?? 10;

      const raw = await callGroq([
        {
          role: 'system',
          content: `You are a strict math professor. Grade the student's work using the rubric. Return ONLY a JSON object:
{
  "totalScore": N,
  "totalPoints": N,
  "breakdown": [
    { "criterion": "...", "earned": N, "max": N, "comment": "brief comment" }
  ],
  "overallFeedback": "overall feedback string with LaTeX if needed"
}
CRITICAL: Double-escape LaTeX backslashes. Output ONLY raw JSON.`,
        },
        {
          role: 'user',
          content: `Question: ${questionText}\n\nRubric (total ${totalPts} pts):\n${rubricText}\n\nStudent's work:\n${studentWork || '(nothing written yet)'}`,
        },
      ], 700);

      const parsed = parseJSON(raw);
      setGradingResult(parsed);
      setShowGradeModal(true);
    } catch (err) {
      console.error('Grading failed:', err);
      alert('Grading failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsGrading(false);
    }
  }, [questionText, analysis, getStudentWork]);

  if (!isOpen) return null;

  const COLLAPSED_H = 56;
  const EXPANDED_H = 370;
  const panelH = expanded ? EXPANDED_H : COLLAPSED_H;
  const scoreColor = (gr: GradingResult) =>
    gr.totalScore / gr.totalPoints >= 0.7 ? '#10b981' : '#ef4444';

  return (
    <>
      <style>{`
        @keyframes ai-spin { to { transform: rotate(360deg); } }
        .ai-panel-body::-webkit-scrollbar { width: 6px; }
        .ai-panel-body::-webkit-scrollbar-track { background: transparent; }
        .ai-panel-body::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 3px; }
      `}</style>

      {/* ─── Panel ─── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: panelH,
        background: 'rgba(10, 10, 22, 0.97)',
        backdropFilter: 'blur(16px)',
        borderTop: '1.5px solid rgba(139,92,246,0.35)',
        boxShadow: '0 -12px 48px rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex', flexDirection: 'column',
        transition: 'height 0.32s cubic-bezier(0.4,0,0.2,1)',
        fontFamily: 'inherit',
        color: 'var(--ll-text)',
      }}>

        {/* ── Header ── */}
        <div style={{
          height: COLLAPSED_H, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 14px',
          borderBottom: expanded ? '1px solid rgba(139,92,246,0.18)' : 'none',
        }}>
          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', color: '#8b5cf6', cursor: 'pointer', fontSize: 16, padding: 4, lineHeight: 1, flexShrink: 0 }}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▼' : '▲'}
          </button>

          <span style={{ color: '#a78bfa', fontWeight: 800, fontSize: 13, letterSpacing: '-0.01em', flexShrink: 0 }}>
            🤖 AI Tutor
          </span>

          {/* Mode tabs */}
          {(['correct_me', 'plan', 'solve'] as AiMode[]).map(mode => {
            const labels: Record<AiMode, string> = { correct_me: '🔍 Correct Me', plan: '📋 Plan', solve: '💡 Solve' };
            const isActive = activeMode === mode;
            return (
              <button
                key={mode}
                onClick={() => { setActiveMode(mode); setExpanded(true); }}
                style={{
                  padding: '5px 13px', borderRadius: 20,
                  border: `1.5px solid ${isActive ? '#8b5cf6' : 'rgba(139,92,246,0.2)'}`,
                  background: isActive ? 'rgba(139,92,246,0.22)' : 'transparent',
                  color: isActive ? '#c4b5fd' : 'rgba(255,255,255,0.4)',
                  fontSize: 12, fontWeight: isActive ? 700 : 400,
                  cursor: 'pointer', transition: 'all 0.18s',
                  fontFamily: 'inherit', flexShrink: 0,
                }}
              >
                {labels[mode]}
              </button>
            );
          })}

          <div style={{ flex: 1 }} />

          {/* Analysis loading badge */}
          {loadingAnalysis && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#8b5cf6', fontSize: 11, flexShrink: 0 }}>
              <Spin size={10} />
              Analyzing…
            </span>
          )}

          {/* Grade button */}
          <button
            onClick={handleGrade}
            disabled={isGrading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20,
              border: '1.5px solid rgba(251,191,36,0.4)',
              background: 'rgba(251,191,36,0.1)',
              color: '#fbbf24', fontSize: 12, fontWeight: 700,
              cursor: isGrading ? 'not-allowed' : 'pointer',
              opacity: isGrading ? 0.7 : 1,
              transition: 'all 0.18s', fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            {isGrading ? <><Spin color="#fbbf24" size={10} /> Grading…</> : '📊 Grade'}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1, flexShrink: 0 }}
          >✕</button>
        </div>

        {/* ── Body ── */}
        {expanded && (
          <div className="ai-panel-body" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

            {/* Global loading */}
            {loadingAnalysis && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100, gap: 10, color: '#8b5cf6' }}>
                <Spin size={16} />
                <span style={{ fontSize: 13 }}>Analyzing question…</span>
              </div>
            )}

            {/* Global error */}
            {!loadingAnalysis && analysisError && (
              <div style={{ color: '#ef4444', fontSize: 12, padding: '10px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, marginBottom: 12 }}>
                ⚠️ Failed to load analysis: {analysisError}
              </div>
            )}

            {/* ────── MODE: CORRECT ME ────── */}
            {activeMode === 'correct_me' && !loadingAnalysis && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={handleCorrectMe}
                    disabled={loadingCorrections || !hasStrokes}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 18px', borderRadius: 20, border: 'none',
                      background: (loadingCorrections || !hasStrokes)
                        ? 'rgba(139,92,246,0.15)'
                        : 'linear-gradient(135deg,#8b5cf6,#6366f1)',
                      color: 'white', fontSize: 13, fontWeight: 700,
                      cursor: (loadingCorrections || !hasStrokes) ? 'not-allowed' : 'pointer',
                      opacity: !hasStrokes ? 0.55 : 1,
                      fontFamily: 'inherit', transition: 'opacity 0.2s',
                    }}
                  >
                    {loadingCorrections ? <><Spin color="white" /> Analyzing…</> : '🔍 Correct Me'}
                  </button>
                  {!hasStrokes && (
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Write on the whiteboard first</span>
                  )}
                </div>

                {correctionsError && (
                  <div style={{ color: '#ef4444', fontSize: 12, padding: '10px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>
                    {correctionsError}
                  </div>
                )}

                {noMistakesFound && (
                  <div style={{ color: '#10b981', fontSize: 13, padding: '12px 14px', background: 'rgba(16,185,129,0.1)', borderRadius: 10, fontWeight: 600, border: '1px solid rgba(16,185,129,0.3)' }}>
                    ✅ No mistakes found! Your work looks correct.
                  </div>
                )}

                {corrections.map((c, idx) => (
                  <div key={idx} style={{
                    background: 'rgba(239,68,68,0.07)',
                    border: '1px solid rgba(239,68,68,0.22)',
                    borderRadius: 10, padding: 12,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    {/* Top row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                        background: 'rgba(239,68,68,0.2)', color: '#fca5a5',
                        whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1,
                      }}>
                        {c.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: '#fca5a5', textDecoration: 'line-through', marginRight: 6 }}>
                            <LatexRenderer content={c.wrongText} />
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: 6 }}>→</span>
                          <span style={{ color: '#6ee7b7' }}>
                            <LatexRenderer content={c.correctedText} />
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                          <LatexRenderer content={c.briefNote} />
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggleCorrection(idx)}
                        style={{
                          fontSize: 11, padding: '3px 10px', borderRadius: 12,
                          border: '1px solid rgba(139,92,246,0.35)',
                          background: c.expanded ? 'rgba(139,92,246,0.18)' : 'transparent',
                          color: '#c4b5fd', cursor: 'pointer', whiteSpace: 'nowrap',
                          fontFamily: 'inherit', flexShrink: 0,
                        }}
                      >
                        {c.expanded ? 'Less' : 'Explain'}
                      </button>
                    </div>
                    {/* Explanation */}
                    {c.expanded && (
                      <div style={{
                        fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 1.65,
                        padding: '10px 12px', background: 'rgba(139,92,246,0.09)',
                        borderRadius: 8, borderLeft: '3px solid #8b5cf6',
                      }}>
                        <LatexRenderer content={c.explanation} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ────── MODE: PLAN ────── */}
            {activeMode === 'plan' && !loadingAnalysis && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {!analysis?.plan.length && !analysisError && (
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>No plan available.</span>
                )}
                {analysis?.plan.map((step, idx) => {
                  const checked = planChecked[idx] ?? false;
                  return (
                    <div
                      key={idx}
                      onClick={() => setPlanChecked(prev => prev.map((c, i) => i === idx ? !c : c))}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        background: checked ? 'rgba(16,185,129,0.08)' : 'rgba(139,92,246,0.06)',
                        border: `1px solid ${checked ? 'rgba(16,185,129,0.25)' : 'rgba(139,92,246,0.15)'}`,
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        border: `2px solid ${checked ? '#10b981' : '#8b5cf6'}`,
                        background: checked ? '#10b981' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s',
                      }}>
                        {checked && <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 11, color: '#8b5cf6', fontWeight: 700, marginRight: 8 }}>
                          Step {idx + 1}
                        </span>
                        <span style={{
                          fontSize: 13,
                          color: checked ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)',
                          textDecoration: checked ? 'line-through' : 'none',
                          transition: 'all 0.2s',
                        }}>
                          <LatexRenderer content={step} />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ────── MODE: SOLVE ────── */}
            {activeMode === 'solve' && !loadingAnalysis && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {!solutionSteps.length && !analysisError && (
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>No solution available.</span>
                )}
                {solutionSteps.map((step, idx) => (
                  <div key={idx} style={{
                    background: 'rgba(59,130,246,0.06)',
                    border: '1px solid rgba(59,130,246,0.18)',
                    borderRadius: 10, overflow: 'hidden',
                  }}>
                    {/* Step header — click to expand/collapse */}
                    <div
                      onClick={() => handleToggleSolutionStep(idx)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}
                    >
                      <span style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0,
                      }}>{idx + 1}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
                        <LatexRenderer content={step.title} />
                      </span>
                      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                        {step.expanded ? '▲' : '▼'}
                      </span>
                    </div>

                    {step.expanded && (
                      <div style={{ padding: '4px 12px 12px 46px' }}>
                        {/* Solution body */}
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.7, marginBottom: 10 }}>
                          <LatexRenderer content={step.body} />
                        </div>

                        {/* Explanation (if fetched) */}
                        {step.explanation && (
                          <div style={{
                            fontSize: 12, color: '#93c5fd', lineHeight: 1.65,
                            padding: '10px 12px', background: 'rgba(59,130,246,0.1)',
                            borderRadius: 8, borderLeft: '3px solid #3b82f6', marginBottom: 10,
                          }}>
                            <LatexRenderer content={step.explanation} />
                          </div>
                        )}

                        {/* Explain button */}
                        <button
                          onClick={e => { e.stopPropagation(); handleExplainStep(idx); }}
                          disabled={step.loadingExplanation}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: 11, padding: '4px 12px', borderRadius: 12,
                            border: '1px solid rgba(59,130,246,0.35)',
                            background: 'transparent', color: '#93c5fd',
                            cursor: step.loadingExplanation ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          {step.loadingExplanation
                            ? <><Spin color="#93c5fd" size={10} /> Explaining…</>
                            : step.explanation ? '🔄 Re-explain' : '💬 Explain this step'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Grading Modal ─── */}
      {showGradeModal && gradingResult && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => setShowGradeModal(false)}
        >
          <div
            style={{
              width: 'min(520px, 96vw)', background: 'var(--ll-surface-0)',
              borderRadius: 20, border: '2px solid rgba(251,191,36,0.3)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
              padding: '28px', color: 'var(--ll-text)',
              maxHeight: '82vh', overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📊 Grading Results</h2>
              <button onClick={() => setShowGradeModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--ll-text-muted)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>

            {/* Big score */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px', marginBottom: 20,
              background: `${scoreColor(gradingResult)}18`,
              border: `1px solid ${scoreColor(gradingResult)}44`,
              borderRadius: 16,
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 52, fontWeight: 900, color: scoreColor(gradingResult) }}>
                  {gradingResult.totalScore}
                  <span style={{ fontSize: 24, color: 'var(--ll-text-muted)', fontWeight: 400 }}>
                    /{gradingResult.totalPoints}
                  </span>
                </div>
                <div style={{ fontSize: 14, color: 'var(--ll-text-muted)', marginTop: 4 }}>
                  {Math.round((gradingResult.totalScore / gradingResult.totalPoints) * 100)}%
                </div>
              </div>
            </div>

            {/* Rubric breakdown */}
            {gradingResult.breakdown.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ll-text-muted)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Rubric Breakdown
                </div>
                {gradingResult.breakdown.map((item, i) => {
                  const full = item.earned === item.max;
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: full ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                      border: `1px solid ${full ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)'}`,
                    }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: full ? '#10b981' : '#ef4444', minWidth: 36, flexShrink: 0 }}>
                        {item.earned}/{item.max}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                          <LatexRenderer content={item.criterion} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ll-text-muted)' }}>
                          <LatexRenderer content={item.comment} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Overall feedback */}
            {gradingResult.overallFeedback && (
              <div style={{
                fontSize: 13, lineHeight: 1.7,
                padding: '12px 14px', background: 'rgba(139,92,246,0.08)',
                borderRadius: 10, borderLeft: '3px solid #8b5cf6',
              }}>
                <LatexRenderer content={gradingResult.overallFeedback} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
