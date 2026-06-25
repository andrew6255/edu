import { useState, useEffect, useRef } from 'react';
import { PartyMatchDoc, submitPartySelection, updatePartySharedState, updatePartyMatchScore } from '@/lib/partyMatchService';

interface Question {
  q: string;
  options: number[];
  answer: number;
}

interface Props {
  match: PartyMatchDoc;
  myUid: string;
  onGameOver: (myScore: number) => void;
}

function genQuestion(hard = false): Question {
  if (!hard) {
    const ops = ['+', '-', '*', '/'] as const;
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a = Math.floor(Math.random() * 12) + 1;
    let b = Math.floor(Math.random() * 12) + 1;
    let answer: number;
    let q: string;

    if (op === '+') { answer = a + b; q = `${a} + ${b}`; }
    else if (op === '-') {
      if (a < b) [a, b] = [b, a];
      answer = a - b; q = `${a} − ${b}`;
    } else if (op === '*') { answer = a * b; q = `${a} × ${b}`; }
    else {
      b = Math.max(1, b);
      answer = a;
      q = `${a * b} ÷ ${b}`;
    }

    const distractors = new Set<number>();
    distractors.add(answer);
    while (distractors.size < 4) {
      const offset = Math.floor(Math.random() * 10) - 5;
      if (offset !== 0) distractors.add(answer + offset);
    }
    const options = Array.from(distractors).sort(() => Math.random() - 0.5);
    return { q, options, answer };
  }
  
  // advanced math logic
  const a = Math.floor(Math.random() * 20) + 5;
  const b = Math.floor(Math.random() * 20) + 5;
  const answer = a + b;
  const distractors = new Set<number>([answer]);
  while (distractors.size < 4) distractors.add(answer + Math.floor(Math.random() * 10) - 5);
  return { q: `${a} + ${b} (Advanced)`, options: Array.from(distractors).sort(), answer };
}

export default function PartyQuickMathGame({ match, myUid, onGameOver }: Props) {
  const isHost = match.hostUid === myUid;
  const [timeLeft, setTimeLeft] = useState(60); // 60s for the whole game
  const isHard = match.gameId === 'advQuickMath';
  
  const question = match.sharedState?.question as Question | undefined;
  
  // Host generates initial question if none exists
  useEffect(() => {
    if (isHost && !question) {
      updatePartySharedState(match.id, myUid, { question: genQuestion(isHard) });
    }
  }, [isHost, question, match.id, myUid, isHard]);
  
  // Main countdown timer (Host manages it? Or just local?)
  // For simplicity, local timer. When it hits 0, game over.
  useEffect(() => {
    if (timeLeft <= 0) {
      const myScore = match.players.find(p => p.uid === myUid)?.score || 0;
      onGameOver(myScore);
      return;
    }
    const id = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timeLeft, myUid, match.players, onGameOver]);

  // Check consensus on selections
  useEffect(() => {
    if (!isHost || !question || match.state !== 'playing') return;
    
    const selections = Object.values(match.selections);
    // Only proceed if everyone has voted
    if (selections.length === match.players.length && match.players.length > 0) {
      const firstSelection = selections[0];
      const allAgreed = selections.every(s => s === firstSelection);
      
      if (allAgreed) {
        if (firstSelection === question.answer) {
          // Consensus on Correct answer!
          match.players.forEach(p => {
            updatePartyMatchScore(match.id, myUid, p.uid, 1);
          });
          // Generate next question
          setTimeout(() => {
            updatePartySharedState(match.id, myUid, { question: genQuestion(isHard) }, true);
          }, 300);
        } else {
          // Consensus on Wrong answer!
          // Briefly show wrong state? We can just clear selections and let them try again.
          setTimeout(() => {
            updatePartySharedState(match.id, myUid, { question }, true);
          }, 500);
        }
      }
    }
  }, [match.selections, isHost, question, match.players, match.state, match.id, myUid, isHard]);

  if (!question) return <div style={{ color: 'white', textAlign: 'center', marginTop: 50 }}>Host is generating question...</div>;

  const mySelection = match.selections[myUid];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 24, color: '#f87171', marginBottom: 20 }}>⏳ {timeLeft}s</div>
      
      <div style={{
        fontSize: 48, fontWeight: 'bold', marginBottom: 40,
        background: 'rgba(255,255,255,0.1)', padding: '20px 40px', borderRadius: 20
      }}>
        {question.q} = ?
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, width: '100%', maxWidth: 400 }}>
        {question.options.map(opt => {
          const isSelectedByMe = mySelection === opt;
          // Find who selected this option
          const selectors = match.players.filter(p => match.selections[p.uid] === opt);
          
          return (
            <button
              key={opt}
              disabled={mySelection !== undefined && mySelection !== opt}
              onClick={() => submitPartySelection(match.id, myUid, opt)}
              className="ll-btn"
              style={{
                padding: '20px', fontSize: 24, fontWeight: 'bold', borderRadius: 16,
                background: isSelectedByMe ? 'rgba(99,102,241,0.5)' : undefined,
                border: isSelectedByMe ? '2px solid #a5b4fc' : undefined,
                position: 'relative'
              }}
            >
              {opt}
              {selectors.length > 0 && (
                <div style={{ position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
                  {selectors.map(p => (
                    <span key={p.uid} style={{ fontSize: 16 }}>{p.emoji}</span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
      
      {mySelection !== undefined && match.players.length > 1 && (
        <div style={{ marginTop: 40, color: '#94a3b8', fontSize: 14 }}>
          Waiting for party consensus...
        </div>
      )}
    </div>
  );
}
