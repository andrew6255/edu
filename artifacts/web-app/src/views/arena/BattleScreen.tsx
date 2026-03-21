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
  highestStreak: number;
}

type Phase = 'intro' | 'question' | 'feedback' | 'result';

interface FloatText { id: number; text: string; color: string; side: 'player' | 'enemy'; }

const PLAYER_HP = 100;
const ENEMY_HP = 100;
const MAX_QUESTIONS = 12;

function streakBonus(streak: number): number {
  if (streak >= 7) return 20;
  if (streak >= 5) return 12;
  if (streak >= 3) return 5;
  return 0;
}

function streakLabel(streak: number): string | null {
  if (streak >= 7) return '🔥 UNSTOPPABLE x' + streak;
  if (streak >= 5) return '💥 ON FIRE x' + streak;
  if (streak >= 3) return '⚡ STREAK x' + streak;
  return null;
}

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
  const [stats, setStats] = useState<BattleStats>({
    correct: 0, wrong: 0, totalQuestions: 0,
    damageDealt: 0, damageTaken: 0, highestStreak: 0
  });
  const [questionCount, setQuestionCount] = useState(0);
  const [won, setWon] = useState(false);
  const [enemyAttacking, setEnemyAttacking] = useState(false);
  const [playerAttacking, setPlayerAttacking] = useState(false);
  const [streak, setStreak] = useState(0);
  const [showStreakBanner, setShowStreakBanner] = useState(false);

  const floatId = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerHPRef = useRef(PLAYER_HP);
  const enemyHPRef = useRef(ENEMY_HP);
  const streakRef = useRef(0);
  const statsRef = useRef(stats);

  playerHPRef.current = playerHP;
  enemyHPRef.current = enemyHP;
  streakRef.current = streak;
  statsRef.current = stats;

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
      endBattle(enemyHPRef.current <= 0 || enemyHPRef.current < playerHPRef.current);
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

    if (correct) {
      const newStreak = streakRef.current + 1;
      setStreak(newStreak);
      streakRef.current = newStreak;
      const bonus = streakBonus(newStreak);
      const speedBonus = Math.max(0, Math.floor((timeLeft / question.timeLimit) * 10));
      const dmg = question.damage + speedBonus + bonus;
      const newEnemyHP = Math.max(0, enemyHPRef.current - dmg);
      setEnemyHP(newEnemyHP);
      addFloat(`-${dmg}`, '#ef4444', 'enemy');
      const parts = [`⚔️ You dealt ${dmg} dmg`];
      if (speedBonus > 0) parts.push(`(+${speedBonus} speed)`);
      if (bonus > 0) parts.push(`(+${bonus} streak!)`);
      addLog(parts.join(' '));
      setPlayerAttacking(true);
      setTimeout(() => setPlayerAttacking(false), 400);
      setShake('enemy');
      setTimeout(() => setShake(null), 500);
      setStats(prev => {
        const next = {
          ...prev,
          correct: prev.correct + 1,
          totalQuestions: prev.totalQuestions + 1,
          damageDealt: prev.damageDealt + dmg,
          highestStreak: Math.max(prev.highestStreak, newStreak)
        };
        statsRef.current = next;
        return next;
      });

      if (newStreak >= 3) {
        setShowStreakBanner(true);
        setTimeout(() => setShowStreakBanner(false), 1200);
      }

      if (newEnemyHP <= 0) {
        setTimeout(() => endBattle(true), 800);
        return;
      }
    } else {
      setStreak(0);
      streakRef.current = 0;
      const [minDmg, maxDmg] = enemy.counterDmg;
      const dmg = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
      const newPlayerHP = Math.max(0, playerHPRef.current - dmg);
      setPlayerHP(newPlayerHP);
      addFloat(`-${dmg}`, '#ef4444', 'player');
      const reason = idx === null ? '⏰ Time out!' : '❌ Wrong!';
      addLog(`${reason} ${enemy.name} deals ${dmg} dmg!`);
      setEnemyAttacking(true);
      setTimeout(() => setEnemyAttacking(false), 400);
      setShake('player');
      setTimeout(() => setShake(null), 500);
      setStats(prev => {
        const next = {
          ...prev,
          wrong: prev.wrong + 1,
          totalQuestions: prev.totalQuestions + 1,
          damageTaken: prev.damageTaken + dmg
        };
        statsRef.current = next;
        return next;
      });

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

  useEffect(() => {
    const t = setTimeout(() => nextQuestion(), 2200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'result') return;
    const finalStats = statsRef.current;
    const xp = won ? enemy.xpReward : Math.floor(enemy.xpReward * 0.15);
    const gold = won ? enemy.goldReward : Math.floor(enemy.goldReward * 0.1);
    const t = setTimeout(() => onComplete(won, xp, gold, finalStats), 3500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const playerPct = Math.max(0, (playerHP / PLAYER_HP) * 100);
  const enemyPct = Math.max(0, (enemyHP / ENEMY_HP) * 100);
  const timerPct = question ? (timeLeft / question.timeLimit) * 100 : 100;
  const qProgress = MAX_QUESTIONS > 0 ? ((questionCount) / MAX_QUESTIONS) * 100 : 0;

  const hpColor = (pct: number) => pct > 60 ? '#10b981' : pct > 30 ? '#fbbf24' : '#ef4444';
  const label = streakLabel(streak);

  return (
    <div style={{
      position: 'relative', height: '100%',
      background: 'linear-gradient(180deg, #0a0f1e 0%, #0f172a 60%, #1a0530 100%)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: 'inherit', userSelect: 'none'
    }}>
      {/* Stars */}
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

      {/* Streak banner */}
      {showStreakBanner && label && (
        <div style={{
          position: 'absolute', top: '38%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, pointerEvents: 'none',
          fontSize: 20, fontWeight: 'bold', color: '#fbbf24',
          textShadow: '0 0 20px #fbbf24, 0 0 40px #f97316',
          animation: 'battleFloat 1.2s ease-out forwards',
          whiteSpace: 'nowrap'
        }}>
          {label}
        </div>
      )}

      {/* HP Bars */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px 6px', zIndex: 5, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#93c5fd', fontWeight: 'bold', fontSize: 12 }}>YOU</span>
            <span style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{playerHP} HP</span>
          </div>
          <div style={{ height: 10, background: '#1e293b', borderRadius: 5, overflow: 'hidden', border: '1px solid #334155' }}>
            <div style={{
              width: `${playerPct}%`, height: '100%',
              background: `linear-gradient(90deg, ${hpColor(playerPct)}, ${hpColor(playerPct)}aa)`,
              transition: 'width 0.4s ease, background 0.4s',
              boxShadow: `0 0 8px ${hpColor(playerPct)}`
            }} />
          </div>
        </div>

        <div style={{ color: '#475569', fontWeight: 'bold', fontSize: 14, alignSelf: 'center', flexShrink: 0 }}>VS</div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#fca5a5', fontWeight: 'bold', fontSize: 12 }}>{enemy.name.toUpperCase()}</span>
            <span style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{enemyHP} HP</span>
          </div>
          <div style={{ height: 10, background: '#1e293b', borderRadius: 5, overflow: 'hidden', border: '1px solid #334155', direction: 'rtl' }}>
            <div style={{
              width: `${enemyPct}%`, height: '100%',
              background: `linear-gradient(90deg, ${hpColor(enemyPct)}aa, ${hpColor(enemyPct)})`,
              transition: 'width 0.4s ease, background 0.4s',
              boxShadow: `0 0 8px ${hpColor(enemyPct)}`
            }} />
          </div>
        </div>
      </div>

      {/* Question progress bar */}
      <div style={{ padding: '0 16px 6px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: '#475569', fontSize: 10 }}>QUESTIONS</span>
          <span style={{ color: '#64748b', fontSize: 10 }}>Q {Math.min(questionCount + 1, MAX_QUESTIONS)}/{MAX_QUESTIONS}</span>
        </div>
        <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: `${qProgress}%`, height: '100%',
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
            transition: 'width 0.5s ease'
          }} />
        </div>
      </div>

      {/* Arena floor */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', alignItems: 'flex-start', paddingTop: 4, minHeight: 0, overflow: 'hidden' }}>
        {/* Player */}
        <div style={{
          position: 'absolute', left: '10%', bottom: 10,
          fontSize: 52, textAlign: 'center',
          transform: `${playerAttacking ? 'translateX(20px)' : ''} ${shake === 'player' ? 'translateX(-8px)' : ''}`,
          transition: 'transform 0.15s ease',
          filter: shake === 'player' ? 'drop-shadow(0 0 8px #ef4444)' : 'none'
        }}>
          🧙‍♂️
          <div style={{ fontSize: 10, color: '#93c5fd', marginTop: 2, fontWeight: 'bold' }}>YOU</div>
          {streak >= 3 && (
            <div style={{ fontSize: 9, color: '#fbbf24', fontWeight: 'bold' }}>🔥 x{streak}</div>
          )}
        </div>

        {/* Enemy */}
        <div style={{
          position: 'absolute', right: '10%', bottom: 10,
          fontSize: 68, textAlign: 'center',
          transform: `${enemyAttacking ? 'translateX(-20px)' : ''} ${shake === 'enemy' ? 'translateX(8px)' : ''}`,
          transition: 'transform 0.15s ease',
          filter: shake === 'enemy' ? 'drop-shadow(0 0 10px #ef4444)' : `drop-shadow(0 0 15px ${enemy.color}66)`,
          animation: phase === 'intro' ? 'enemyAppear 0.5s ease' : 'enemyFloat 3s ease-in-out infinite'
        }}>
          {enemy.avatar}
          <div style={{ fontSize: 10, color: '#fca5a5', marginTop: 2, fontWeight: 'bold' }}>{enemy.name}</div>
        </div>

        {/* Battle log */}
        <div style={{
          position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)',
          width: '35%', minWidth: 155, maxWidth: 250,
          display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none'
        }}>
          {log.map((msg, i) => (
            <div key={i} style={{
              background: 'rgba(0,0,0,0.65)', padding: '3px 7px', borderRadius: 6, fontSize: 10,
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
            flexDirection: 'column', gap: 10, background: 'rgba(0,0,0,0.55)', zIndex: 10,
            animation: 'fadeIn 0.3s ease'
          }}>
            <div style={{ fontSize: 15, color: '#94a3b8' }}>Battle vs</div>
            <div style={{ fontSize: 68 }}>{enemy.avatar}</div>
            <div style={{ fontSize: 26, fontWeight: 'bold', color: enemy.color }}>{enemy.name}</div>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>{enemy.title}</div>
            <div style={{
              fontSize: 38, fontWeight: 'black', color: '#ef4444', letterSpacing: 4,
              textShadow: '0 0 20px #ef4444', animation: 'pulse 0.5s ease infinite'
            }}>BATTLE!</div>
          </div>
        )}

        {/* RESULT */}
        {phase === 'result' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 10, background: 'rgba(0,0,0,0.75)', zIndex: 10,
            animation: 'fadeIn 0.4s ease'
          }}>
            <div style={{ fontSize: 76 }}>{won ? '🏆' : '💀'}</div>
            <div style={{
              fontSize: 34, fontWeight: 'black', letterSpacing: 3,
              color: won ? '#fbbf24' : '#ef4444',
              textShadow: `0 0 20px ${won ? '#fbbf24' : '#ef4444'}`
            }}>
              {won ? 'VICTORY!' : 'DEFEATED'}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', lineHeight: 1.9 }}>
              {statsRef.current.correct}/{statsRef.current.totalQuestions} correct
              {statsRef.current.highestStreak >= 3 && (
                <><br />🔥 Best streak: {statsRef.current.highestStreak}</>
              )}
              <br />
              {won
                ? `+${enemy.xpReward} XP  +${enemy.goldReward} 🪙`
                : `+${Math.floor(enemy.xpReward * 0.15)} XP  +${Math.floor(enemy.goldReward * 0.1)} 🪙`}
            </div>
          </div>
        )}
      </div>

      {/* Question area */}
      {(phase === 'question' || phase === 'feedback') && question && (
        <div style={{ padding: '8px 14px 14px', background: 'rgba(0,0,0,0.5)', borderTop: '1px solid #334155', flexShrink: 0 }}>
          {/* Timer */}
          <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden', marginBottom: 8, border: '1px solid #334155' }}>
            <div style={{
              width: `${timerPct}%`, height: '100%',
              background: timerPct > 50 ? '#10b981' : timerPct > 25 ? '#fbbf24' : '#ef4444',
              transition: 'width 1s linear, background 0.5s'
            }} />
          </div>

          {/* Question */}
          <div style={{
            background: '#1e293b', borderRadius: 10, padding: '10px 14px', marginBottom: 8,
            border: '1px solid #334155', textAlign: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: 'white', fontSize: 18, fontWeight: 'bold', whiteSpace: 'pre-line' }}>{question.text}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                fontSize: 18, fontWeight: 'bold', minWidth: 32, textAlign: 'center',
                color: timerPct > 50 ? '#10b981' : timerPct > 25 ? '#fbbf24' : '#ef4444'
              }}>
                {timeLeft}s
              </div>
              {streak >= 3 && (
                <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                  🔥+{streakBonus(streak)}
                </div>
              )}
            </div>
          </div>

          {/* Options */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
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
                    padding: '12px 8px', borderRadius: 10, fontSize: 16, fontWeight: 'bold',
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
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            fontSize: 10, color: '#475569', background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', padding: '2px 8px',
            textDecoration: 'underline', zIndex: 20
          }}
        >
          flee battle
        </button>
      )}
    </div>
  );
}
