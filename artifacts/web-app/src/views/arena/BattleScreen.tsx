import { useState, useEffect, useRef, useCallback } from 'react';
import { generateQuestion, Difficulty, Question } from '@/lib/questionGenerator';

interface Enemy {
  name: string;
  title: string;
  avatar: string;
  color: string;
  difficulty: Difficulty;
  counterDmg: [number, number];
  xpReward: number;
  goldReward: number;
}

interface BattleScreenProps {
  enemy: Enemy;
  onComplete: (won: boolean, xpEarned: number, goldEarned: number, stats: BattleStats) => void;
  onFlee: () => void;
}

export interface BattleStats {
  correct: number;
  wrong: number;
  totalQuestions: number;
  damageDealt: number;
  damageTaken: number;
}

type Phase = 'intro' | 'question' | 'feedback' | 'result';

interface FloatText { id: number; text: string; color: string; side: 'player' | 'enemy'; }

const PLAYER_HP = 100;
const ENEMY_HP = 100;
const MAX_QUESTIONS = 12;

export default function BattleScreen({ enemy, onComplete, onFlee }: BattleScreenProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [playerHP, setPlayerHP] = useState(PLAYER_HP);
  const [enemyHP, setEnemyHP] = useState(ENEMY_HP);
  const [question, setQuestion] = useState<Question | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(12);
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [shake, setShake] = useState<'player' | 'enemy' | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [stats, setStats] = useState<BattleStats>({ correct: 0, wrong: 0, totalQuestions: 0, damageDealt: 0, damageTaken: 0 });
  const [questionCount, setQuestionCount] = useState(0);
  const [won, setWon] = useState(false);
  const [enemyAttacking, setEnemyAttacking] = useState(false);
  const [playerAttacking, setPlayerAttacking] = useState(false);

  const floatId = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerHPRef = useRef(PLAYER_HP);
  const enemyHPRef = useRef(ENEMY_HP);

  playerHPRef.current = playerHP;
  enemyHPRef.current = enemyHP;

  function addFloat(text: string, color: string, side: 'player' | 'enemy') {
    const id = floatId.current++;
    setFloats(prev => [...prev, { id, text, color, side }]);
    setTimeout(() => setFloats(prev => prev.filter(f => f.id !== id)), 1400);
  }

  function addLog(msg: string) {
    setLog(prev => [msg, ...prev].slice(0, 6));
  }

  function nextQuestion() {
    if (questionCount >= MAX_QUESTIONS) {
      endBattle(enemyHPRef.current <= 0);
      return;
    }
    const q = generateQuestion(enemy.difficulty);
    setQuestion(q);
    setSelected(null);
    setTimeLeft(q.timeLimit);
    setPhase('question');
  }

  function endBattle(playerWon: boolean) {
    setWon(playerWon);
    setPhase('result');
    if (timerRef.current) clearInterval(timerRef.current);
  }

  const handleAnswer = useCallback((idx: number | null) => {
    if (phase !== 'question' || selected !== null || !question) return;
    if (timerRef.current) clearInterval(timerRef.current);

    const correct = idx !== null && idx === question.correctIndex;
    setSelected(idx);
    setPhase('feedback');
    setStats(prev => ({
      ...prev,
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
      totalQuestions: prev.totalQuestions + 1,
    }));

    if (correct) {
      const speedBonus = idx !== null ? Math.max(0, Math.floor((timeLeft / question.timeLimit) * 10)) : 0;
      const dmg = question.damage + speedBonus;
      const newEnemyHP = Math.max(0, enemyHPRef.current - dmg);
      setEnemyHP(newEnemyHP);
      addFloat(`-${dmg}`, '#ef4444', 'enemy');
      addLog(`⚔️ You dealt ${dmg} damage${speedBonus > 0 ? ` (+${speedBonus} speed bonus!)` : ''}!`);
      setPlayerAttacking(true);
      setTimeout(() => setPlayerAttacking(false), 400);
      setShake('enemy');
      setTimeout(() => setShake(null), 500);
      setStats(prev => ({ ...prev, damageDealt: prev.damageDealt + dmg }));

      if (newEnemyHP <= 0) {
        setTimeout(() => endBattle(true), 800);
        return;
      }
    } else {
      const [minDmg, maxDmg] = enemy.counterDmg;
      const dmg = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
      const newPlayerHP = Math.max(0, playerHPRef.current - dmg);
      setPlayerHP(newPlayerHP);
      addFloat(`-${dmg}`, '#ef4444', 'player');
      const reason = idx === null ? '⏰ Time out!' : '❌ Wrong!';
      addLog(`${reason} ${enemy.name} deals ${dmg} damage!`);
      setEnemyAttacking(true);
      setTimeout(() => setEnemyAttacking(false), 400);
      setShake('player');
      setTimeout(() => setShake(null), 500);
      setStats(prev => ({ ...prev, damageTaken: prev.damageTaken + dmg }));

      if (newPlayerHP <= 0) {
        setTimeout(() => endBattle(false), 800);
        return;
      }
    }

    setTimeout(() => {
      setQuestionCount(prev => prev + 1);
      nextQuestion();
    }, 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, selected, question, timeLeft, enemy]);

  // Timer
  useEffect(() => {
    if (phase !== 'question') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleAnswer(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, handleAnswer]);

  // Intro → first question
  useEffect(() => {
    const t = setTimeout(() => nextQuestion(), 2200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Result → trigger callback
  useEffect(() => {
    if (phase !== 'result') return;
    const xp = won ? enemy.xpReward : Math.floor(enemy.xpReward * 0.15);
    const gold = won ? enemy.goldReward : Math.floor(enemy.goldReward * 0.1);
    const t = setTimeout(() => onComplete(won, xp, gold, stats), 3500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const playerPct = Math.max(0, (playerHP / PLAYER_HP) * 100);
  const enemyPct = Math.max(0, (enemyHP / ENEMY_HP) * 100);
  const timerPct = question ? (timeLeft / question.timeLimit) * 100 : 100;

  const hpColor = (pct: number) => pct > 60 ? '#10b981' : pct > 30 ? '#fbbf24' : '#ef4444';

  return (
    <div style={{
      position: 'relative', height: '100%', background: 'linear-gradient(180deg, #0a0f1e 0%, #0f172a 60%, #1a0530 100%)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: 'inherit', userSelect: 'none'
    }}>
      {/* Stars bg */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(i * 37 + 11) % 100}%`, top: `${(i * 23 + 7) % 100}%`,
            width: 2, height: 2, borderRadius: '50%', background: 'white',
            opacity: 0.3 + (i % 3) * 0.2
          }} />
        ))}
      </div>

      {/* Floating damage numbers */}
      {floats.map(f => (
        <div key={f.id} style={{
          position: 'absolute', zIndex: 50, pointerEvents: 'none',
          left: f.side === 'enemy' ? '70%' : '15%',
          top: '30%', fontSize: 28, fontWeight: 'black', color: f.color,
          animation: 'battleFloat 1.4s ease-out forwards',
          textShadow: `0 0 10px ${f.color}`
        }}>
          {f.text}
        </div>
      ))}

      {/* HP Bars */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px', zIndex: 5, flexShrink: 0 }}>
        {/* Player HP */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ color: '#93c5fd', fontWeight: 'bold', fontSize: 13 }}>YOU</span>
            <span style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{playerHP} HP</span>
          </div>
          <div style={{ height: 12, background: '#1e293b', borderRadius: 6, overflow: 'hidden', border: '1px solid #334155' }}>
            <div style={{
              width: `${playerPct}%`, height: '100%',
              background: `linear-gradient(90deg, ${hpColor(playerPct)}, ${hpColor(playerPct)}aa)`,
              transition: 'width 0.4s ease, background 0.4s',
              boxShadow: `0 0 8px ${hpColor(playerPct)}`
            }} />
          </div>
        </div>

        <div style={{ color: '#475569', fontWeight: 'bold', fontSize: 16, alignSelf: 'center', flexShrink: 0 }}>VS</div>

        {/* Enemy HP */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ color: '#fca5a5', fontWeight: 'bold', fontSize: 13 }}>{enemy.name.toUpperCase()}</span>
            <span style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{enemyHP} HP</span>
          </div>
          <div style={{ height: 12, background: '#1e293b', borderRadius: 6, overflow: 'hidden', border: '1px solid #334155', direction: 'rtl' }}>
            <div style={{
              width: `${enemyPct}%`, height: '100%',
              background: `linear-gradient(90deg, ${hpColor(enemyPct)}aa, ${hpColor(enemyPct)})`,
              transition: 'width 0.4s ease, background 0.4s',
              boxShadow: `0 0 8px ${hpColor(enemyPct)}`
            }} />
          </div>
        </div>
      </div>

      {/* Arena floor */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', alignItems: 'flex-start', paddingTop: 10, minHeight: 0, overflow: 'hidden' }}>
        {/* Player avatar */}
        <div style={{
          position: 'absolute', left: '10%', bottom: 10,
          fontSize: 56, textAlign: 'center',
          transform: `${playerAttacking ? 'translateX(20px)' : 'none'} ${shake === 'player' ? 'translateX(-8px)' : 'none'}`,
          transition: 'transform 0.15s ease', filter: shake === 'player' ? 'drop-shadow(0 0 8px #ef4444)' : 'none'
        }}>
          🧙‍♂️
          <div style={{ fontSize: 11, color: '#93c5fd', marginTop: 3, fontWeight: 'bold' }}>YOU</div>
        </div>

        {/* Enemy avatar */}
        <div style={{
          position: 'absolute', right: '10%', bottom: 10,
          fontSize: 72, textAlign: 'center',
          transform: `${enemyAttacking ? 'translateX(-20px)' : 'none'} ${shake === 'enemy' ? 'translateX(8px)' : 'none'}`,
          transition: 'transform 0.15s ease',
          filter: shake === 'enemy' ? 'drop-shadow(0 0 10px #ef4444)' : `drop-shadow(0 0 15px ${enemy.color}66)`,
          animation: phase === 'intro' ? 'enemyAppear 0.5s ease' : 'enemyFloat 3s ease-in-out infinite'
        }}>
          {enemy.avatar}
          <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 3, fontWeight: 'bold' }}>{enemy.name}</div>
        </div>

        {/* Battle log */}
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          width: '35%', minWidth: 160, maxWidth: 260,
          display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none'
        }}>
          {log.map((msg, i) => (
            <div key={i} style={{
              background: 'rgba(0,0,0,0.6)', padding: '3px 8px', borderRadius: 6, fontSize: 11,
              color: '#cbd5e1', textAlign: 'center', opacity: 1 - i * 0.18,
              border: '1px solid rgba(255,255,255,0.05)'
            }}>
              {msg}
            </div>
          ))}
        </div>

        {/* INTRO */}
        {phase === 'intro' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 12, background: 'rgba(0,0,0,0.5)', zIndex: 10,
            animation: 'fadeIn 0.3s ease'
          }}>
            <div style={{ fontSize: 18, color: '#94a3b8' }}>Battle vs</div>
            <div style={{ fontSize: 72 }}>{enemy.avatar}</div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: enemy.color }}>{enemy.name}</div>
            <div style={{ fontSize: 14, color: '#94a3b8' }}>{enemy.title}</div>
            <div style={{
              fontSize: 42, fontWeight: 'black', color: '#ef4444', letterSpacing: 4,
              textShadow: '0 0 20px #ef4444', animation: 'pulse 0.5s ease infinite'
            }}>
              BATTLE!
            </div>
          </div>
        )}

        {/* RESULT */}
        {phase === 'result' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 12, background: 'rgba(0,0,0,0.75)', zIndex: 10,
            animation: 'fadeIn 0.4s ease'
          }}>
            <div style={{ fontSize: 80 }}>{won ? '🏆' : '💀'}</div>
            <div style={{
              fontSize: 36, fontWeight: 'black', letterSpacing: 3,
              color: won ? '#fbbf24' : '#ef4444',
              textShadow: `0 0 20px ${won ? '#fbbf24' : '#ef4444'}`
            }}>
              {won ? 'VICTORY!' : 'DEFEATED'}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 1.8 }}>
              {stats.correct}/{stats.totalQuestions} correct<br />
              {won
                ? `+${enemy.xpReward} XP  +${enemy.goldReward} 🪙`
                : `+${Math.floor(enemy.xpReward * 0.15)} XP  +${Math.floor(enemy.goldReward * 0.1)} 🪙`}
            </div>
          </div>
        )}
      </div>

      {/* Question area */}
      {(phase === 'question' || phase === 'feedback') && question && (
        <div style={{ padding: '10px 16px 16px', background: 'rgba(0,0,0,0.5)', borderTop: '1px solid #334155', flexShrink: 0 }}>
          {/* Timer */}
          <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden', marginBottom: 10, border: '1px solid #334155' }}>
            <div style={{
              width: `${timerPct}%`, height: '100%',
              background: timerPct > 50 ? '#10b981' : timerPct > 25 ? '#fbbf24' : '#ef4444',
              transition: 'width 1s linear, background 0.5s'
            }} />
          </div>

          {/* Question text */}
          <div style={{
            background: '#1e293b', borderRadius: 10, padding: '12px 16px', marginBottom: 10,
            border: '1px solid #334155', textAlign: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: 'white', fontSize: 20, fontWeight: 'bold', whiteSpace: 'pre-line' }}>{question.text}</div>
            </div>
            <div style={{
              fontSize: 20, fontWeight: 'bold', minWidth: 36, textAlign: 'center',
              color: timerPct > 50 ? '#10b981' : timerPct > 25 ? '#fbbf24' : '#ef4444'
            }}>
              {timeLeft}s
            </div>
          </div>

          {/* Options */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {question.options.map((opt, i) => {
              let bg = 'rgba(30,41,59,0.8)';
              let border = '#475569';
              let color = 'white';

              if (phase === 'feedback') {
                if (i === question.correctIndex) { bg = 'rgba(16,185,129,0.2)'; border = '#10b981'; color = '#10b981'; }
                else if (i === selected) { bg = 'rgba(239,68,68,0.2)'; border = '#ef4444'; color = '#ef4444'; }
              } else if (selected === i) {
                bg = 'rgba(59,130,246,0.2)'; border = '#3b82f6';
              }

              return (
                <button
                  key={i}
                  onClick={() => phase === 'question' && handleAnswer(i)}
                  disabled={phase === 'feedback'}
                  style={{
                    padding: '13px 10px', borderRadius: 10, fontSize: 17, fontWeight: 'bold',
                    background: bg, border: `2px solid ${border}`, color,
                    cursor: phase === 'question' ? 'pointer' : 'default',
                    transition: '0.15s', fontFamily: 'inherit',
                    boxShadow: phase === 'feedback' && i === question.correctIndex ? '0 0 10px rgba(16,185,129,0.3)' : 'none'
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Flee button */}
      {phase !== 'intro' && phase !== 'result' && (
        <button
          onClick={onFlee}
          style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            fontSize: 11, color: '#475569', background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', padding: '3px 8px',
            textDecoration: 'underline', zIndex: 20
          }}
        >
          flee battle
        </button>
      )}
    </div>
  );
}
