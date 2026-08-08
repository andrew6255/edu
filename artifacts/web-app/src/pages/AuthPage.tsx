import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { requireSupabase } from '@/lib/supabase';
import {
  createUserData, isUsernameTaken, getUserData, requestGuardianConsent
} from '@/lib/userService';
import { loginWithIdentifier } from '@/lib/authApiService';
import { useAuth } from '@/contexts/AuthContext';
import {
  getRememberedAccounts, removeRememberedAccount, switchToRememberedAccount, RememberedAccount
} from '@/lib/authService';

type AccountType = 'student' | 'teacher' | 'parent';

// Google OAuth is a redirect: the page reloads on return, so the account type
// chosen before leaving has to survive somewhere other than component state.
const PENDING_ROLE_KEY = 'll_pending_signup_role';

function formatAuthError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown };
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message.trim()) parts.push(e.message.trim());
    if (typeof e.code === 'string' && e.code.trim()) parts.push(`(${e.code.trim()})`);
    if (parts.length > 0) return parts.join(' ');
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

async function generateUniqueUsername(base: string): Promise<string> {
  const clean = base.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 18) || 'user';
  if (!(await isUsernameTaken(clean))) return clean;
  for (let i = 0; i < 10; i++) {
    const candidate = `${clean}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await isUsernameTaken(candidate))) return candidate;
  }
  return `${clean}${Date.now().toString().slice(-6)}`;
}

function googleErrorMessage(code: string): string {
  switch (code) {
    case 'validation_failed':
      return 'Google Sign-In is not enabled or configured correctly in Supabase Auth.';
    case 'popup_closed_by_user':
      return 'Sign-in popup was closed. Please try again.';
    case 'popup_blocked':
      return '';
    default:
      return 'Google Sign-In failed. Please try again.';
  }
}

function ageOnDate(birthDate: string, today = new Date()): number | null {
  const birth = new Date(`${birthDate}T00:00:00`);
  if (!birthDate || Number.isNaN(birth.getTime()) || birth > today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const month = today.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function readPendingRole(): AccountType {
  try {
    const stored = localStorage.getItem(PENDING_ROLE_KEY);
    if (stored === 'student' || stored === 'teacher' || stored === 'parent') return stored;
  } catch { /* localStorage unavailable */ }
  return 'student';
}

const ACCOUNT_TYPE_STYLE: Record<AccountType, { rgb: string; text: string; label: string }> = {
  student: { rgb: '59,130,246', text: '#93c5fd', label: '🎓 Student' },
  teacher: { rgb: '16,185,129', text: '#6ee7b7', label: '🧑‍🏫 Teacher' },
  parent: { rgb: '236,72,153', text: '#f9a8d4', label: '👨‍👩‍👧 Parent' },
};

export default function AuthPage() {
  const { user, userData, loading, refreshUserData } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [rememberedAccounts, setRememberedAccounts] = useState<RememberedAccount[]>(() => getRememberedAccounts());
  const [showRememberedView, setShowRememberedView] = useState<boolean>(() => getRememberedAccounts().length > 0);
  const [switchingUid, setSwitchingUid] = useState<string | null>(null);

  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');

  const [fname, setFname] = useState('');
  const [lname, setLname] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('student');
  const [birthDate, setBirthDate] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');

  // Set once Google OAuth returns with a brand-new auth user (no profile row
  // yet): Google only ever gives us an email and a display name, so username
  // and (for students) birthdate still have to be collected before the
  // account is actually created.
  const [googleCompletion, setGoogleCompletion] = useState<{ uid: string; email: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register') setMode('register');
  }, []);

  useEffect(() => {
    setGoogleLoading(false);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (userData) return;
    if (googleCompletion) return;

    let active = true;

    (async () => {
      try {
        const supabase = requireSupabase();
        const { data } = await supabase.auth.getUser();
        const authUser = data.user;
        if (!authUser || !active) return;

        const existing = await getUserData(authUser.id);
        if (existing) {
          if (active) await refreshUserData();
          return;
        }

        const meta = authUser.user_metadata && typeof authUser.user_metadata === 'object'
          ? (authUser.user_metadata as Record<string, unknown>)
          : {};
        const displayName = typeof meta.full_name === 'string'
          ? meta.full_name
          : (typeof meta.name === 'string' ? meta.name : '');
        const parts = displayName.trim().split(/\s+/).filter(Boolean);
        const suggestedUsername = await generateUniqueUsername(parts.join('') || (authUser.email ?? 'user').split('@')[0]);
        if (!active) return;

        setFname(parts[0] || '');
        setLname(parts.slice(1).join(' ') || '');
        setUsername(suggestedUsername);
        setAccountType(readPendingRole());
        setBirthDate('');
        setGuardianEmail('');
        setGoogleCompletion({ uid: authUser.id, email: authUser.email ?? '' });
      } catch (e) {
        console.error('Failed to prepare Google sign-up:', e);
      }
    })();

    return () => {
      active = false;
    };
  }, [loading, user, userData, refreshUserData, googleCompletion]);

  useEffect(() => {
    if (!loading && user && userData) {
      switch (userData.role) {
        case 'superadmin': setLocation('/superadmin'); break;
        case 'admin': setLocation('/admin'); break;
        case 'teacher': setLocation('/teacher'); break;
        case 'teacher_assistant': setLocation('/ta'); break;
        case 'parent': setLocation('/parent'); break;
        default: setLocation('/app'); break;
      }
    }
  }, [user, userData, loading]);

  async function handleLogin() {
    if (!loginId || !loginPass) return setError('Please fill in all fields.');

    setSubmitting(true); setError('');

    let success = false;
    try {
      await loginWithIdentifier(loginId.trim(),loginPass);

      success = true;
      // The useEffect listener on user and userData will handle the client-side routing.
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'invalid_credentials' || code === 'user_not_found' || code === 'invalid_grant') {
        setError('Incorrect email/username or password.');
      } else {
        setError(formatAuthError(e, 'Login failed'));
      }
    } finally {
      if (!success) setSubmitting(false);
    }
  }

  async function handleRegister() {
    if (!fname || !lname || !username || !email || !pass) return setError('Please fill in all required fields.');
    let age: number | null = null;
    if (accountType === 'student') {
      age = ageOnDate(birthDate);
      if (age === null) return setError('Enter a valid date of birth.');
    }
    const needsGuardianConsent = accountType === 'student' && age !== null && age < 18;
    if (needsGuardianConsent && !/^\S+@\S+\.\S+$/.test(guardianEmail.trim())) return setError('Enter a valid parent or guardian email.');
    if (pass !== confirm) return setError('Passwords do not match.');
    if (pass.length < 8) return setError('Password must be at least 8 characters.');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return setError('Username can only contain letters, numbers and underscores.');
    setSubmitting(true); setError('');
    try {
      const supabase = requireSupabase();
      const taken = await isUsernameTaken(username);
      if (taken) { setError('Username is already taken.'); return; }
      const { data, error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: { data: { full_name: `${fname} ${lname}`.trim(), name: username, pending_role: accountType } },
      });
      if (error) throw error;
      const authUser = data.user;
      if (!authUser) throw new Error('Registration returned no user.');
      await createUserData(authUser.id, {
        firstName: fname, lastName: lname, username, email,
        role: accountType,
        onboardingComplete: true,
        birthDate: accountType === 'student' ? birthDate : undefined,
        countryCode: 'EG',
        guardianConsentStatus: needsGuardianConsent ? 'pending' : 'not_required',
      });
      if (needsGuardianConsent) await requestGuardianConsent(authUser.id, guardianEmail);
      // The useEffect listener on user and userData takes it from here and
      // routes straight into the new account's panel.
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'user_already_exists' || code === 'email_exists') {
        setError('An account with this email already exists. Sign in or use password recovery.');
      } else {
        setError(formatAuthError(e, 'Registration failed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinishGoogleSignup() {
    if (!googleCompletion) return;
    if (!fname || !lname || !username) return setError('Please fill in all required fields.');
    let age: number | null = null;
    if (accountType === 'student') {
      age = ageOnDate(birthDate);
      if (age === null) return setError('Enter a valid date of birth.');
    }
    const needsGuardianConsent = accountType === 'student' && age !== null && age < 18;
    if (needsGuardianConsent && !/^\S+@\S+\.\S+$/.test(guardianEmail.trim())) return setError('Enter a valid parent or guardian email.');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return setError('Username can only contain letters, numbers and underscores.');
    setSubmitting(true); setError('');
    try {
      const taken = await isUsernameTaken(username);
      if (taken) { setError('Username is already taken.'); return; }
      await createUserData(googleCompletion.uid, {
        firstName: fname, lastName: lname, username, email: googleCompletion.email,
        role: accountType,
        onboardingComplete: true,
        birthDate: accountType === 'student' ? birthDate : undefined,
        countryCode: 'EG',
        guardianConsentStatus: needsGuardianConsent ? 'pending' : 'not_required',
      });
      if (needsGuardianConsent) await requestGuardianConsent(googleCompletion.uid, guardianEmail);
      try { localStorage.removeItem(PENDING_ROLE_KEY); } catch { /* ignore */ }
      setGoogleCompletion(null);
      await refreshUserData();
    } catch (e: unknown) {
      setError(formatAuthError(e, 'Could not finish creating your account'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setSubmitting(true); setError('');
    try {
      try {
        if (mode === 'register') localStorage.setItem(PENDING_ROLE_KEY, accountType);
        else localStorage.removeItem(PENDING_ROLE_KEY);
      } catch { /* ignore */ }
      const supabase = requireSupabase();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + import.meta.env.BASE_URL + 'auth' },
      });
      if (error) throw error;
      if (data.url) {
        window.location.href = data.url;
        return;
      }
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      const msg = googleErrorMessage(code);
      if (msg) setError(msg);
    }
    setSubmitting(false);
  }

  const isLoading = submitting || googleLoading;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', marginBottom: 10,
    borderRadius: 8, border: '1px solid #475569',
    background: 'rgba(0,0,0,0.5)', color: 'white',
    boxSizing: 'border-box', fontSize: 14,
    fontFamily: 'inherit', outline: 'none', transition: '0.2s'
  };

  function renderAccountTypePicker() {
    return (
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['student', 'teacher', 'parent'] as const).map(t => {
          const style = ACCOUNT_TYPE_STYLE[t];
          return (
            <button
              key={t}
              onClick={() => setAccountType(t)}
              style={{
                flex: 1, padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 'bold',
                cursor: 'pointer', fontFamily: 'inherit', transition: '0.2s',
                background: accountType === t ? `rgba(${style.rgb},0.2)` : 'transparent',
                border: accountType === t ? `1px solid rgba(${style.rgb},0.5)` : '1px solid #334155',
                color: accountType === t ? style.text : '#64748b'
              }}
            >
              {style.label}
            </button>
          );
        })}
      </div>
    );
  }

  function renderBirthDateFields() {
    if (accountType !== 'student') return null;
    return (
      <>
        <label style={{ display: 'block', textAlign: 'left', color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Date of birth</label>
        <input style={inputStyle} type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setBirthDate(e.target.value)} />
        {ageOnDate(birthDate) !== null && (ageOnDate(birthDate) as number) < 18 && (
          <>
            <input style={inputStyle} type="email" placeholder="Parent or guardian email" value={guardianEmail} onChange={e => setGuardianEmail(e.target.value.trim())} />
            <div style={{ color: '#fbbf24', fontSize: 11, textAlign: 'left', margin: '-4px 0 10px' }}>Guardian approval will be required for protected account features.</div>
          </>
        )}
      </>
    );
  }

  return (
    <div style={{
      background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: 20
    }}>
      <div style={{
        background: '#1e293b', padding: 32, borderRadius: 16,
        border: '2px solid #334155', boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        maxWidth: 420, width: '100%', textAlign: 'center',
        maxHeight: '92vh', overflowY: 'auto', animation: 'slideUp 0.4s ease'
      }}>
        <div style={{ fontSize: 34, marginBottom: 7 }}>🌌</div>
        <h1 style={{ margin: '0 0 4px', color: 'white', fontSize: 23, textShadow: '0 0 10px rgba(59,130,246,0.4)' }}>
          LOGIC LORDS
        </h1>
        <p style={{ color: '#94a3b8', marginBottom: 20, fontSize: 13 }}>
          {googleCompletion
            ? 'Just a few more details to finish creating your account'
            : (showRememberedView && rememberedAccounts.length > 0
              ? 'Select an account to sign in instantly on this device'
              : (mode === 'login' ? 'Sign in to your account' : 'Create your account'))}
        </p>

        {error && (
          <div style={{
            color: '#fca5a5', fontSize: 13, marginBottom: 14, padding: '10px 14px',
            background: 'rgba(239,68,68,0.1)', borderRadius: 8,
            border: '1px solid rgba(239,68,68,0.3)', textAlign: 'left', lineHeight: 1.5
          }}>
            {error}
          </div>
        )}

        {googleCompletion ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'left', marginBottom: 10 }}>
              Signed in as <strong style={{ color: 'white' }}>{googleCompletion.email}</strong>
            </div>
            {renderAccountTypePicker()}
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inputStyle, flex: 1, marginRight: 0 }} placeholder="First Name" value={fname} onChange={e => setFname(e.target.value)} />
              <input style={{ ...inputStyle, flex: 1 }} placeholder="Last Name" value={lname} onChange={e => setLname(e.target.value)} />
            </div>
            <input style={inputStyle} placeholder="Username (letters, numbers, _)" value={username} onChange={e => setUsername(e.target.value.toLowerCase().trim())} />
            {renderBirthDateFields()}
            <button
              className="ll-btn ll-btn-primary"
              style={{ width: '100%', padding: '13px', fontSize: 15, marginBottom: 8 }}
              onClick={handleFinishGoogleSignup} disabled={isLoading}
            >
              {submitting ? 'Finishing...' : 'FINISH SIGNING UP'}
            </button>
          </div>
        ) : showRememberedView && rememberedAccounts.length > 0 ? (
          <div style={{ textAlign: 'left', animation: 'slideUp 0.3s ease' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {rememberedAccounts.map((acc) => {
                const isSwitching = switchingUid === acc.uid;
                const roleEmoji =
                  acc.role === 'superadmin' ? '👑' :
                  acc.role === 'admin' ? '🛡️' :
                  acc.role === 'teacher' ? '👨‍🏫' :
                  acc.role === 'teacher_assistant' ? '🤖' :
                  acc.role === 'parent' ? '👪' : '🎓';

                return (
                  <div
                    key={acc.uid}
                    style={{
                      background: isSwitching ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0, 0, 0, 0.4)',
                      border: isSwitching ? '1px solid #3b82f6' : '1px solid #334155',
                      borderRadius: 12,
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s ease',
                      cursor: isSwitching ? 'wait' : 'pointer',
                    }}
                    onClick={async () => {
                      if (isSwitching) return;
                      setSwitchingUid(acc.uid);
                      setError('');
                      const res = await switchToRememberedAccount(acc);
                      if (res.success) {
                        const routeMap: Record<string, string> = {
                          superadmin: '/superadmin',
                          admin: '/admin',
                          teacher: '/teacher',
                          teacher_assistant: '/ta',
                          parent: '/parent',
                        };
                        const targetRoute = routeMap[acc.role] || '/app';
                        const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
                        window.location.href = `${window.location.origin}${baseUrl}${targetRoute}`;
                      } else {
                        setSwitchingUid(null);
                        setError(`Session expired for ${acc.fullName}. Please enter password.`);
                        setLoginId(acc.email || '');
                        setShowRememberedView(false);
                        setMode('login');
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: '50%',
                        background: '#3b82f6', color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, fontWeight: 'bold', flexShrink: 0
                      }}>
                        {acc.avatarUrl ? (
                          <img src={acc.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          roleEmoji
                        )}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {acc.fullName}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ textTransform: 'capitalize' }}>{acc.role.replace('_', ' ')}</span>
                          <span>•</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.email}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {isSwitching ? (
                        <span style={{ color: '#3b82f6', fontSize: 12, fontWeight: 600 }}>Signing in...</span>
                      ) : (
                        <>
                          <span style={{ color: '#3b82f6', fontSize: 16, fontWeight: 'bold' }}>→</span>
                          <button
                            title="Remove account from this device"
                            style={{
                              background: 'transparent', border: 'none', color: '#64748b',
                              padding: 6, borderRadius: 6, cursor: 'pointer', fontSize: 14,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.2s'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const updated = removeRememberedAccount(acc.uid);
                              setRememberedAccounts(updated);
                              if (updated.length === 0) {
                                setShowRememberedView(false);
                              }
                            }}
                            onMouseOver={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                            onMouseOut={(e) => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.background = 'transparent'; }}
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => {
                setShowRememberedView(false);
                setError('');
              }}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.05)', border: '1px dashed #475569',
                color: '#e2e8f0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.borderColor = '#3b82f6'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; e.currentTarget.style.borderColor = '#475569'; }}
            >
              <span>+</span> Use another account
            </button>
          </div>
        ) : (
          <div>
            {!showRememberedView && rememberedAccounts.length > 0 && (
              <button
                onClick={() => {
                  setShowRememberedView(true);
                  setError('');
                }}
                style={{
                  background: 'transparent', border: 'none', color: '#38bdf8',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 16,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  textDecoration: 'underline'
                }}
              >
                ← Back to remembered accounts
              </button>
            )}

            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {(['login', 'register'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(''); }}
                  style={{
                    flex: 1, padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 'bold',
                    cursor: 'pointer', fontFamily: 'inherit', transition: '0.2s',
                    background: mode === m ? 'rgba(59,130,246,0.2)' : 'transparent',
                    border: mode === m ? '1px solid rgba(59,130,246,0.5)' : '1px solid #334155',
                    color: mode === m ? '#93c5fd' : '#64748b'
                  }}
                >
                  {m === 'login' ? 'Log In' : 'Register'}
                </button>
              ))}
            </div>

            {mode === 'register' && renderAccountTypePicker()}

            <button
              onClick={handleGoogle}
              disabled={isLoading}
              style={{
                background: isLoading ? '#e5e7eb' : 'white',
                color: '#1e293b', border: 'none',
                borderRadius: 8, padding: '12px 20px', width: '100%',
                fontSize: 15, fontWeight: 'bold', cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                fontFamily: 'inherit', transition: '0.2s', marginBottom: 4,
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              {googleLoading ? 'Checking...' : 'Continue with Google'}
            </button>

            <p style={{ color: '#475569', fontSize: 11, margin: '4px 0 16px', textAlign: 'center' }}>
              {mode === 'register'
                ? `Creates a ${ACCOUNT_TYPE_STYLE[accountType].label.replace(/^\S+\s/, '')} account. You'll add a username${accountType === 'student' ? ' and date of birth' : ''} next.`
                : 'Signs in with your existing account.'}
            </p>

            <div style={{ margin: '0 0 16px', color: '#475569', fontSize: 12, fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, borderBottom: '1px solid #334155' }} />
              <span style={{ padding: '0 12px' }}>OR USE EMAIL</span>
              <div style={{ flex: 1, borderBottom: '1px solid #334155' }} />
            </div>

            {mode === 'login' ? (
              <div>
                <input
                  style={inputStyle} placeholder="Email or Username"
                  value={loginId} onChange={e => setLoginId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                />
                <input
                  style={inputStyle} type="password" placeholder="Password"
                  value={loginPass} onChange={e => setLoginPass(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                />
                <button
                  className="ll-btn ll-btn-primary"
                  style={{ width: '100%', padding: '13px', fontSize: 15, marginBottom: 8 }}
                  onClick={handleLogin} disabled={isLoading}
                >
                  {submitting ? 'Signing in...' : 'LOG IN'}
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{ ...inputStyle, flex: 1, marginRight: 0 }} placeholder="First Name" value={fname} onChange={e => setFname(e.target.value)} />
                  <input style={{ ...inputStyle, flex: 1 }} placeholder="Last Name" value={lname} onChange={e => setLname(e.target.value)} />
                </div>
                <input style={inputStyle} placeholder="Username (letters, numbers, _)" value={username} onChange={e => setUsername(e.target.value.toLowerCase().trim())} />
                <input style={inputStyle} type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value.trim())} />
                {renderBirthDateFields()}
                <input style={inputStyle} type="password" placeholder="Password (min 6 chars)" value={pass} onChange={e => setPass(e.target.value)} />
                <input style={inputStyle} type="password" placeholder="Confirm Password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRegister()} />
                <button
                  className="ll-btn ll-btn-primary"
                  style={{ width: '100%', padding: '13px', fontSize: 15, marginBottom: 8 }}
                  onClick={handleRegister} disabled={isLoading}
                >
                  {submitting ? 'Creating account...' : 'CREATE ACCOUNT'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
