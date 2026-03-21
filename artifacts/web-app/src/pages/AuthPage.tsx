import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signInWithPopup, GoogleAuthProvider
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { findUserByUsername, createUserData, isUsernameTaken, UserRole } from '@/lib/userService';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');

  const [fname, setFname] = useState('');
  const [lname, setLname] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<UserRole>('student');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register') setMode('register');
  }, []);

  useEffect(() => {
    if (!loading && user && userData) {
      if (userData.role === 'teacher' || userData.role === 'admin') {
        setLocation('/dashboard');
      } else {
        setLocation('/app');
      }
    }
  }, [user, userData, loading]);

  async function handleLogin() {
    if (!loginId || !loginPass) return setError('Please fill in all fields.');
    setSubmitting(true); setError('');
    try {
      let loginEmail = loginId;
      if (!loginId.includes('@')) {
        const found = await findUserByUsername(loginId);
        if (!found) { setError('Username not found.'); setSubmitting(false); return; }
        loginEmail = found.email;
      }
      await signInWithEmailAndPassword(auth, loginEmail, loginPass);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Login failed');
    }
    setSubmitting(false);
  }

  async function handleRegister() {
    if (!fname || !lname || !username || !email || !pass) return setError('Please fill in all required fields.');
    if (pass !== confirm) return setError('Passwords do not match.');
    if (pass.length < 6) return setError('Password must be at least 6 characters.');
    setSubmitting(true); setError('');
    try {
      const taken = await isUsernameTaken(username);
      if (taken) { setError('Username is already taken.'); setSubmitting(false); return; }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: username });
      await createUserData(cred.user.uid, {
        firstName: fname, lastName: lname, username, email, role,
        economy: { gold: 1000, global_xp: 0, streak: 0 }
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Registration failed');
    }
    setSubmitting(false);
  }

  async function handleGoogle() {
    setSubmitting(true); setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const { getUserData } = await import('@/lib/userService');
      const existingData = await getUserData(result.user.uid);
      if (!existingData) {
        await createUserData(result.user.uid, {
          firstName: result.user.displayName?.split(' ')[0] || '',
          lastName: result.user.displayName?.split(' ').slice(1).join(' ') || '',
          username: result.user.displayName?.replace(/\s+/g, '') || '',
          email: result.user.email || '',
          role: 'student',
          economy: { gold: 1000, global_xp: 0, streak: 0 }
        });
      }
    } catch {
      setError('Google Sign-In failed. Please try again.');
    }
    setSubmitting(false);
  }

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
        background: '#1e293b', padding: 35, borderRadius: 16,
        border: '2px solid #334155', boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        maxWidth: 420, width: '100%', textAlign: 'center',
        maxHeight: '90vh', overflowY: 'auto', animation: 'slideUp 0.4s ease'
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🌌</div>
        <h1 style={{ margin: '0 0 4px', color: 'white', fontSize: 24, textShadow: '0 0 10px rgba(59,130,246,0.4)' }}>
          LOGIC LORDS
        </h1>
        <p style={{ color: '#94a3b8', marginBottom: 22, fontSize: 14 }}>
          {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
        </p>

        {error && (
          <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 14, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        {mode === 'login' ? (
          <div>
            <input style={inputStyle} placeholder="Email or Username" value={loginId} onChange={e => setLoginId(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <input style={inputStyle} type="password" placeholder="Password" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <button className="ll-btn ll-btn-primary" style={{ width: '100%', padding: '13px', fontSize: 16, marginBottom: 10 }} onClick={handleLogin} disabled={submitting}>
              {submitting ? 'Signing in...' : 'LOG IN'}
            </button>
            <button style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 14, width: '100%', padding: '8px', fontFamily: 'inherit' }} onClick={() => { setMode('register'); setError(''); }}>
              Need an account? Register here
            </button>
          </div>
        ) : (
          <div>
            {/* Role selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {(['student', 'teacher'] as UserRole[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  style={{
                    flex: 1, padding: '11px 10px', borderRadius: 10, fontSize: 14, fontWeight: 'bold',
                    cursor: 'pointer', fontFamily: 'inherit', transition: '0.2s',
                    background: role === r
                      ? (r === 'teacher' ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.2)')
                      : 'rgba(0,0,0,0.3)',
                    border: role === r
                      ? (r === 'teacher' ? '2px solid #10b981' : '2px solid #3b82f6')
                      : '2px solid #334155',
                    color: role === r
                      ? (r === 'teacher' ? '#34d399' : '#93c5fd')
                      : '#64748b'
                  }}
                >
                  {r === 'student' ? '🧑‍🎓 Student' : '🧑‍🏫 Teacher'}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inputStyle, flex: 1, marginRight: 0 }} placeholder="First Name" value={fname} onChange={e => setFname(e.target.value)} />
              <input style={{ ...inputStyle, flex: 1 }} placeholder="Last Name" value={lname} onChange={e => setLname(e.target.value)} />
            </div>
            <input style={inputStyle} placeholder="Username (e.g. LogicMaster99)" value={username} onChange={e => setUsername(e.target.value)} />
            <input style={inputStyle} type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} />
            <input style={inputStyle} type="password" placeholder="Password (min 6 chars)" value={pass} onChange={e => setPass(e.target.value)} />
            <input style={inputStyle} type="password" placeholder="Confirm Password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            <button className="ll-btn ll-btn-primary" style={{ width: '100%', padding: '13px', fontSize: 16, marginBottom: 10 }} onClick={handleRegister} disabled={submitting}>
              {submitting ? 'Creating account...' : `CREATE ${role.toUpperCase()} ACCOUNT`}
            </button>
            <button style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 14, width: '100%', padding: '8px', fontFamily: 'inherit' }} onClick={() => { setMode('login'); setError(''); }}>
              Already have an account? Log in
            </button>
          </div>
        )}

        <div style={{ margin: '18px 0', color: '#64748b', fontSize: 13, fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, borderBottom: '1px solid #334155', margin: '0 10px' }} />OR<div style={{ flex: 1, borderBottom: '1px solid #334155', margin: '0 10px' }} />
        </div>

        <button
          onClick={handleGoogle}
          disabled={submitting}
          style={{
            background: 'white', color: '#334155', border: 'none',
            borderRadius: 8, padding: '12px 20px', width: '100%',
            fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            fontFamily: 'inherit', transition: '0.2s'
          }}
        >
          <img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" alt="G" width={20} height={20} />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
