import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserData, submitCurriculumRequest } from '@/lib/userService';

// ── Curriculum data ───────────────────────────────────────────────────────────

const SYSTEMS = [
  { id: 'igcse', label: 'IGCSE / O-Level', icon: '🇬🇧' },
  { id: 'bac',   label: 'French BAC',       icon: '🇫🇷' },
  { id: 'american', label: 'American (AP/Common Core)', icon: '🇺🇸' },
  { id: 'ib',    label: 'IB (International Baccalaureate)', icon: '🌍' },
  { id: 'other', label: 'Other / Not listed', icon: '📚' },
];

const YEARS: Record<string, string[]> = {
  igcse:    ['Year 7', 'Year 8', 'Year 9', 'Year 10 (IGCSE 1)', 'Year 11 (IGCSE 2)', 'Other'],
  bac:      ['Seconde', 'Première', 'Terminale', 'Other'],
  american: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9 (Freshman)', 'Grade 10 (Sophomore)', 'Grade 11 (Junior)', 'Grade 12 (Senior)', 'Other'],
  ib:       ['MYP Year 1', 'MYP Year 2', 'MYP Year 3', 'MYP Year 4', 'MYP Year 5', 'DP Year 1', 'DP Year 2', 'Other'],
  other:    [],
};

const TEXTBOOKS: Record<string, string[]> = {
  'igcse_Year 7':           ['Cambridge Lower Secondary Mathematics 7', 'Oxford International Maths 7'],
  'igcse_Year 8':           ['Cambridge Lower Secondary Mathematics 8', 'Oxford International Maths 8'],
  'igcse_Year 9':           ['Cambridge Lower Secondary Mathematics 9', 'Oxford International Maths 9'],
  'igcse_Year 10 (IGCSE 1)':['Cambridge IGCSE Mathematics Core & Extended', 'Oxford IGCSE Maths'],
  'igcse_Year 11 (IGCSE 2)':['Cambridge IGCSE Mathematics Core & Extended', 'Oxford IGCSE Maths'],
  'bac_Seconde':            ['Math Seconde (Nathan)', 'Math Seconde (Hachette)', 'Transmath Seconde'],
  'bac_Première':           ['Math Première (Spécialité Nathan)', 'Transmath Première'],
  'bac_Terminale':          ['Math Terminale (Spécialité Nathan)', 'Transmath Terminale'],
  'american_Grade 6':       ['Go Math! Grade 6', 'Envision Math 6', 'Big Ideas Math 6'],
  'american_Grade 7':       ['Go Math! Grade 7', 'Envision Math 7', 'Big Ideas Math 7'],
  'american_Grade 8':       ['Go Math! Grade 8', 'Envision Math 8', 'Big Ideas Math Pre-Algebra'],
  'american_Grade 9 (Freshman)':  ['Algebra I (Pearson)', 'Big Ideas Algebra 1', 'Glencoe Algebra 1'],
  'american_Grade 10 (Sophomore)':['Geometry (Pearson)', 'Big Ideas Geometry', 'Glencoe Geometry'],
  'american_Grade 11 (Junior)':   ['Algebra II (Pearson)', 'Pre-Calculus (Larson)'],
  'american_Grade 12 (Senior)':   ['AP Calculus AB/BC (Larson)', 'AP Statistics (BPS)'],
  'ib_MYP Year 1':  ['MYP Mathematics 1 (Haese)', 'MYP Mathematics 1 (OUP)'],
  'ib_MYP Year 2':  ['MYP Mathematics 2 (Haese)'],
  'ib_MYP Year 3':  ['MYP Mathematics 3 (Haese)'],
  'ib_MYP Year 4':  ['MYP Mathematics 4 (Haese)'],
  'ib_MYP Year 5':  ['MYP Mathematics 5 (Haese)'],
  'ib_DP Year 1':   ['Mathematics: Analysis & Approaches SL/HL (Haese)', 'Mathematics: Applications SL/HL (Haese)'],
  'ib_DP Year 2':   ['Mathematics: Analysis & Approaches SL/HL (Haese)', 'Mathematics: Applications SL/HL (Haese)'],
};

