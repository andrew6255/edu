import { requireSupabase } from '@/lib/supabase';

export type UploadedProgramAsset = {
  url: string;
  path: string;
  provider: 'supabase' | 'firebase';
};

function sanitizeFileName(name: string): string {
  return String(name || 'image')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
}

export async function uploadProgramQuestionAsset(file: File, programId: string): Promise<UploadedProgramAsset> {
  const safeProgramId = String(programId || 'program').trim() || 'program';
  const safeName = sanitizeFileName(file.name);
  const path = `${safeProgramId}/questions/${Date.now()}_${safeName}`;

  const supabase = requireSupabase();
  const { error } = await supabase.storage.from('program-assets').upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('program-assets').getPublicUrl(path);
  const url = data.publicUrl;
  if (!url) throw new Error('Failed to resolve uploaded asset URL.');
  return { url, path, provider: 'supabase' };
}
