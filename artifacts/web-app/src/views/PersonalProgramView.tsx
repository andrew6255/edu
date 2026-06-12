/**
 * PersonalProgramView
 *
 * Two screens:
 * 1. Table of Contents — chapters/categories with question cards
 * 2. Question Whiteboard — FullScreenWorkspace with the question displayed
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  type PersonalProgramMeta,
  type PersonalProgramData,
  type PersonalProgramQuestion,
  type WhiteboardPageData,
  refreshPersonalProgramStatus,
  loadQuestionWhiteboard,
  saveQuestionWhiteboard,
  getAnsweredQuestionIds,
} from '@/lib/personalProgramService';
import { getUserDoc } from '@/lib/supabaseDocStore';
import { getProgramProgress, toggleQuestionSolved } from '@/lib/programProgress';
import FullScreenWorkspace from '@/components/FullScreenWorkspace';

interface Props {
  programId: string | null;
  onBack: () => void;
}

export default function PersonalProgramView({ programId, onBack }: Props) {
  const { user } = useAuth();
  const [meta, setMeta] = useState<PersonalProgramMeta | null>(null);
  const [programData, setProgramData] = useState<PersonalProgramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageData[] | null>(null);
  const [loadingWhiteboard, setLoadingWhiteboard] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load program metadata and data
  useEffect(() => {
    if (!user || !programId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Get meta from user_docs
        const doc = await getUserDoc(user!.uid, 'personal_programs', programId!);
        if (!doc) {
          setError('Program not found.');
          setLoading(false);
          return;
        }
        const m = doc as unknown as PersonalProgramMeta;
        setMeta(m);

        if (m.status === 'processing') {
          // Polling will handle updates
        } else if (m.programData) {
          setProgramData(m.programData);
        }

        // Load answered question IDs from both whiteboard and manual progress
        const whiteboardAnswered = await getAnsweredQuestionIds(user!.uid, programId!);
        const progressDoc = await getProgramProgress(user!.uid, programId!);
        
        const combined = new Set<string>(whiteboardAnswered);
        if (progressDoc && progressDoc.solvedQuestionIds) {
          for (const id of progressDoc.solvedQuestionIds) combined.add(id);
        }
        if (!cancelled) setAnsweredIds(combined);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load program.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Setup polling if we are in processing state
    let pollInterval: ReturnType<typeof setInterval>;
    const startPolling = () => {
      pollInterval = setInterval(async () => {
        if (cancelled) return;
        try {
          const refreshed = await refreshPersonalProgramStatus(user!.uid, programId!);
          if (cancelled) return;
          setMeta(refreshed);
          if (refreshed.status !== 'processing') {
            clearInterval(pollInterval);
            if (refreshed.programData) setProgramData(refreshed.programData);
          }
        } catch (err) {
          console.warn("Polling failed", err);
        }
      }, 3000);
    };

    startPolling();

    return () => { 
      cancelled = true; 
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [user, programId]);

  // Open question whiteboard
  const openQuestion = useCallback(async (questionId: string) => {
    if (!user || !programId) return;
    setActiveQuestionId(questionId);
    setLoadingWhiteboard(true);
    try {
      const pages = await loadQuestionWhiteboard(user.uid, programId, questionId);
      setWhiteboardPages(pages);
    } catch {
      setWhiteboardPages(null);
    } finally {
      setLoadingWhiteboard(false);
    }
  }, [user, programId]);

  // Auto-save whiteboard
  const handleWhiteboardPagesChange = useCallback((pages: any[]) => {
    if (!user || !programId || !activeQuestionId) return;
    // Debounce save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveQuestionWhiteboard(user.uid, programId, activeQuestionId, pages as WhiteboardPageData[])
        .catch(err => console.warn('Auto-save whiteboard failed:', err));
    }, 1500);
  }, [user, programId, activeQuestionId]);

  // Close whiteboard and save
  const closeWhiteboard = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    // Note: We don't automatically mark as answered here anymore, 
    // we let the user manually check the box or we rely on the whiteboard stroke detection on reload.
    setActiveQuestionId(null);
    setWhiteboardPages(null);
  }, []);

  const handleToggleSolved = async (e: React.MouseEvent, questionId: string) => {
    e.stopPropagation();
    if (!user || !programId) return;
    try {
      const isSolved = await toggleQuestionSolved(user.uid, programId, questionId);
      setAnsweredIds(prev => {
        const next = new Set(prev);
        if (isSolved) next.add(questionId);
        else next.delete(questionId);
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Navigate to next/previous question
  const allQuestions = programData?.questions ?? [];
  const currentQuestionIndex = allQuestions.findIndex(q => q.id === activeQuestionId);

  const goToQuestion = useCallback((direction: 'next' | 'prev') => {
    if (!allQuestions.length) return;
    const nextIdx = direction === 'next'
      ? Math.min(currentQuestionIndex + 1, allQuestions.length - 1)
      : Math.max(currentQuestionIndex - 1, 0);
    if (nextIdx !== currentQuestionIndex) {
      closeWhiteboard().then(() => openQuestion(allQuestions[nextIdx].id));
    }
  }, [allQuestions, currentQuestionIndex, closeWhiteboard, openQuestion]);

  // Find the active question
  const activeQuestion = allQuestions.find(q => q.id === activeQuestionId);

  // ─── Whiteboard Screen ────────────────────────────────────────────────────────
  if (activeQuestionId && activeQuestion) {
    const questionText = activeQuestion.rawText || 'Question';

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: 'var(--ll-surface-0)' }}>
        {/* Top bar */}
        <div style={{
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--ll-surface-1)', borderBottom: '1px solid var(--ll-border)',
          flexShrink: 0, zIndex: 10,
        }}>
          <button onClick={closeWhiteboard} className="ll-btn" style={{ padding: '6px 12px', fontSize: 11 }}>← Back</button>
          <span style={{ color: 'var(--ll-text-muted)', fontSize: 11, flex: 1, textAlign: 'center' }}>
            Question {currentQuestionIndex + 1} of {allQuestions.length}
          </span>
          <button
            onClick={() => goToQuestion('prev')}
            disabled={currentQuestionIndex <= 0}
            className="ll-btn"
            style={{ padding: '6px 10px', fontSize: 11, opacity: currentQuestionIndex <= 0 ? 0.4 : 1 }}
          >‹ Prev</button>
          <button
            onClick={() => goToQuestion('next')}
            disabled={currentQuestionIndex >= allQuestions.length - 1}
            className="ll-btn"
            style={{ padding: '6px 10px', fontSize: 11, opacity: currentQuestionIndex >= allQuestions.length - 1 ? 0.4 : 1 }}
          >Next ›</button>
        </div>

        {/* Whiteboard area */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {loadingWhiteboard ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ll-text-muted)' }}>
              Loading whiteboard...
            </div>
          ) : (
            <FullScreenWorkspace
              currentQuestion={questionText}
              onClose={closeWhiteboard}
              initialPages={whiteboardPages ?? undefined}
              onPagesChange={handleWhiteboardPagesChange}
            />
          )}
        </div>
      </div>
    );
  }

  // ─── Loading State ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ll-surface-0)' }}>
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
          <div style={{ fontSize: 48, marginBottom: 12, animation: 'pulse 1.5s ease infinite' }}>📄</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 14 }}>Loading program...</div>
        </div>
      </div>
    );
  }

  // ─── Error State ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ll-surface-0)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
          <div style={{ color: '#ef4444', fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>Error</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 13, marginBottom: 16 }}>{error}</div>
          <button onClick={onBack} className="ll-btn" style={{ padding: '8px 16px', fontSize: 12 }}>← Go Back</button>
        </div>
      </div>
    );
  }

  // ─── Processing State ─────────────────────────────────────────────────────────
  if (meta?.status === 'processing') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ll-surface-0)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12, animation: 'pulse 1.5s ease infinite' }}>⚙️</div>
          <div style={{ color: '#f59e0b', fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>Processing Your Program</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 13, marginBottom: 6 }}>{meta.sourceFileName}</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 12, marginBottom: 16 }}>
            Extracting text, identifying questions, and organizing content...
          </div>
          <div style={{
            height: 4, background: 'var(--ll-surface-2)', borderRadius: 2, overflow: 'hidden', marginBottom: 16,
          }}>
            <div style={{
              width: '60%', height: '100%',
              background: 'linear-gradient(90deg, #f59e0b, #3b82f6)',
              borderRadius: 2,
              animation: 'shimmer 2s ease infinite',
            }} />
          </div>
          <button onClick={onBack} className="ll-btn" style={{ padding: '8px 16px', fontSize: 12 }}>← Go Back</button>
        </div>
      </div>
    );
  }

  // ─── Failed State ─────────────────────────────────────────────────────────────
  if (meta?.status === 'failed') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ll-surface-0)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
          <div style={{ color: '#ef4444', fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>Processing Failed</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 13, marginBottom: 16 }}>{meta.errorMessage || 'An error occurred while processing your file.'}</div>
          <button onClick={onBack} className="ll-btn" style={{ padding: '8px 16px', fontSize: 12 }}>← Go Back</button>
        </div>
      </div>
    );
  }

  // ─── No Data Yet ──────────────────────────────────────────────────────────────
  if (!programData) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ll-surface-0)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
          <div style={{ color: 'var(--ll-text)', fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>No Content Available</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 13, marginBottom: 16 }}>This program doesn't have any questions yet.</div>
          <button onClick={onBack} className="ll-btn" style={{ padding: '8px 16px', fontSize: 12 }}>← Go Back</button>
        </div>
      </div>
    );
  }

  // ─── Table of Contents ────────────────────────────────────────────────────────
  const totalQuestions = programData.totalQuestions || programData.questions.length;
  const answeredCount = answeredIds.size;
  const progressPct = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  // Build a lookup map for questions
  const questionMap = new Map<string, PersonalProgramQuestion>();
  for (const q of programData.questions) {
    questionMap.set(q.id, q);
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ll-surface-0)' }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', flexShrink: 0,
        background: 'var(--ll-surface-1)', borderBottom: '1px solid var(--ll-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={onBack} className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
          <span style={{ fontSize: 24 }}>{meta?.coverEmoji || '📄'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', color: 'var(--ll-text)', fontSize: 16 }}>{programData.title}</div>
            <div style={{ color: 'var(--ll-text-muted)', fontSize: 11 }}>
              {totalQuestions} questions · {programData.chapters.length} {programData.chapters.length === 1 ? 'chapter' : 'chapters'}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ color: progressPct >= 100 ? '#fbbf24' : '#3b82f6', fontWeight: 'bold', fontSize: 14 }}>{progressPct}%</div>
            <div style={{ color: 'var(--ll-text-muted)', fontSize: 11 }}>{answeredCount}/{totalQuestions}</div>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: 'var(--ll-surface-0)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: `${progressPct}%`, height: '100%',
            background: progressPct >= 100 ? '#fbbf24' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
            transition: '0.5s', borderRadius: 2,
          }} />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 40px' }}>
        {!selectedTopicId ? (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24,
              padding: '8px 12px', background: 'var(--ll-surface-1)', borderRadius: 10,
              border: '1px solid var(--ll-border)',
            }}>
              <span style={{ fontSize: 18 }}>🧠</span>
              <span style={{ fontWeight: 'bold', fontSize: 14, color: 'var(--ll-text)' }}>Question types</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {programData.chapters.flatMap(ch => ch.topics || []).map((topic) => {
                const qCount = topic.questionIds?.length || 0;
                return (
                  <button
                    key={topic.id}
                    onClick={() => setSelectedTopicId(topic.id)}
                    style={{
                      background: 'var(--ll-surface-1)',
                      border: '1px solid var(--ll-border)',
                      borderRadius: 16,
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      width: '100%',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#8b5cf6';
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px rgba(139,92,246,0.15)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.transform = '';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--ll-border)';
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--ll-text)', marginBottom: 8 }}>
                      {topic.questionTypeTitle || topic.title}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ll-text-muted)' }}>
                      {qCount} {qCount === 1 ? 'Question' : 'Questions'}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            {(() => {
              const selectedTopic = programData.chapters.flatMap(ch => ch.topics || []).find(t => t.id === selectedTopicId);
              if (!selectedTopic) return null;
              
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                    <button 
                      onClick={() => setSelectedTopicId(null)}
                      className="ll-btn"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      ← Back to types
                    </button>
                    <h3 style={{ margin: 0, color: '#8b5cf6', fontSize: 16 }}>
                      {selectedTopic.questionTypeTitle || selectedTopic.title}
                    </h3>
                  </div>

                  {/* Question cards vertical list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(selectedTopic.questionIds || []).map((qId, qIdx) => {
                      const question = questionMap.get(qId);
                      if (!question) return null;

                      const isAnswered = answeredIds.has(qId);
                      const difficultyColors: Record<string, string> = {
                        easy: '#10b981', medium: '#f59e0b', hard: '#ef4444',
                      };
                      const diffColor = difficultyColors[question.difficulty || 'medium'] || '#64748b';

                      const previewText = question.rawText.length > 200
                        ? question.rawText.slice(0, 200) + '...'
                        : question.rawText;

                      return (
                        <div
                          key={qId}
                          onClick={() => openQuestion(qId)}
                          style={{
                            background: isAnswered ? 'rgba(59,130,246,0.08)' : 'var(--ll-surface-1)',
                            border: `1px solid ${isAnswered ? 'rgba(59,130,246,0.3)' : 'var(--ll-border)'}`,
                            borderRadius: 12, padding: '16px', cursor: 'pointer',
                            transition: 'all 0.2s', position: 'relative',
                            width: '100%',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                            (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.15)';
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLDivElement).style.transform = '';
                            (e.currentTarget as HTMLDivElement).style.boxShadow = '';
                          }}
                        >
                          {/* Checkbox at top right */}
                          <div 
                            style={{
                              position: 'absolute', top: 16, right: 16,
                              width: 24, height: 24, borderRadius: 6,
                              border: `2px solid ${isAnswered ? '#3b82f6' : 'var(--ll-border)'}`,
                              background: isAnswered ? '#3b82f6' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', zIndex: 2,
                            }}
                            onClick={(e) => handleToggleSolved(e, qId)}
                          >
                            {isAnswered && <span style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>✓</span>}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingRight: 40 }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 28, height: 28, borderRadius: '50%',
                              background: isAnswered ? '#3b82f6' : 'var(--ll-surface-2)',
                              color: isAnswered ? 'white' : 'var(--ll-text-muted)',
                              fontSize: 12, fontWeight: 'bold', flexShrink: 0,
                            }}>
                              {isAnswered ? '✓' : question.questionLabel || (qIdx + 1)}
                            </span>
                            <span style={{ fontSize: 13, color: 'var(--ll-text-muted)', flex: 1 }}>
                              Question {question.questionLabel || (qIdx + 1)}
                            </span>
                            {question.difficulty && (
                              <span style={{
                                fontSize: 10, fontWeight: 'bold', padding: '4px 8px',
                                borderRadius: 6, background: `${diffColor}15`,
                                color: diffColor, border: `1px solid ${diffColor}33`,
                                textTransform: 'uppercase',
                              }}>
                                {question.difficulty}
                              </span>
                            )}
                            <span style={{ fontSize: 16 }}>
                              {isAnswered ? '📝' : '✏️'}
                            </span>
                          </div>
                          <div style={{
                            fontSize: 14, color: 'var(--ll-text-soft)', lineHeight: 1.6,
                            fontFamily: 'inherit',
                          }}>
                            {previewText}
                          </div>
                          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ll-text-muted)' }}>
                            Page {question.page}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* If no chapters but there are questions, show flat list */}
        {programData.chapters.length === 0 && programData.questions.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {programData.questions.map((question, qIdx) => {
              const isAnswered = answeredIds.has(question.id);
              return (
                <div
                  key={question.id}
                  onClick={() => openQuestion(question.id)}
                  style={{
                    background: isAnswered ? 'rgba(59,130,246,0.08)' : 'var(--ll-surface-1)',
                    border: `1px solid ${isAnswered ? 'rgba(59,130,246,0.3)' : 'var(--ll-border)'}`,
                    borderRadius: 12, padding: '14px', cursor: 'pointer', transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, borderRadius: '50%',
                      background: isAnswered ? '#3b82f6' : 'var(--ll-surface-2)',
                      color: isAnswered ? 'white' : 'var(--ll-text-muted)',
                      fontSize: 11, fontWeight: 'bold',
                    }}>
                      {isAnswered ? '✓' : qIdx + 1}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ll-text-muted)' }}>Question {qIdx + 1}</span>
                    <span style={{ fontSize: 14, marginLeft: 'auto' }}>{isAnswered ? '📝' : '✏️'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ll-text-soft)', lineHeight: 1.5, maxHeight: 54, overflow: 'hidden' }}>
                    {question.rawText.length > 120 ? question.rawText.slice(0, 120) + '...' : question.rawText}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
