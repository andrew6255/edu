import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { requireSupabase, getAdminClient } from '@/lib/supabase';
import {
  findUserByUsername, createUserData, isUsernameTaken, getUserData
} from '@/lib/userService';
import { useAuth } from '@/contexts/AuthContext';

const SA_ADMIN_EMAIL = 'god.bypass@internal.app';

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

async function ensureSuperadminProfile(uid: string): Promise<void> {
  const existing = await getUserData(uid);
  if (!existing) {
    await createUserData(uid, {
      firstName: 'God',
      lastName: 'Admin',
      username: 'superadmin',
      email: SA_ADMIN_EMAIL,
      role: 'superadmin',
      onboardingComplete: true,
    });
    return;
  }

  if (existing.role !== 'superadmin' || existing.onboardingComplete !== true || existing.username !== 'superadmin') {
    const { updateUserData } = await import('@/lib/userService');
    await updateUserData(uid, {
      role: 'superadmin',
      onboardingComplete: true,
      username: 'superadmin',
      email: SA_ADMIN_EMAIL,
    });
  }
}

async function ensureUserDoc(authUser: {
  uid: string;
  displayName: string | null;
  email: string | null;
}, role: 'student' | 'superadmin' = 'student', onboardingComplete = true) {
  const existing = await getUserData(authUser.uid);
  if (!existing) {
    const rawName = authUser.displayName || 'LogicLord';
    const parts = rawName.split(' ');
    const username = await generateUniqueUsername(rawName.replace(/\s+/g, ''));
    await createUserData(authUser.uid, {
      firstName: parts[0] || rawName,
      lastName: parts.slice(1).join(' ') || '',
      username,
      email: authUser.email || '',
      role,
      onboardingComplete,
    });
  }
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

export default function AuthPage() {
  const { user, userData, loading, refreshUserData } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');

  const [fname, setFname] = useState('');
  const [lname, setLname] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accountType, setAccountType] = useState<'student' | 'parent'>('student');

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

    let active = true;

    (async () => {
      try {
        const supabase = requireSupabase();
        const { data } = await supabase.auth.getUser();
        const authUser = data.user;
        if (!authUser || !active) return;
        const meta = authUser.user_metadata && typeof authUser.user_metadata === 'object'
          ? (authUser.user_metadata as Record<string, unknown>)
          : {};
        const displayName = typeof meta.full_name === 'string'
          ? meta.full_name
          : (typeof meta.name === 'string' ? meta.name : null);
        await ensureUserDoc({
          uid: authUser.id,
          displayName,
          email: authUser.email ?? '',
        });
        if (active) await refreshUserData();
      } catch (e) {
        console.error('Failed to ensure Supabase user profile:', e);
      }
    })();

    return () => {
      active = false;
    };
  }, [loading, user, userData, refreshUserData]);

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

    // Hardcoded Super Admin Login Bypass (Maps 0000/0000 to internal admin account)
    if (loginId === '0000' && loginPass === '0000') {
      try {
        const supabase = requireSupabase();
        const { error } = await supabase.auth.signInWithPassword({
          email: SA_ADMIN_EMAIL,
          password: 'godadmin0000',
        });
        if (error) {
          const code = (error as { code?: string })?.code || '';
          if (code === 'invalid_credentials' || code === 'email_not_confirmed' || code === 'invalid_grant') {
            const { error: signUpError } = await supabase.auth.signUp({
              email: SA_ADMIN_EMAIL,
              password: 'godadmin0000',
              options: { data: { full_name: 'SuperAdmin', name: 'SuperAdmin' } },
            });
            if (signUpError) throw signUpError;
          } else {
            throw error;
          }
        }
        return;
      } catch (e: unknown) {
        setError('Super Admin login failed: ' + formatAuthError(e, 'Unknown error'));
        return;
      } finally {
        setSubmitting(false);
      }
    }
    try {
      const supabase = requireSupabase();
      let loginEmail = loginId.trim();
      if (!loginId.includes('@')) {
        const found = await findUserByUsername(loginId.toLowerCase().trim());
        if (!found) { setError('Username not found.'); return; }
        loginEmail = found.email;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPass });
      if (error) throw error;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'invalid_credentials' || code === 'user_not_found' || code === 'invalid_grant') {
        setError('Incorrect email/username or password.');
      } else {
        setError(formatAuthError(e, 'Login failed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister() {
    if (!fname || !lname || !username || !email || !pass) return setError('Please fill in all required fields.');
    if (pass !== confirm) return setError('Passwords do not match.');
    if (pass.length < 6) return setError('Password must be at least 6 characters.');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return setError('Username can only contain letters, numbers and underscores.');
    setSubmitting(true); setError('');
    try {
      const supabase = requireSupabase();
      const taken = await isUsernameTaken(username);
      if (taken) { setError('Username is already taken.'); return; }
      const { data, error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: { data: { full_name: `${fname} ${lname}`.trim(), name: username } },
      });
      if (error) throw error;
      const authUser = data.user;
      if (!authUser) throw new Error('Registration returned no user.');
      await createUserData(authUser.id, {
        firstName: fname, lastName: lname, username, email,
        role: accountType,
        onboardingComplete: true,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'user_already_exists' || code === 'email_exists') {
        // Ghost user: auth entry exists but profile was admin-deleted.
        // Use admin client to find & delete the ghost, then retry signup.
        try {
          const admin = getAdminClient();
          // Find the ghost auth user by email
          const { data: listData } = await admin.auth.admin.listUsers();
          const ghost = listData?.users?.find((u: { email?: string }) => u.email === email);
          if (ghost) {
            // Verify there's no profile (truly a ghost)
            const existing = await getUserData(ghost.id);
            if (existing) {
              setError('An account with this email already exists.');
              return;
            }
            // Delete the ghost auth entry
            await admin.auth.admin.deleteUser(ghost.id);
            // Retry signup
            const supabase = requireSupabase();
            const { data: retryData, error: retryError } = await supabase.auth.signUp({
              email,
              password: pass,
              options: { data: { full_name: `${fname} ${lname}`.trim(), name: username } },
            });
            if (retryError) throw retryError;
            const authUser = retryData.user;
            if (!authUser) throw new Error('Registration returned no user.');
            await createUserData(authUser.id, {
              firstName: fname, lastName: lname, username, email,
              role: accountType,
              onboardingComplete: true,
            });
            return;
          }
          setError('An account with this email already exists.');
        } catch (retryErr) {
          console.error('Ghost user cleanup failed:', retryErr);
          setError('An account with this email already exists.');
        }
      } else {
        setError(formatAuthError(e, 'Registration failed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setSubmitting(true); setError('');
    try {
      const supabase = requireSupabase();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/auth' },
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
          {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
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
          New to Logic Lords? Google Sign-In creates a student account automatically.
        </p>

        <div style={{ margin: '0 0 16px', color: '#475569', fontSize: 12, fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, borderBottom: '1px solid #334155' }} />
          <span style={{ padding: '0 12px' }}>OR USE EMAIL</span>
          <div style={{ flex: 1, borderBottom: '1px solid #334155' }} />
        </div>

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
            {/* Account type selector */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['student', 'parent'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setAccountType(t)}
                  style={{
                    flex: 1, padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 'bold',
                    cursor: 'pointer', fontFamily: 'inherit', transition: '0.2s',
                    background: accountType === t ? (t === 'student' ? 'rgba(59,130,246,0.2)' : 'rgba(236,72,153,0.2)') : 'transparent',
                    border: accountType === t ? `1px solid ${t === 'student' ? 'rgba(59,130,246,0.5)' : 'rgba(236,72,153,0.5)'}` : '1px solid #334155',
                    color: accountType === t ? (t === 'student' ? '#93c5fd' : '#f9a8d4') : '#64748b'
                  }}
                >
                  {t === 'student' ? '🎓 Student' : '👨\u200d👩\u200d👧 Parent'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inputStyle, flex: 1, marginRight: 0 }} placeholder="First Name" value={fname} onChange={e => setFname(e.target.value)} />
              <input style={{ ...inputStyle, flex: 1 }} placeholder="Last Name" value={lname} onChange={e => setLname(e.target.value)} />
            </div>
            <input style={inputStyle} placeholder="Username (letters, numbers, _)" value={username} onChange={e => setUsername(e.target.value.toLowerCase().trim())} />
            <input style={inputStyle} type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value.trim())} />
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
    </div>
  );
}
