import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider, signInWithCustomToken
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  findUserByUsername, createUserData, isUsernameTaken, getUserData
} from '@/lib/userService';
import { useAuth } from '@/contexts/AuthContext';

const SA_FIREBASE_EMAIL = 'god.bypass@internal.app';

async function generateUniqueUsername(base: string): Promise<string> {
  const clean = base.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 18) || 'user';
  if (!(await isUsernameTaken(clean))) return clean;
  for (let i = 0; i < 10; i++) {
    const candidate = `${clean}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await isUsernameTaken(candidate))) return candidate;
  }
  return `${clean}${Date.now().toString().slice(-6)}`;
}

async function ensureGoogleUserDoc(firebaseUser: {
  uid: string;
  displayName: string | null;
  email: string | null;
}) {
  const existing = await getUserData(firebaseUser.uid);
  if (!existing) {
    const rawName = firebaseUser.displayName || 'LogicLord';
    const parts = rawName.split(' ');
    const username = await generateUniqueUsername(rawName.replace(/\s+/g, ''));
    await createUserData(firebaseUser.uid, {
      firstName: parts[0] || rawName,
      lastName: parts.slice(1).join(' ') || '',
      username,
      email: firebaseUser.email || '',
      role: 'student',
      onboardingComplete: false,
    });
  }
}

function googleErrorMessage(code: string): string {
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'Google Sign-In is not enabled in this Firebase project. Enable it in Firebase Console → Authentication → Sign-in method.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised for Google Sign-In. Add it under Firebase Console → Authentication → Settings → Authorised domains.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed. Please try again.';
    case 'auth/cancelled-popup-request':
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register') setMode('register');
  }, []);

  useEffect(() => {
    setGoogleLoading(true);
    getRedirectResult(auth)
      .then(async result => {
        if (result?.user) {
          await ensureGoogleUserDoc(result.user);
          await refreshUserData();
        }
      })
      .catch(e => {
        const msg = googleErrorMessage(e?.code || '');
        if (msg) setError(msg);
      })
      .finally(() => setGoogleLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && user && userData) {
      if (userData.role === 'superadmin') {
        setLocation('/superadmin');
      } else {
        setLocation('/app');
      }
    }
  }, [user, userData, loading]);

  async function handleLogin() {
    if (!loginId || !loginPass) return setError('Please fill in all fields.');

    setSubmitting(true); setError('');

    // Hardcoded Super Admin Login Bypass (Maps 0000/0000 to internal Firebase admin account)
    if (loginId === '0000' && loginPass === '0000') {
      try {
        const result = await signInWithEmailAndPassword(auth, SA_FIREBASE_EMAIL, 'godadmin0000');
        const existing = await getUserData(result.user.uid);
        if (!existing) {
          await createUserData(result.user.uid, {
            firstName: 'God', lastName: 'Admin', username: 'superadmin',
            email: SA_FIREBASE_EMAIL, role: 'superadmin', onboardingComplete: true,
          });
        } else if (existing.role !== 'superadmin') {
          const { updateUserData } = await import('@/lib/userService');
          await updateUserData(result.user.uid, { role: 'superadmin' });
        }
        setSubmitting(false);
        return;
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code || '';
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
          try {
            const cred = await createUserWithEmailAndPassword(auth, SA_FIREBASE_EMAIL, 'godadmin0000');
            await updateProfile(cred.user, { displayName: 'SuperAdmin' });
            await createUserData(cred.user.uid, {
              firstName: 'God', lastName: 'Admin', username: 'superadmin',
              email: SA_FIREBASE_EMAIL, role: 'superadmin', onboardingComplete: true,
            });
            setSubmitting(false);
            return;
          } catch (createErr) {
            console.error("Superadmin creation failed:", createErr);
            setError('Super Admin initialization failed: ' + (createErr instanceof Error ? createErr.message : String(createErr)));
            setSubmitting(false);
            return;
          }
        }
        setError('Super Admin login failed: ' + (e instanceof Error ? e.message : String(e)));
        setSubmitting(false);
        return;
      }
    }
    try {
      let loginEmail = loginId.trim();
      if (!loginId.includes('@')) {
        const found = await findUserByUsername(loginId.toLowerCase().trim());
        if (!found) { setError('Username not found.'); setSubmitting(false); return; }
        loginEmail = found.email;
      }
      await signInWithEmailAndPassword(auth, loginEmail, loginPass);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('Incorrect email/username or password.');
      } else {
        setError(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Login failed');
      }
    }
    setSubmitting(false);
  }

  async function handleRegister() {
    if (!fname || !lname || !username || !email || !pass) return setError('Please fill in all required fields.');
    if (pass !== confirm) return setError('Passwords do not match.');
    if (pass.length < 6) return setError('Password must be at least 6 characters.');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return setError('Username can only contain letters, numbers and underscores.');
    setSubmitting(true); setError('');
    try {
      const taken = await isUsernameTaken(username);
      if (taken) { setError('Username is already taken.'); setSubmitting(false); return; }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: username });
      await createUserData(cred.user.uid, {
        firstName: fname, lastName: lname, username, email,
        role: 'student',
        onboardingComplete: false,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists.');
      } else {
        setError(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Registration failed');
      }
    }
    setSubmitting(false);
  }

  async function handleGoogle() {
    setSubmitting(true); setError('');
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      await ensureGoogleUserDoc(result.user);
      await refreshUserData();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectErr: unknown) {
          const rCode = (redirectErr as { code?: string })?.code || '';
          const msg = googleErrorMessage(rCode);
          if (msg) setError(msg);
        }
      } else {
        const msg = googleErrorMessage(code);
        if (msg) setError(msg);
      }
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
