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
import AiStudyPanel, { type AiStudyMode } from '@/components/universe/AiStudyPanel';
import TestMeModal from '@/components/universe/TestMeModal';
import FeynmanModal from '@/components/universe/FeynmanModal';
import LatexMarkdown from '@/components/ui/LatexMarkdown';

interface Props {
  programId: string | null;
  onBack: () => void;
  sandboxData?: PersonalProgramData;
  sandboxMeta?: PersonalProgramMeta;
  isPublicProgram?: boolean;
}

function renderWithMath(text: string) {
  if (!text) return null;
  return <LatexMarkdown content={text} />;
}

export default function PersonalProgramView({ programId, onBack, sandboxData, sandboxMeta, isPublicProgram }: Props) {
  const { user } = useAuth();
  const [meta, setMeta] = useState<PersonalProgramMeta | null>(null);
  const [programData, setProgramData] = useState<PersonalProgramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageData[] | null>(null);
  const [sandboxWhiteboards, setSandboxWhiteboards] = useState<Record<string, WhiteboardPageData[]>>({});
  const [loadingWhiteboard, setLoadingWhiteboard] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showRefresh, setShowRefresh] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelMode, setAiPanelMode] = useState<AiStudyMode>('study_sheet');
  const [aiPanelTitle, setAiPanelTitle] = useState('');
  const [aiPanelContent, setAiPanelContent] = useState('');
  const [testMeOpen, setTestMeOpen] = useState(false);
  const [feynmanOpen, setFeynmanOpen] = useState(false);
  const [formattedPreviews, setFormattedPreviews] = useState<Record<string, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPagesRef = useRef<WhiteboardPageData[] | null>(null);

  // File Explorer state for public programs
  const [publicProgramSpec, setPublicProgramSpec] = useState<any | null>(null);
  const [currentExplorerPath, setCurrentExplorerPath] = useState<any[]>([]);
  const [selectedSheetNode, setSelectedSheetNode] = useState<any | null>(null);

  // Show refresh button if loading takes too long
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (loading) {
      timeout = setTimeout(() => setShowRefresh(true), 5000);
    }
    return () => clearTimeout(timeout);
  }, [loading]);

  // Load program metadata and data
  useEffect(() => {
    if (sandboxData && sandboxMeta) {
      setProgramData(sandboxData);
      setMeta(sandboxMeta);
      setLoading(false);
      return;
    }
    if (!user || !programId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        let mStatus = 'ready';
        if (isPublicProgram) {
          const { getPublicProgramOrDraft } = await import('@/lib/programMaps');
          const prog = await getPublicProgramOrDraft(programId!);
          if (!prog || !prog.builderSpec) {
            setError('Public program missing builder content.');
            setLoading(false);
            return false;
          }
          const spec = prog.builderSpec as any;
          setPublicProgramSpec(spec);
          
          // Set a basic meta immediately so the UI doesn't crash
          const basicMeta: PersonalProgramMeta = {
            jobId: programId!,
            programId: programId!,
            status: 'ready',
            title: spec.programTitle || prog.title || 'Program',
            subjectId: spec.subject || prog.subject || 'mathematics',
            coverEmoji: spec.coverEmoji || prog.coverEmoji || '📄',
            contentHash: 'public',
            sourceFileName: 'Public Program',
            createdAt: new Date().toISOString(),
            programData: null as any // Will be set when a sheet is opened
          };
          setMeta(basicMeta);
          
        } else {
          // Get meta from user_docs
          const doc = await getUserDoc(user!.uid, 'personal_programs', programId!);
          if (!doc) {
            setError('Program not found.');
            setLoading(false);
            return false;
          }
          const m = doc as unknown as PersonalProgramMeta;
          setMeta(m);
          mStatus = m.status;

          if (m.status === 'processing') {
            // Polling will handle updates
          } else if (m.programData) {
            setProgramData(m.programData);
          }
        }

        // Load answered question IDs from both whiteboard and manual progress
        const whiteboardAnswered = await getAnsweredQuestionIds(user!.uid, programId!);
        const progressDoc = await getProgramProgress(user!.uid, programId!);
        
        const combined = new Set<string>(whiteboardAnswered);
        if (progressDoc && progressDoc.solvedQuestionIds) {
          for (const id of progressDoc.solvedQuestionIds) combined.add(id);
        }
        if (!cancelled) setAnsweredIds(combined);
        return !isPublicProgram && !sandboxData && mStatus === 'processing';
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load program.');
        return false;
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // Setup polling if we are in processing state
    let pollInterval: ReturnType<typeof setInterval>;
    
    // We start polling later once the initial load finishes and confirms it's processing
    const startPolling = () => {
      if (isPublicProgram || sandboxData) return;
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

    load().then(shouldPoll => {
      if (shouldPoll && !cancelled) startPolling();
    });

    return () => { 
      cancelled = true; 
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [user, programId, isPublicProgram, sandboxData]);
  // When a Sheet is selected in File Explorer mode, dynamically build programData for it
  useEffect(() => {
    if (!publicProgramSpec || !selectedSheetNode) {
      if (isPublicProgram && !selectedSheetNode) {
        setProgramData(null);
      }
      return;
    }

    const questions: any[] = [];
    let totalQuestions = 0;
    const topics: any[] = [];

    if (selectedSheetNode.questionTypes) {
      selectedSheetNode.questionTypes.forEach((qt: any) => {
        const questionIds: string[] = [];
        let parsedQuestions: any[] = [];
        try {
          if (qt.jsonText) parsedQuestions = JSON.parse(qt.jsonText);
        } catch (e) {
          console.error("Failed to parse jsonText for qt", qt.id, e);
        }
        
        if (parsedQuestions && parsedQuestions.length > 0) {
          parsedQuestions.forEach((q: any) => {
            questionIds.push(q.id);
            let rawText = q.question || '';
            if (!rawText && q.promptBlocks && Array.isArray(q.promptBlocks)) {
              rawText = q.promptBlocks
                .filter((b: any) => b.type === 'text' || b.type === 'math')
                .map((b: any) => b.type === 'math' ? b.latex : b.text)
                .filter(Boolean)
                .join('\n\n');
            }

            questions.push({
              id: q.id,
              rawText,
              chapterId: selectedSheetNode.id,
              questionTypeTitle: qt.title,
              modelAnswer: q.modelAnswer || q.solution
            });
            totalQuestions++;
          });
        }
        topics.push({
          id: qt.id,
          title: qt.title,
          questionTypeTitle: qt.title,
          questionIds
        });
      });
    }

    const pData: PersonalProgramData = {
      title: selectedSheetNode.title || 'Worksheet',
      subject: publicProgramSpec.subject || 'mathematics',
      chapters: [{
        id: selectedSheetNode.id,
        title: selectedSheetNode.title || 'Worksheet',
        topics
      }],
      questions,
      totalQuestions
    };

    setProgramData(pData);
    setMeta(prev => prev ? { ...prev, programData: pData } : null);
  }, [publicProgramSpec, selectedSheetNode, isPublicProgram]);

  // Format question previews via Groq dynamically (Removed to prevent API rate limits and console noise)
  // Open question whiteboard
  const openQuestion = useCallback(async (questionId: string) => {
    setActiveQuestionId(questionId);
    if (sandboxData) {
      setWhiteboardPages(sandboxWhiteboards[questionId] || null);
      return;
    }
    if (!user || !programId) return;
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
    if (!activeQuestionId) return;
    if (sandboxData) {
      setSandboxWhiteboards(prev => ({ ...prev, [activeQuestionId]: pages }));
      return;
    }
    if (!user || !programId) return;
    latestPagesRef.current = pages as WhiteboardPageData[];
    setSaveStatus('saving');
    // Debounce save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveQuestionWhiteboard(user.uid, programId, activeQuestionId, pages as WhiteboardPageData[])
        .then(() => {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        })
        .catch(err => console.warn('Auto-save whiteboard failed:', err))
        .finally(() => { saveTimerRef.current = null; });
    }, 1500);
  }, [user, programId, activeQuestionId]);

  // Close whiteboard and save
  const closeWhiteboard = useCallback(async () => {
    if (sandboxData) {
      setActiveQuestionId(null);
      setWhiteboardPages(null);
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      // Flush pending save synchronously
      if (user && programId && activeQuestionId && latestPagesRef.current) {
        saveQuestionWhiteboard(user.uid, programId, activeQuestionId, latestPagesRef.current)
          .catch(err => console.warn('Auto-save on close failed:', err));
      }
    }
    latestPagesRef.current = null;
    setSaveStatus('idle');
    // Note: We don't automatically mark as answered here anymore, 
    // we let the user manually check the box or we rely on the whiteboard stroke detection on reload.
    setActiveQuestionId(null);
    setWhiteboardPages(null);
  }, [user, programId, activeQuestionId]);

  const handleToggleSolved = async (e: React.MouseEvent, questionId: string) => {
    e.stopPropagation();
    if (sandboxData) {
      setAnsweredIds(prev => {
        const next = new Set(prev);
        if (next.has(questionId)) next.delete(questionId);
        else next.add(questionId);
        return next;
      });
      return;
    }
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
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: 'var(--ll-surface-0)' }}>
        {/* Top bar */}
        <div style={{
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--ll-surface-1)', borderBottom: '1px solid var(--ll-border)',
          flexShrink: 0, zIndex: 10,
        }}>
          <button onClick={closeWhiteboard} className="ll-btn" style={{ padding: '6px 12px', fontSize: 11 }}>← Back</button>
          <span style={{ color: 'var(--ll-text-muted)', fontSize: 11, flex: 1, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span>Question {currentQuestionIndex + 1} of {allQuestions.length}</span>
            {saveStatus === 'saving' && <span style={{ color: '#fbbf24', animation: 'pulse 1.5s infinite' }}>Saving...</span>}
            {saveStatus === 'saved' && <span style={{ color: '#10b981' }}>Saved</span>}
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
              currentQuestion={activeQuestion}
              onClose={closeWhiteboard}
              initialPages={(whiteboardPages as any) ?? undefined}
              onPagesChange={handleWhiteboardPagesChange as any}
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
          {showRefresh && (
            <div style={{ marginTop: 24, animation: 'fadeIn 0.5s ease' }}>
              <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Taking too long?</div>
              <button className="ll-btn" onClick={() => window.location.reload()} style={{ padding: '8px 16px' }}>
                Refresh Page
              </button>
            </div>
          )}
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

  // ─── File Explorer (Public Programs Only) ──────────────────────────────────────
  if (!programData && publicProgramSpec && !selectedSheetNode) {
    const currentNode = currentExplorerPath.length === 0 
      ? publicProgramSpec.root 
      : currentExplorerPath[currentExplorerPath.length - 1];
    
    let displayChildren = currentNode.children || [];
    if (currentExplorerPath.length === 0 && displayChildren.length === 1 && displayChildren[0].id === 'fixed_first_division') {
      displayChildren = displayChildren[0].children || [];
    }

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ll-surface-0)' }}>
        <div style={{
          padding: '14px 16px', flexShrink: 0,
          background: 'var(--ll-surface-1)', borderBottom: '1px solid var(--ll-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => {
              if (currentExplorerPath.length > 0) {
                setCurrentExplorerPath(prev => prev.slice(0, -1));
              } else {
                window.dispatchEvent(new CustomEvent('ll:openMyPrograms'));
                onBack();
              }
            }} className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
            <span style={{ fontSize: 24 }}>{meta?.coverEmoji || '📄'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', color: 'var(--ll-text)', fontSize: 16 }}>
                {currentExplorerPath.length === 0 ? (publicProgramSpec.programTitle || 'Program') : currentNode.title}
              </div>
              <div style={{ color: 'var(--ll-text-muted)', fontSize: 11 }}>
                {currentExplorerPath.length === 0 ? 'Program Explorer' : 'Folder'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {currentExplorerPath.length === 0 && currentNode.questionTypes && currentNode.questionTypes.length > 0 && (
             <div
                onClick={() => setSelectedSheetNode(currentNode)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: 16,
                  background: 'var(--ll-surface-1)', border: '1px solid var(--ll-border)',
                  borderRadius: 12, cursor: 'pointer', marginBottom: 12
                }}
             >
               <span style={{ fontSize: 24 }}>📄</span>
               <div style={{ flex: 1 }}>
                 <div style={{ fontWeight: 'bold', color: 'var(--ll-text)', fontSize: 14 }}>Root Worksheet</div>
                 <div style={{ color: 'var(--ll-text-muted)', fontSize: 12 }}>{currentNode.questionTypes.length} question types</div>
               </div>
             </div>
          )}

          {displayChildren.length === 0 && !(currentExplorerPath.length === 0 && currentNode.questionTypes?.length > 0) && (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Empty folder.</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
            {displayChildren.map((child: any) => {
              const isSheet = child.questionTypes && child.questionTypes.length > 0;
              return (
                <div
                  key={child.id}
                  onClick={() => {
                    if (isSheet) {
                      setSelectedSheetNode(child);
                    } else {
                      setCurrentExplorerPath(prev => [...prev, child]);
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: 16,
                    background: 'var(--ll-surface-1)', border: '1px solid var(--ll-border)',
                    borderRadius: 12, cursor: 'pointer'
                  }}
                >
                  <span style={{ fontSize: 24 }}>{isSheet ? '📄' : '📁'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--ll-text)', fontSize: 14 }}>{child.title || (isSheet ? 'Worksheet' : 'Folder')}</div>
                    <div style={{ color: 'var(--ll-text-muted)', fontSize: 12 }}>
                      {isSheet ? `${child.questionTypes.length} types` : `${child.children?.length || 0} items`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
          <button onClick={() => {
            if (selectedSheetNode) {
              setSelectedSheetNode(null);
            } else {
              window.dispatchEvent(new CustomEvent('ll:openMyPrograms'));
              onBack();
            }
          }} className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
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
            {/* ── AI Study Tools: Test Me + Feynman ── */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {(
                [
                  {
                    key: 'test_me',
                    emoji: '🎯',
                    label: 'Test Me',
                    sub: 'Based on your answered questions',
                    accent: '#f59e0b',
                    action: () => setTestMeOpen(true),
                  },
                  {
                    key: 'feynman',
                    emoji: '🧑‍🏫',
                    label: 'Feynman Mode',
                    sub: 'Explain it to learn it',
                    accent: '#ec4899',
                    action: () => setFeynmanOpen(true),
                  },
                ] as const
              ).map(({ key, emoji, label, sub, accent, action }) => (
                <button
                  key={key}
                  onClick={action}
                  style={{
                    flex: 1, background: `${accent}10`,
                    border: `1px solid ${accent}30`,
                    borderRadius: 14, padding: '16px 10px',
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 4,
                    transition: 'all 0.2s',
                    color: 'inherit',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.background = `${accent}20`;
                    el.style.borderColor = `${accent}60`;
                    el.style.transform = 'translateY(-2px)';
                    el.style.boxShadow = `0 8px 20px ${accent}20`;
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.background = `${accent}10`;
                    el.style.borderColor = `${accent}30`;
                    el.style.transform = '';
                    el.style.boxShadow = '';
                  }}
                >
                  <span style={{ fontSize: 24 }}>{emoji}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: accent }}>{label}</span>
                  <span style={{ fontSize: 10, color: 'var(--ll-text-muted)', textAlign: 'center' }}>{sub}</span>
                </button>
              ))}
            </div>



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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
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

                  {/* Learn How to Solve button */}
                  <button
                    onClick={() => {
                      const topicQuestions = (selectedTopic.questionIds || [])
                        .map(qId => questionMap.get(qId))
                        .filter((q): q is PersonalProgramQuestion => !!q);
                      const topicContent = topicQuestions.map((q, i) => `Q${i + 1}: ${q.rawText}`).join('\n\n');
                      setAiPanelTitle(selectedTopic.questionTypeTitle || selectedTopic.title);
                      setAiPanelContent(topicContent);
                      setAiPanelMode('study_sheet');
                      setAiPanelOpen(true);
                    }}
                    style={{
                      width: '100%', background: '#10b98110',
                      border: '1px solid #10b98130',
                      borderRadius: 12, padding: '13px 16px',
                      cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 10,
                      marginBottom: 16, transition: 'all 0.2s', color: 'inherit',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = '#10b98120';
                      el.style.borderColor = '#10b98160';
                      el.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = '#10b98110';
                      el.style.borderColor = '#10b98130';
                      el.style.transform = '';
                    }}
                  >
                    <span style={{ fontSize: 20 }}>📚</span>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>Learn How to Solve</div>
                      <div style={{ fontSize: 11, color: 'var(--ll-text-muted)' }}>Step-by-step example for this question type</div>
                    </div>
                  </button>

                  {/* Question cards vertical list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(selectedTopic.questionIds || []).map((qId, qIdx) => {
                      const question = questionMap.get(qId);
                      if (!question) return null;

                      const isAnswered = answeredIds.has(qId);

                      let previewText = formattedPreviews[qId] || question.rawText || '';
                      
                      // Clean up common OCR numbering prefixes like "1.", "**Q1:**", "### Question 1:", "Exercice 1:"
                      previewText = previewText.replace(/^\s*(?:\*\*|###\s*|##\s*|#\s*)?(?:(?:Q|Question|Exercice|Exo|Ex)\s*(?:n[°o]\s*)?\d+\s*[:.)-]?|\d+\s*[:.)-])\s*(?:\*\*|:)?\s*/i, '');
                      
                      const displayPreview = previewText.length > 200
                        ? previewText.slice(0, 200) + '...'
                        : previewText;

                      return (
                        <div
                          key={qId}
                          onClick={() => openQuestion(qId)}
                          style={{
                            background: isAnswered ? 'rgba(59,130,246,0.08)' : 'var(--ll-surface-1)',
                            border: `1px solid ${isAnswered ? 'rgba(59,130,246,0.3)' : 'var(--ll-border)'}`,
                            borderRadius: 12, padding: '16px', cursor: 'pointer',
                            transition: 'all 0.2s', position: 'relative',
                            width: '100%', overflow: 'hidden',
                            overflowWrap: 'break-word', wordBreak: 'break-word',
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
                          </div>
                          <div style={{
                            fontSize: 14, color: 'var(--ll-text-soft)', lineHeight: 1.6,
                            fontFamily: 'inherit', overflowWrap: 'break-word', wordBreak: 'break-word',
                          }}>
                            {renderWithMath(displayPreview)}
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
              let previewText = formattedPreviews[question.id] || question.rawText;
              if (previewText) {
                previewText = previewText.replace(/^\s*(?:\*\*|###\s*|##\s*|#\s*)?(?:(?:Q|Question|Exercice|Exo|Ex)\s*(?:n[°o]\s*)?\d+\s*[:.)-]?|\d+\s*[:.)-])\s*(?:\*\*|:)?\s*/i, '');
              }
              const displayPreview = previewText && previewText.length > 200 ? previewText.slice(0, 120) + '...' : previewText;
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
                  <div style={{ fontSize: 12, color: 'var(--ll-text-soft)', lineHeight: 1.5, maxHeight: 54, overflow: 'hidden', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                    {renderWithMath(displayPreview)}
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

      {/* AI Study Panel (Feynman + Learn How to Solve) */}
      <AiStudyPanel
        open={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        mode={aiPanelMode}
        programTitle={aiPanelTitle}
        contentSummary={aiPanelContent}
      />

      {/* Test Me Modal */}
      <TestMeModal
        open={testMeOpen}
        onClose={() => setTestMeOpen(false)}
        programTitle={programData?.title ?? ''}
        answeredQuestions={programData
          ? programData.questions.filter(q => answeredIds.has(q.id))
          : []
        }
      />

      {/* Feynman Modal */}
      <FeynmanModal
        open={feynmanOpen}
        onClose={() => setFeynmanOpen(false)}
        programTitle={programData?.title ?? ''}
        answeredQuestions={programData
          ? programData.questions.filter(q => answeredIds.has(q.id))
          : []
        }
      />
    </div>
  );
}
