import React, { useEffect, useState } from 'react';
import { type PersonalProgramMeta, type ProcessingStage } from '@/lib/personalProgramService';

interface ProcessingDetailsModalProps {
  open: boolean;
  onClose: () => void;
  program: PersonalProgramMeta | null;
  onCancel?: () => void; // called when user cancels/deletes a processing program
}

// ── Real stages that match actual async work in the pipeline ─────────────────
interface StageConfig {
  id: ProcessingStage | 'done';
  label: string;
  description: string;
  pct: number;
}

const PIPELINE_STAGES: StageConfig[] = [
  {
    id: 'uploading',
    label: 'Saving File',
    description: 'Creating program record in your library',
    pct: 10,
  },
  {
    id: 'ocr',
    label: 'Reading Document (OCR)',
    description: 'Extracting text and math formulas from your PDF using pix2text + Tesseract',
    pct: 35,
  },
  {
    id: 'extracting_questions',
    label: 'Extracting Questions',
    description: 'AI is identifying and grouping all questions by topic',
    pct: 65,
  },
  {
    id: 'building_program',
    label: 'Building Program Structure',
    description: 'Assembling chapters, topics, and question links',
    pct: 85,
  },
  {
    id: 'saving',
    label: 'Saving to Library',
    description: 'Writing the finished program to your account',
    pct: 95,
  },
  {
    id: 'done',
    label: 'Ready!',
    description: 'Your program is ready to play',
    pct: 100,
  },
];

export function getProgressPercentage(
  status: string,
  processingStage?: ProcessingStage,
): number {
  if (status === 'ready') return 100;
  if (status === 'failed') return 0;
  if (processingStage) {
    const stage = PIPELINE_STAGES.find((s) => s.id === processingStage);
    if (stage) return stage.pct;
  }
  return 10; // fallback — just started
}

export function getStageLabel(
  status: string,
  processingStage?: ProcessingStage,
): string {
  if (status === 'ready') return 'Ready!';
  if (status === 'failed') return 'Failed';
  if (processingStage) {
    const stage = PIPELINE_STAGES.find((s) => s.id === processingStage);
    if (stage) return stage.label;
  }
  return 'Saving File'; // fallback — just started
}

