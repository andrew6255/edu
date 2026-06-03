import { useState } from 'react';
import FullScreenWorkspace from './FullScreenWorkspace';

export default function TestingWhiteboard() {
  // ── Full-Screen Workspace State ──
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [workspaceEverOpened, setWorkspaceEverOpened] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);

  const openQuestion = (questionText: string) => {
    setActiveQuestion(questionText);
    setWorkspaceEverOpened(true);
    setShowWorkspace(true);
  };

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      background: '#09090b',
      color: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '60px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      <h1 style={{ fontSize: 32, marginBottom: 12, fontWeight: 700, letterSpacing: '-0.02em' }}>
        AI Grading Dashboard
      </h1>
      <p style={{ color: '#a1a1aa', marginBottom: 48, fontSize: 16 }}>
        Select a question below to launch the infinite whiteboard.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 400 }}>
        {/* Question 1 */}
        <button
          onClick={() => openQuestion("Find the equation of the line passing through the points (2,3) and (6, 7).")}
          style={{
            padding: '16px 24px',
            borderRadius: 12,
            border: '1px solid rgba(168,85,247,0.25)',
            background: 'linear-gradient(135deg, rgba(24,24,27,0.9) 0%, rgba(30,30,34,0.85) 100%)',
            color: '#c084fc',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.borderColor = 'rgba(168,85,247,0.5)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(168,85,247,0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.borderColor = 'rgba(168,85,247,0.25)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
          }}
        >
          ✦ Question 1: Equation of the line
        </button>

        {/* Question 2 */}
        <button
          onClick={() => openQuestion("Développer et réduire l'expression suivante : A = 4(3x - 5)")}
          style={{
            padding: '16px 24px',
            borderRadius: 12,
            border: '1px solid rgba(59,130,246,0.25)',
            background: 'linear-gradient(135deg, rgba(24,24,27,0.9) 0%, rgba(30,30,34,0.85) 100%)',
            color: '#60a5fa',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(59,130,246,0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
          }}
        >
          ✦ Question 2: Développement
        </button>
      </div>

      {/* Full-Screen Workspace Overlay */}
      {workspaceEverOpened && (
        <FullScreenWorkspace
          visible={showWorkspace}
          onClose={() => setShowWorkspace(false)}
          activeQuestion={activeQuestion}
        />
      )}
    </div>
  );
}