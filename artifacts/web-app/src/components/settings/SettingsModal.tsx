import { useEffect, useMemo, useState } from 'react';
import { requireSupabase } from '@/lib/supabase';
import { APP_THEMES, applyAppTheme, type AppThemeDefinition } from '@/lib/appTheme';
import StudentDesignSample from '@/components/settings/StudentDesignSample';
import { updateUserData, type UserData, type UserRole, type UserSettings } from '@/lib/userService';

const sectionButtonStyle: React.CSSProperties = {
  textAlign: 'left',
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: 'rgba(15,23,42,0.6)',
  color: '#cbd5e1',
  fontSize: 13,
  fontWeight: 900,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #475569',
  background: 'rgba(15,23,42,0.65)',
  color: 'white',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

function roleLabel(role: UserRole): string {
  switch (role) {
    case 'teacher_assistant': return 'TA';
    case 'superadmin': return 'Super Admin';
    default: return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

function getRoleCards(role: UserRole) {
  if (role === 'student') {
    return [
      { title: 'What this means', body: 'This section is only for your personal student study preferences.' },
      { title: 'Current option', body: 'Right now you can set a daily study goal that can later drive reminder behavior.' },
    ];
  }
  if (role === 'teacher') {
    return [
      { title: 'Teacher Defaults', body: 'Control your default landing tab and class leaderboard preference.' },
      { title: 'Classroom Signals', body: 'Tune alerts and visibility for classroom management.' },
    ];
  }
  if (role === 'admin' || role === 'superadmin') {
    return [
      { title: 'Admin Defaults', body: 'Use settings as the base for moderation and platform-wide comfort.' },
      { title: 'Brand-Ready', body: 'Themes can later be extended into institutional branding presets.' },
    ];
  }
  if (role === 'teacher_assistant') {
    return [
      { title: 'Queue Focus', body: 'Set your preferred landing view for reviewing and support workflows.' },
      { title: 'Support Visibility', body: 'Adjust how activity and leaderboard elements appear while assisting.' },
    ];
  }
  return [
    { title: 'Parent Digest', body: 'Choose how often you want summaries and progress reminders.' },
    { title: 'Family View', body: 'Keep the interface calm, readable, and easy to follow.' },
  ];
}

function defaultSettings(): UserSettings {
  return {
    appearance: { appTheme: 'modern-dark' },
    notifications: { email: true, inApp: true, reminders: true },
    rolePreferences: {},
  };
}

export default function SettingsModal({
  open,
  onClose,
  uid,
  userData,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  uid: string;
  userData: UserData;
  onSaved: () => Promise<void>;
}) {
  const [section, setSection] = useState<'account' | 'appearance' | 'notifications' | 'role'>('account');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sampleTheme, setSampleTheme] = useState<AppThemeDefinition | null>(null);

  const [settingsDraft, setSettingsDraft] = useState<UserSettings>(() => userData.settings ?? defaultSettings());

  useEffect(() => {
    setSettingsDraft(userData.settings ?? defaultSettings());
  }, [userData]);

  const roleCards = useMemo(() => getRoleCards(userData.role), [userData.role]);
  const studentThemeChoices = useMemo(() => APP_THEMES, []);

  if (!open) return null;

  async function handleSaveSettings() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateUserData(uid, { settings: settingsDraft });
      setSaveMsg('Settings saved.');
      setSaving(false);
      void onSaved().catch(() => {});
      return;
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordUpdate() {
    if (!nextPassword || nextPassword.length < 6) {
      setPasswordMsg('Password must be at least 6 characters.');
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordMsg('Passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    setPasswordMsg(null);
    try {
      const { error } = await requireSupabase().auth.updateUser({ password: nextPassword });
      if (error) throw error;
      setPasswordMsg('Password updated successfully.');
      setNextPassword('');
      setConfirmPassword('');
    } catch (e) {
      setPasswordMsg(e instanceof Error ? e.message : 'Failed to update password.');
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1600 }} />
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(980px, 96vw)',
        height: 'min(760px, 92vh)',
        background: 'var(--ll-bg-dark)',
        border: '1px solid #334155',
        borderRadius: 20,
        overflow: 'hidden',
        zIndex: 1601,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
      }}>
        <div style={{ background: 'rgba(15,23,42,0.92)', borderRight: '1px solid #334155', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ color: 'white', fontSize: 18, fontWeight: 1000 }}>⚙️ Settings</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{roleLabel(userData.role)} controls and personalization</div>
          </div>
          {[
            { id: 'account' as const, label: 'Account & Security', icon: '🔐' },
            ...(userData.role === 'student' ? [{ id: 'appearance' as const, label: 'Design Preview', icon: '🎨' }] : []),
            { id: 'notifications' as const, label: 'Notifications', icon: '🔔' },
            { id: 'role' as const, label: userData.role === 'student' ? 'Study Preferences' : `${roleLabel(userData.role)} Tools`, icon: '🧩' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              style={{
                ...sectionButtonStyle,
                background: section === item.id ? 'rgba(59,130,246,0.15)' : sectionButtonStyle.background,
                border: section === item.id ? '1px solid rgba(59,130,246,0.40)' : sectionButtonStyle.border,
                color: section === item.id ? '#93c5fd' : sectionButtonStyle.color,
              }}
            >
              {item.icon} {item.label}
            </button>
          ))}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {saveMsg && <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 800 }}>{saveMsg}</div>}
            <button onClick={() => void handleSaveSettings()} disabled={saving} className="ll-btn ll-btn-primary" style={{ width: '100%', padding: '11px 12px' }}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button onClick={onClose} className="ll-btn" style={{ width: '100%', padding: '11px 12px' }}>Close</button>
          </div>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', background: 'rgba(2,6,23,0.92)' }}>
          {section === 'account' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ color: 'white', fontSize: 20, fontWeight: 1000 }}>Account & Security</div>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>Manage your sign-in security and core account information.</div>
              </div>
              <div style={{ background: 'rgba(30,41,59,0.75)', border: '1px solid #334155', borderRadius: 14, padding: 16 }}>
                <div style={{ color: '#cbd5e1', fontWeight: 900, fontSize: 13 }}>Signed in as</div>
                <div style={{ color: 'white', fontSize: 16, fontWeight: 1000, marginTop: 6 }}>{userData.username}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{userData.email}</div>
              </div>
              <div style={{ background: 'rgba(30,41,59,0.75)', border: '1px solid #334155', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ color: 'white', fontSize: 15, fontWeight: 1000 }}>Change Password</div>
                <input type="password" value={nextPassword} onChange={(e) => setNextPassword(e.target.value)} placeholder="New password" style={inputStyle} />
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" style={inputStyle} />
                {passwordMsg && <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 800 }}>{passwordMsg}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => void handlePasswordUpdate()} disabled={passwordBusy} className="ll-btn ll-btn-primary" style={{ padding: '10px 14px' }}>
                    {passwordBusy ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {section === 'appearance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ color: 'white', fontSize: 20, fontWeight: 1000 }}>Student Design Preview</div>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>These curated designs apply only to student accounts. They do not affect the login page or any super admin, admin, teacher, TA, or parent screens.</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {studentThemeChoices.map((theme) => {
                  const active = settingsDraft.appearance.appTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSettingsDraft((prev) => ({ ...prev, appearance: { ...prev.appearance, appTheme: theme.id } }))}
                      style={{
                        textAlign: 'left',
                        padding: 14,
                        borderRadius: 14,
                        border: active ? '1px solid rgba(59,130,246,0.45)' : '1px solid #334155',
                        background: active ? 'rgba(59,130,246,0.12)' : 'rgba(30,41,59,0.72)',
                        color: 'white',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{
                        height: 120,
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: theme.preview.background,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        marginBottom: 12,
                        boxSizing: 'border-box',
                      }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: theme.preview.accent }} />
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: theme.preview.accentSoft }} />
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: theme.preview.card }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div style={{ background: theme.preview.card, borderRadius: 10, padding: 8, minHeight: 52 }}>
                            <div style={{ width: '70%', height: 8, borderRadius: 999, background: theme.preview.accent, opacity: 0.9, marginBottom: 8 }} />
                            <div style={{ width: '50%', height: 8, borderRadius: 999, background: theme.preview.accentSoft, opacity: 0.65 }} />
                          </div>
                          <div style={{ background: theme.preview.card, borderRadius: 10, padding: 8, minHeight: 52, display: 'flex', alignItems: 'flex-end' }}>
                            <div style={{ width: '100%', height: 12, borderRadius: 999, background: theme.preview.accent, opacity: 0.8 }} />
                          </div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 1000, fontSize: 14 }}>{theme.label}</div>
                      <div style={{ color: active ? '#bfdbfe' : '#cbd5e1', fontSize: 11, marginTop: 4, fontWeight: 900 }}>{theme.audience}</div>
                      <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>{theme.description}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSettingsDraft((prev) => ({ ...prev, appearance: { ...prev.appearance, appTheme: theme.id } }));
                            applyAppTheme(theme.id);
                            setSaveMsg(`Previewing ${theme.label} for this student account only. Save settings to keep it for the student experience only.`);
                          }}
                          className="ll-btn ll-btn-primary"
                          style={{ padding: '8px 10px', fontSize: 11, flex: 1 }}
                        >
                          Apply
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSampleTheme(theme);
                          }}
                          className="ll-btn"
                          style={{ padding: '8px 10px', fontSize: 11, flex: 1 }}
                        >
                          Open Sample Page
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ background: 'rgba(30,41,59,0.75)', border: '1px solid #334155', borderRadius: 14, padding: 16 }}>
                <div style={{ color: 'white', fontWeight: 1000, fontSize: 14, marginBottom: 8 }}>How approval should work</div>
                <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
                  These are sample student designs. You can preview them here first, and later we can keep only the ones you officially approve.
                </div>
              </div>
            </div>
          )}

          {section === 'notifications' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ color: 'white', fontSize: 20, fontWeight: 1000 }}>Notifications</div>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>Decide how the app keeps you informed.</div>
              </div>
              {[
                { key: 'email' as const, label: 'Email updates', description: 'Receive account and learning updates by email.' },
                { key: 'inApp' as const, label: 'In-app notifications', description: 'Show activity and system updates in the app.' },
                { key: 'reminders' as const, label: 'Study reminders', description: 'Receive reminders for streaks, goals, and sessions.' },
              ].map((item) => (
                <label key={item.key} style={{ display: 'flex', gap: 12, padding: 14, borderRadius: 14, border: '1px solid #334155', background: 'rgba(30,41,59,0.72)', color: 'white' }}>
                  <input
                    type="checkbox"
                    checked={settingsDraft.notifications[item.key]}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, notifications: { ...prev.notifications, [item.key]: e.target.checked } }))}
                  />
                  <div>
                    <div style={{ fontWeight: 1000, fontSize: 14 }}>{item.label}</div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{item.description}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {section === 'role' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ color: 'white', fontSize: 20, fontWeight: 1000 }}>{userData.role === 'student' ? 'Study Preferences' : `${roleLabel(userData.role)} Settings`}</div>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>{userData.role === 'student' ? 'Simple student-only preferences that are easier to understand.' : 'Role-aware controls and preferences for how you use the application.'}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {roleCards.map((card) => (
                  <div key={card.title} style={{ padding: 14, borderRadius: 14, border: '1px solid #334155', background: 'rgba(30,41,59,0.72)' }}>
                    <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>{card.title}</div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>{card.body}</div>
                  </div>
                ))}
              </div>

              {userData.role === 'student' && (
                <div style={{ background: 'rgba(30,41,59,0.75)', border: '1px solid #334155', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Daily Study Goal</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>This is the number we can later use for study reminders and daily progress nudges.</div>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={settingsDraft.rolePreferences.dailyGoal ?? ''}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, rolePreferences: { ...prev.rolePreferences, dailyGoal: e.target.value ? Number(e.target.value) : undefined } }))}
                    placeholder="e.g. 20"
                    style={inputStyle}
                  />
                </div>
              )}

              {(userData.role === 'teacher' || userData.role === 'teacher_assistant' || userData.role === 'admin' || userData.role === 'superadmin') && (
                <div style={{ background: 'rgba(30,41,59,0.75)', border: '1px solid #334155', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Default Landing Tab</div>
                  <input
                    value={settingsDraft.rolePreferences.defaultLandingTab ?? ''}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, rolePreferences: { ...prev.rolePreferences, defaultLandingTab: e.target.value || undefined } }))}
                    placeholder="e.g. classes, users, review"
                    style={inputStyle}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#cbd5e1', fontSize: 13, fontWeight: 800 }}>
                    <input
                      type="checkbox"
                      checked={!!settingsDraft.rolePreferences.enableClassLeaderboard}
                      onChange={(e) => setSettingsDraft((prev) => ({ ...prev, rolePreferences: { ...prev.rolePreferences, enableClassLeaderboard: e.target.checked } }))}
                    />
                    Enable class leaderboard by default
                  </label>
                </div>
              )}

              {userData.role === 'parent' && (
                <div style={{ background: 'rgba(30,41,59,0.75)', border: '1px solid #334155', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Parent Digest Frequency</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['daily', 'weekly'] as const).map((freq) => (
                      <button
                        key={freq}
                        onClick={() => setSettingsDraft((prev) => ({ ...prev, rolePreferences: { ...prev.rolePreferences, parentDigestFrequency: freq } }))}
                        className="ll-btn"
                        style={{
                          padding: '8px 12px',
                          borderColor: settingsDraft.rolePreferences.parentDigestFrequency === freq ? 'var(--ll-accent)' : '#475569',
                          color: settingsDraft.rolePreferences.parentDigestFrequency === freq ? 'white' : '#cbd5e1',
                          background: settingsDraft.rolePreferences.parentDigestFrequency === freq ? 'rgba(59,130,246,0.16)' : 'transparent',
                        }}
                      >
                        {freq}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {sampleTheme && (
        <StudentDesignSample
          theme={sampleTheme}
          onClose={() => setSampleTheme(null)}
          onUseTheme={() => {
            setSettingsDraft((prev) => ({ ...prev, appearance: { ...prev.appearance, appTheme: sampleTheme.id } }));
            setSampleTheme(null);
            setSaveMsg(`Selected ${sampleTheme.label}. Save settings if you want to approve it for this student account.`);
          }}
        />
      )}
    </>
  );
}