// ── Elapsed timer hook ───────────────────────────────────────────────────────
function useElapsed(startIso: string | undefined, active: boolean): string {
  const [elapsed, setElapsed] = useState('0s');
  useEffect(() => {
    if (!active || !startIso) return;
    const update = () => {
      const secs = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
      if (secs < 60) setElapsed(`${secs}s`);
      else setElapsed(`${Math.floor(secs / 60)}m ${secs % 60}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startIso, active]);
  return elapsed;
}

export function useSmoothProgress(targetPct: number, isFailed: boolean): number {
  const [displayedPct, setDisplayedPct] = useState(targetPct);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (displayedPct < targetPct) {
      // Catch up quickly to the target
      interval = setInterval(() => {
        setDisplayedPct(p => Math.min(p + 1, targetPct));
      }, 20);
    } else if (displayedPct >= targetPct && targetPct < 100 && !isFailed) {
      // Simulate slow background progress while waiting for next stage
      const cap = Math.min(targetPct + 15, 99);
      interval = setInterval(() => {
        setDisplayedPct(p => Math.min(p + 1, cap));
      }, 1500);
    } else if (targetPct === 100 || isFailed) {
      setDisplayedPct(targetPct);
    }

    return () => clearInterval(interval);
  }, [displayedPct, targetPct, isFailed]);

  return displayedPct;
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 14, height: 14,
      border: '2px solid rgba(139,92,246,0.3)',
      borderTopColor: '#8b5cf6',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function ProcessingDetailsModal({
  open,
  onClose,
  program,
  onCancel,
}: ProcessingDetailsModalProps) {
  if (!open || !program) return null;

  const isFailed  = program.status === 'failed';
  const isReady   = program.status === 'ready';
  const isActive  = program.status === 'processing';

  const targetPct = getProgressPercentage(program.status, program.processingStage);
  const currentPct = useSmoothProgress(targetPct, isFailed);

  // Which stage index is currently running?
  const activeStageId: string = isReady
    ? 'done'
    : (program.processingStage ?? 'uploading');

  const activeStageIdx = PIPELINE_STAGES.findIndex((s) => s.id === activeStageId);

  const elapsed = useElapsed(program.createdAt, isActive);

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(8, 12, 28, 0.85)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 16,
  };

  const panelStyle: React.CSSProperties = {
    width: 'min(520px, 96vw)',
    background: 'var(--ll-surface-0)',
    borderRadius: 20,
    border: `2px solid ${isFailed ? 'rgba(239,68,68,0.4)' : 'rgba(139,92,246,0.35)'}`,
    boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
    padding: '28px 32px',
    color: 'var(--ll-text)',
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
    position: 'relative',
  };

  return (
    <>
      <div style={overlayStyle} onClick={onClose}>
        <div style={panelStyle} onClick={(e) => e.stopPropagation()}>

          {/* ── Close button ── */}
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'none', border: 'none',
              color: 'var(--ll-text-muted)', fontSize: 22,
              cursor: 'pointer', lineHeight: 1,
            }}
            title="Close"
          >
            ×
          </button>

          {/* ── Header ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 26 }}>{program.coverEmoji || '📄'}</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>
                {program.title}
              </h2>
            </div>
            <p style={{ margin: 0, color: 'var(--ll-text-muted)', fontSize: 13 }}>
              {isFailed
                ? 'Processing failed'
                : isReady
                ? '✅ Program is ready!'
                : `Processing… ${elapsed} elapsed`}
            </p>
          </div>

          {/* ── Error box ── */}
          {isFailed && program.errorMessage && (
            <div style={{
              background: 'rgba(127,29,29,0.5)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#fca5a5',
              padding: '12px 14px',
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              <strong>Error:</strong> {program.errorMessage}
            </div>
          )}

          {/* ── Stage list ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PIPELINE_STAGES.map((stage, idx) => {
              const isCompleted = isReady
                ? true
                : activeStageIdx > idx;
              const isCurrent = !isFailed && !isReady && activeStageIdx === idx;
              const isPending  = !isCompleted && !isCurrent;

              return (
                <div key={stage.id} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  opacity: isPending ? 0.45 : 1,
                  transition: 'opacity 0.3s',
                }}>
                  {/* Dot / checkmark / spinner */}
                  <div style={{
                    width: 26, height: 26, flexShrink: 0,
                    borderRadius: '50%',
                    background: isCompleted
                      ? 'linear-gradient(135deg,#8b5cf6,#3b82f6)'
                      : isCurrent
                      ? 'rgba(139,92,246,0.15)'
                      : 'var(--ll-surface-2)',
                    border: isCurrent
                      ? '2px solid #8b5cf6'
                      : isCompleted
                      ? '2px solid transparent'
                      : '2px solid var(--ll-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 1,
                  }}>
                    {isCompleted ? (
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>✓</span>
                    ) : isCurrent ? (
                      <Spinner />
                    ) : null}
                  </div>

                  {/* Labels */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: isCurrent ? 700 : 500,
                      color: isCompleted
                        ? 'var(--ll-text)'
                        : isCurrent
                        ? '#c4b5fd'
                        : 'var(--ll-text-muted)',
                      marginBottom: 2,
                    }}>
                      {stage.label}
                      {isCurrent && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#8b5cf6', fontWeight: 400 }}>
                          running…
                        </span>
                      )}
                    </div>
                    {(isCurrent || isCompleted) && (
                      <div style={{ fontSize: 11, color: 'var(--ll-text-muted)', lineHeight: 1.4 }}>
                        {stage.description}
                      </div>
                    )}
                  </div>

                  {/* % badge on active step */}
                  {isCurrent && (
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: '#8b5cf6',
                      background: 'rgba(139,92,246,0.12)',
                      border: '1px solid rgba(139,92,246,0.3)',
                      borderRadius: 6,
                      padding: '2px 7px',
                      flexShrink: 0,
                    }}>
                      {stage.pct}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Progress bar ── */}
          <div>
            <div style={{
              height: 8, background: 'var(--ll-surface-2)',
              borderRadius: 4, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                background: isFailed
                  ? '#ef4444'
                  : 'linear-gradient(90deg,#8b5cf6,#3b82f6)',
                width: `${currentPct}%`,
                transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                borderRadius: 4,
              }} />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 12, color: 'var(--ll-text-muted)', marginTop: 5,
            }}>
              <span>
                {isFailed ? 'Failed' : isReady ? 'Complete' : `${currentPct}% complete`}
              </span>
              {isActive && (
                <span style={{ color: '#6b7280' }}>↻ updates every 5s</span>
              )}
            </div>
          </div>

          {/* ── Action buttons ── */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {isReady && (
              <button
                className="ll-btn ll-btn-primary"
                onClick={onClose}
                style={{ flex: 1, padding: '11px', fontSize: 14, fontWeight: 700 }}
              >
                🎮 Start Playing
              </button>
            )}

            {(isActive || isFailed) && onCancel && (
              <button
                className="ll-btn"
                onClick={onCancel}
                style={{
                  flex: 1,
                  padding: '11px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderColor: 'rgba(239,68,68,0.4)',
                  color: '#fca5a5',
                }}
              >
                🗑 {isFailed ? 'Delete' : 'Cancel & Delete'}
              </button>
            )}

            {!isReady && (
              <button
                className="ll-btn"
                onClick={onClose}
                style={{ padding: '11px 18px', fontSize: 13 }}
              >
                Close
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
