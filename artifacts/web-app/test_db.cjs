const fs = require('fs');

async function run() {
  const data = fs.readFileSync('.env.local', 'utf8');
  const url = data.match(/VITE_SUPABASE_URL=([^\r\n]+)/)[1];
  const key = data.match(/VITE_SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/)[1];
  const body = [{
    node_id: 'iq-80',
    question_id: 'test_null',
    prompt_blocks: null,
    prompt_raw_text: 'test null',
    interaction: { type: 'mcq', choices: ['a', 'b'], correctChoiceIndex: 0 },
    time_limit_sec: 0,
    iq_delta_correct: 0,
    iq_delta_wrong: 0,
    sort_order: 0,
    updated_at: new Date().toISOString()
  }];
  
  const res = await fetch(`${url}/rest/v1/logic_game_questions_public`, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}

run();
