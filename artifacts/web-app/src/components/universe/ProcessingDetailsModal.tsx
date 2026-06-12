import React from 'react';
import { type PersonalProgramMeta } from '@/lib/personalProgramService';

interface ProcessingDetailsModalProps {
  open: boolean;
  onClose: () => void;
  program: PersonalProgramMeta | null;
}

const INGESTION_STAGES = [
  { id: 'uploaded', label: 'File Uploaded', pct: 10 },
  { id: 'extracting', label: 'Extracting Text & Images (OCR)', pct: 30 },
  { id: 'auditing', label: 'Auditing Extraction Quality', pct: 40 },
  { id: 'segmenting', label: 'Segmenting Questions', pct: 50 },
  { id: 'normalizing', label: 'Normalizing Formats & Math', pct: 70 },
  { id: 'structuring', label: 'Structuring Program AI', pct: 90 },
  { id: 'reviewing', label: 'Finalizing Details', pct: 95 },
  { id: 'published', label: 'Ready', pct: 100 },
];

export function getProgressPercentage(status: string): number {
  if (status === 'ready' || status === 'published') return 100;
  if (status === 'failed') return 0;
  const stage = INGESTION_STAGES.find((s) => s.id === status);
  return stage ? stage.pct : 20; // fallback processing
}

export default function ProcessingDetailsModal({ open, onClose, program }: ProcessingDetailsModalProps) {
  if (!open || !program) return null;

  const currentPct = getProgressPercentage(program.status);
  const isFailed = program.status === 'failed';
  const isReady = program.status === 'ready' || program.status === 'published';

  const modalOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(15, 23, 42, 0.8)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  };

  const panelStyle: React.CSSProperties = {
    width: 'min(500px, 94vw)',
    background: 'var(--ll-surface-0)',
    borderRadius: 18,
    border: '2px solid var(--ll-border)',
    boxShadow: '0 30px 80px rgba(0,0,0,0.65)',
    padding: '24px 32px',
    color: 'var(--ll-text)',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    position: 'relative',
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none', color: 'var(--ll-text-muted)',
            fontSize: 24, cursor: 'pointer'
          }}
        >
          &times;
        </button>

        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
          {program.coverEmoji} {program.title}
        </h2>
        <p style={{ margin: 0, color: 'var(--ll-text-muted)', fontSize: 14 }}>
          {isFailed ? 'Creation Failed' : isReady ? 'Creation Complete!' : 'Automated creation in progress...'}
        </p>

        {isFailed && program.errorMessage && (
          <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: 12, borderRadius: 8, fontSize: 13 }}>
            <strong>Error:</strong> {program.errorMessage}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
          {INGESTION_STAGES.map((stage, idx) => {
            const isCompleted = currentPct >= stage.pct;
            const isCurrent = program.status === stage.id;
            
            return (
              <div key={stage.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  width: 24, height: 24, borderRadius: '50%', 
                  background: isCompleted ? 'var(--ll-primary)' : 'var(--ll-surface-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isCompleted ? '#fff' : 'transparent',
                  fontSize: 14,
                  border: isCurrent && !isFailed ? '2px solid var(--ll-text)' : '2px solid transparent'
                }}>
                  {isCompleted && '✓'}
                </div>
                <div style={{ 
                  flex: 1, 
                  color: isCompleted ? 'var(--ll-text)' : 'var(--ll-text-muted)',
                  fontWeight: isCurrent ? 600 : 400
                }}>
                  {stage.label}
                </div>
                {isCurrent && !isFailed && !isReady && (
                  <div style={{ fontSize: 13, color: 'var(--ll-primary)', animation: 'pulse 1.5s infinite' }}>
                    Running...
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ height: 6, background: 'var(--ll-surface-2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ 
              height: '100%', 
              background: isFailed ? '#ef4444' : 'var(--ll-primary)', 
              width: `${currentPct}%`,
              transition: 'width 0.5s ease-out'
            }} />
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--ll-text-muted)', marginTop: 4 }}>
            {isFailed ? 'Failed' : `${currentPct}% Complete`}
          </div>
        </div>

        {isReady && (
          <button 
            className="ll-btn"
            onClick={onClose}
            style={{ marginTop: 10, alignSelf: 'center', width: '100%' }}
          >
            Start Playing
          </button>
        )}
      </div>
    </div>
  );
}
