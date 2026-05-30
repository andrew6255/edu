import { useState } from 'react';
import { requireSupabase, getAdminClient } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { createUserData } from '@/lib/userService';

interface Props {
  onComplete: () => void;
}

export default function CreateParentPage({ onComplete }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<'info' | 'form'>('info');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPass, setParentPass] = useState('');
  const [parentPassConfirm, setParentPassConfirm] = useState('');
  const [parentFirstName, setParentFirstName] = useState('');
  const [parentLastName, setParentLastName] = useState('');
  const [parentUsername, setParentUsername] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setError('');
    if (!parentEmail.trim() || !parentPass || !parentUsername.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    if (parentPass.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (parentPass !== parentPassConfirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!user) {
      setError('You must be logged in.');
      return;
    }

    setCreating(true);
    try {
      // 1. Create parent auth user using admin client (so we don't log out the student)
      const admin = getAdminClient();
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email: parentEmail.trim(),
        password: parentPass,
        email_confirm: true,
        user_metadata: { full_name: `${parentFirstName} ${parentLastName}`.trim(), name: parentUsername.trim() },
      });
      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create parent auth user');

      const parentUid = authData.user.id;

      // 2. Create parent profile (using admin client to bypass RLS since student can't write to profiles for another user)
      const { error: profileError } = await (admin.from as any)('profiles').upsert({
        id: parentUid,
        email: parentEmail.trim(),
        username: parentUsername.trim(),
        first_name: parentFirstName.trim() || 'Parent',
        last_name: parentLastName.trim() || '',
        role: 'parent',
        onboarding_complete: true,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      if (profileError) throw profileError;

      // 3. Create parent economy row
      const { error: econError } = await (admin.from as any)('user_economy').upsert({
        user_id: parentUid,
        gold: 0, global_xp: 0, streak: 0, energy: 0, ranked_energy_streak: 0,
        updated_at: new Date().toISOString(),
      });
      if (econError) console.warn('Economy creation warning:', econError);

      // 4. Create parent_student_link (student can insert their own link)
      const supabase = requireSupabase();
      const { error: linkError } = await supabase.from('parent_student_links').insert({
        parent_id: parentUid,
        student_id: user.uid,
        created_at: new Date().toISOString(),
      });
      if (linkError) throw linkError;

      onComplete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate') || msg.includes('already')) {
        setError('This email or username is already taken. Please choose another.');
      } else {
        setError('Failed to create parent account: ' + msg);
      }
    } finally {
      setCreating(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', marginBottom: 12, borderRadius: 8,
    border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white',
    boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none',
  };

  if (step === 'info') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 24, animation: 'fadeIn 0.3s ease' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>👨‍👩‍👧</div>
          <h1 style={{ color: 'white', fontSize: 22, margin: '0 0 8px' }}>Create a Parent Account</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            Before you can access the platform, a parent account must be linked to your student account.
            This parent account allows your guardian to track your progress and communicate with your teachers.
          </p>
          <p style={{ color: '#64748b', fontSize: 12, marginBottom: 24 }}>
            You'll create login credentials for your parent/guardian. They'll use these to access their own parent panel.
          </p>
          <button
            onClick={() => setStep('form')}
            className="ll-btn ll-btn-primary"
            style={{ padding: '14px 32px', fontSize: 16 }}
          >
            Create Parent Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0f172a', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420, animation: 'fadeIn 0.3s ease' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>👨‍👩‍👧</div>
          <h2 style={{ color: 'white', margin: '0 0 4px', fontSize: 20 }}>Parent Account Details</h2>
          <p style={{ color: '#64748b', fontSize: 12 }}>Create login credentials for your parent/guardian</p>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 12 }}>
            {error}
          </div>
        )}

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Parent Username *</label>
        <input
          value={parentUsername} onChange={e => setParentUsername(e.target.value)}
          placeholder="e.g. mom_jane"
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>First Name</label>
            <input
              value={parentFirstName} onChange={e => setParentFirstName(e.target.value)}
              placeholder="Jane"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Last Name</label>
            <input
              value={parentLastName} onChange={e => setParentLastName(e.target.value)}
              placeholder="Doe"
              style={inputStyle}
            />
          </div>
        </div>

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Parent Email *</label>
        <input
          type="email"
          value={parentEmail} onChange={e => setParentEmail(e.target.value)}
          placeholder="parent@example.com"
          style={inputStyle}
        />

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Password *</label>
        <input
          type="password"
          value={parentPass} onChange={e => setParentPass(e.target.value)}
          placeholder="Min. 6 characters"
          style={inputStyle}
        />

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Confirm Password *</label>
        <input
          type="password"
          value={parentPassConfirm} onChange={e => setParentPassConfirm(e.target.value)}
          placeholder="Re-enter password"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={() => setStep('info')} className="ll-btn" style={{ flex: 1, padding: '12px' }}>
            ← Back
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="ll-btn ll-btn-primary"
            style={{ flex: 2, padding: '12px' }}
          >
            {creating ? 'Creating...' : 'Create Parent Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
