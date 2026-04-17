import { requireSupabase } from '@/lib/supabase';

/** Generate a random 6-character alphanumeric code */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Student: create or refresh a linking code (upserts — one active code per student) */
export async function createLinkingCode(studentId: string): Promise<string> {
  const supabase = requireSupabase();
  // Delete any existing code for this student
  await supabase.from('linking_codes').delete().eq('student_id', studentId);
  const code = generateCode();
  const { error } = await supabase.from('linking_codes').insert({
    code,
    student_id: studentId,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
  });
  if (error) throw error;
  return code;
}

/** Student: get their current active linking code (if any) */
export async function getMyLinkingCode(studentId: string): Promise<{ code: string; expires_at: string } | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('linking_codes')
    .select('code, expires_at')
    .eq('student_id', studentId)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Student: get their linked parent info */
export async function getLinkedParent(studentId: string): Promise<{ parent_id: string; first_name: string; last_name: string; username: string } | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('parent_student_links')
    .select('parent_id')
    .eq('student_id', studentId)
    .maybeSingle();
  if (error || !data) return null;
  // Fetch parent profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, username')
    .eq('id', data.parent_id)
    .maybeSingle();
  if (!profile) return null;
  return { parent_id: data.parent_id, ...profile };
}

/** Parent: look up a linking code and link to the student */
export async function redeemLinkingCode(parentId: string, code: string): Promise<{ studentName: string }> {
  const supabase = requireSupabase();
  // Look up code
  const { data: codeRow, error: lookupErr } = await supabase
    .from('linking_codes')
    .select('student_id, expires_at')
    .eq('code', code.toUpperCase().trim())
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!codeRow) throw new Error('Invalid or expired code.');
  if (new Date(codeRow.expires_at) < new Date()) throw new Error('This code has expired. Ask the student to generate a new one.');

  // Check student isn't already linked to another parent
  const { data: existingLink } = await supabase
    .from('parent_student_links')
    .select('parent_id')
    .eq('student_id', codeRow.student_id)
    .maybeSingle();
  if (existingLink) throw new Error('This student is already linked to a parent account.');

  // Create link
  const { error: linkErr } = await supabase.from('parent_student_links').insert({
    parent_id: parentId,
    student_id: codeRow.student_id,
    created_at: new Date().toISOString(),
  });
  if (linkErr) throw linkErr;

  // Delete the used code
  await supabase.from('linking_codes').delete().eq('code', code.toUpperCase().trim());

  // Get student name for confirmation
  const { data: studentProfile } = await supabase
    .from('profiles')
    .select('first_name, last_name, username')
    .eq('id', codeRow.student_id)
    .maybeSingle();

  return { studentName: studentProfile?.username || `${studentProfile?.first_name || ''} ${studentProfile?.last_name || ''}`.trim() || 'Student' };
}

/** Parent: get all linked students */
export async function getLinkedStudents(parentId: string): Promise<Array<{ student_id: string; first_name: string; last_name: string; username: string; email: string }>> {
  const supabase = requireSupabase();
  const { data: links, error } = await supabase
    .from('parent_student_links')
    .select('student_id')
    .eq('parent_id', parentId);
  if (error || !links || links.length === 0) return [];

  const ids = links.map(l => l.student_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, username, email')
    .in('id', ids);

  return (profiles || []).map(p => ({
    student_id: p.id,
    first_name: p.first_name || '',
    last_name: p.last_name || '',
    username: p.username || '',
    email: p.email || '',
  }));
}

/** Parent: unlink a student */
export async function unlinkStudent(parentId: string, studentId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('parent_student_links')
    .delete()
    .eq('parent_id', parentId)
    .eq('student_id', studentId);
  if (error) throw error;
}
