import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const { data: profiles, error } = await supabase.from('profiles').select('id, username, user_state');
  
  if (error) {
    console.error(error);
    process.exit(1);
  }

  for (const p of profiles) {
    const state = p.user_state || {};
    let currentUsername = state.username || p.username || '';
    
    // If it has #1234
    if (/#\d{4}$/.test(currentUsername)) {
      const [base, tag] = currentUsername.split('#');
      // Revert base
      const originalBase = base.toLowerCase() === 'superadmin' ? 'superadmin' : base.toLowerCase();
      
      state.username = originalBase;
      state.friendCode = `#${tag}`;
      
      await supabase.from('profiles').update({ 
        username: originalBase,
        user_state: state
      }).eq('id', p.id);
      
      console.log(`Reverted ${currentUsername} -> ${originalBase} (tag: #${tag})`);
    } else {
      // If it missed migration or they manually removed #, just assign a friendCode if missing
      if (!state.friendCode) {
        const tag = Math.floor(1000 + Math.random() * 9000);
        state.friendCode = `#${tag}`;
        await supabase.from('profiles').update({ user_state: state }).eq('id', p.id);
        console.log(`Assigned tag to ${currentUsername} -> #${tag}`);
      }
    }
  }
}

run();
