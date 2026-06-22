import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: p } = await supabase.from('profiles').select('id, username').limit(2);
  const fromUid = p[0].id;
  const toUid = p[1].id;
  console.log(`Testing send_friend_request_rpc with target_uid: ${toUid} (from ${fromUid})`);
  
  // Since rpc runs as the caller, and we're using service role, auth.uid() might be null.
  // Actually, wait! In `send_friend_request_rpc`, `auth.uid()` is used.
  // The service role bypasses RLS but `auth.uid()` returns null unless we pass a JWT or impersonate.
  // But wait, the user called it from the browser! So `auth.uid()` is their real UUID.
  
  // Let's test the frontend logic that might cause `text = uuid`:
  const { data: rows, error } = await supabase.from('profiles').select('id, user_state').eq('username', p[1].username);
  console.log('Query username error:', error);
  
}
run();