type Step = 'system' | 'year' | 'textbook' | 'custom' | 'done';

export default function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const { user, userData, refreshUserData } = useAuth();
  const [step, setStep] = useState<Step>('system');
  const [selectedSystem, setSelectedSystem] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [customText, setCustomText] = useState('');
  const [saving, setSaving] = useState(false);

  const years = selectedSystem ? YEARS[selectedSystem] ?? [] : [];
  const tbKey = `${selectedSystem}_${selectedYear}`;
  const textbooks = TEXTBOOKS[tbKey] ?? [];

  async function finish(textbook: string, isCustom = false) {
    if (!user || !userData) return;
    setSaving(true);
    const profile = {
      system: selectedSystem,
      year: selectedYear || 'Other',
      textbook,
      completedAt: new Date().toISOString(),
      ...(isCustom ? { customTextbook: textbook } : {})
    };
    if (isCustom) {
      await submitCurriculumRequest(user.uid, userData.username, {
        system: selectedSystem || 'other',
        year: selectedYear || 'Other',
        textbook,
      });
    }
    await updateUserData(user.uid, { curriculumProfile: profile, onboardingComplete: true });
    await refreshUserData();
    setSaving(false);
    setStep('done');
    setTimeout(onComplete, 1600);
  }

  const card: React.CSSProperties = {
    background: '#1e293b', borderRadius: 16, padding: '28px 24px',
    border: '2px solid #334155', maxWidth: 460, width: '100%',
    boxShadow: '0 10px 40px rgba(0,0,0,0.5)', animation: 'slideUp 0.35s ease'
  };

  const optBtn = (selected: boolean, accent: string): React.CSSProperties => ({
    width: '100%', padding: '13px 16px', borderRadius: 10, marginBottom: 8,
    textAlign: 'left', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
    background: selected ? `${accent}22` : 'rgba(0,0,0,0.3)',
    border: `2px solid ${selected ? accent : '#334155'}`,
    color: selected ? '#e2e8f0' : '#94a3b8', fontWeight: selected ? 'bold' : 'normal',
    transition: 'all 0.15s'
  });

  if (step === 'done') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0f172a' }}>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 14 }}>🎉</div>
          <h2 style={{ color: 'white', margin: '0 0 8px' }}>You're all set!</h2>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Your curriculum profile has been saved. Welcome to Logic Lords!</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: 20, flexDirection: 'column', gap: 16
    }}>
      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['system', 'year', 'textbook'] as Step[]).map((s, i) => {
          const steps: Step[] = ['system', 'year', 'textbook', 'custom'];
          const idx = steps.indexOf(step);
          const done = i < idx || (step === 'custom' && i <= 2);
          const current = steps[i] === step;
          return (
            <div key={s} style={{
              width: current ? 28 : 10, height: 10, borderRadius: 5, transition: 'all 0.3s',
              background: done ? '#10b981' : current ? '#3b82f6' : '#334155'
            }} />
          );
        })}
      </div>

      <div style={card}>
        <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontWeight: 'bold' }}>
          {step === 'system' ? 'Step 1 of 3' : step === 'year' ? 'Step 2 of 3' : 'Step 3 of 3'}
        </div>

        {/* ── STEP 1: Education system ── */}
        {step === 'system' && (
          <>
            <h2 style={{ color: 'white', margin: '0 0 6px', fontSize: 20 }}>🎓 What's your education system?</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 20px' }}>
              This helps us personalise your learning map.
            </p>
            {SYSTEMS.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSystem(s.id)}
                style={optBtn(selectedSystem === s.id, '#3b82f6')}
              >
                {s.icon} {s.label}
              </button>
            ))}
            <button
              disabled={!selectedSystem}
              onClick={() => {
                if (selectedSystem === 'other') finish('Not specified', false);
                else setStep('year');
              }}
              className="ll-btn ll-btn-primary"
              style={{ width: '100%', marginTop: 8, padding: '13px', opacity: selectedSystem ? 1 : 0.4 }}
            >
              Continue →
            </button>
          </>
        )}

        {/* ── STEP 2: Year ── */}
        {step === 'year' && (
          <>
            <button onClick={() => setStep('system')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, marginBottom: 10, padding: 0, fontFamily: 'inherit' }}>
              ← Back
            </button>
            <h2 style={{ color: 'white', margin: '0 0 6px', fontSize: 20 }}>📅 Which year are you in?</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 20px' }}>
              Select your current year or grade.
            </p>
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                style={optBtn(selectedYear === y, '#10b981')}
              >
                {y}
              </button>
            ))}
            <button
              disabled={!selectedYear}
              onClick={() => {
                if (selectedYear === 'Other') setStep('custom');
                else {
                  const tbs = TEXTBOOKS[`${selectedSystem}_${selectedYear}`];
                  if (!tbs || tbs.length === 0) setStep('custom');
                  else setStep('textbook');
                }
              }}
              className="ll-btn ll-btn-primary"
              style={{ width: '100%', marginTop: 8, padding: '13px', opacity: selectedYear ? 1 : 0.4 }}
            >
              Continue →
            </button>
          </>
        )}

        {/* ── STEP 3: Textbook ── */}
        {step === 'textbook' && (
          <>
            <button onClick={() => setStep('year')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, marginBottom: 10, padding: 0, fontFamily: 'inherit' }}>
              ← Back
            </button>
            <h2 style={{ color: 'white', margin: '0 0 6px', fontSize: 20 }}>📘 Select your main textbook</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 20px' }}>
              Each textbook maps to a dedicated program.
            </p>
            {textbooks.map(t => (
              <button
                key={t}
                onClick={() => setSelectedTextbook(t)}
                style={optBtn(selectedTextbook === t, '#f97316')}
              >
                📖 {t}
              </button>
            ))}
            <button
              onClick={() => setStep('custom')}
              style={optBtn(false, '#475569')}
            >
              📝 My book isn't listed
            </button>
            <button
              disabled={!selectedTextbook || saving}
              onClick={() => finish(selectedTextbook)}
              className="ll-btn ll-btn-primary"
              style={{ width: '100%', marginTop: 8, padding: '13px', opacity: selectedTextbook ? 1 : 0.4 }}
            >
              {saving ? 'Saving...' : 'Finish Setup →'}
            </button>
          </>
        )}

        {/* ── Custom book ── */}
        {step === 'custom' && (
          <>
            <button onClick={() => setStep(textbooks.length > 0 ? 'textbook' : 'year')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, marginBottom: 10, padding: 0, fontFamily: 'inherit' }}>
              ← Back
            </button>
            <h2 style={{ color: 'white', margin: '0 0 6px', fontSize: 20 }}>📝 Tell us your textbook</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 20px' }}>
              Enter the name of your book. We'll work to add it to Logic Lords soon!
            </p>
            <input
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              placeholder="e.g. Pearson Edexcel GCSE Maths Higher"
              style={{
                width: '100%', padding: '12px 14px', marginBottom: 12,
                borderRadius: 8, border: '1px solid #475569',
                background: 'rgba(0,0,0,0.4)', color: 'white',
                boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none'
              }}
            />
            <div style={{
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#fde68a', lineHeight: 1.5
            }}>
              ℹ️ Your request will be sent to our team. We'll notify you once your book program is ready. You can still use all features in the meantime!
            </div>
            <button
              disabled={!customText.trim() || saving}
              onClick={() => finish(customText.trim(), true)}
              className="ll-btn ll-btn-primary"
              style={{ width: '100%', padding: '13px', opacity: customText.trim() ? 1 : 0.4 }}
            >
              {saving ? 'Sending request...' : 'Submit & Continue →'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
