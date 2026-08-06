// Sets the password for the single superadmin account directly in Supabase.
//
// Supabase is the only place the superadmin password is stored, so this script
// is the supported way to rotate it for every deployment at once. Run it from
// anywhere in the workspace:
//
//   pnpm --filter @workspace/api-server superadmin:set-password
//
// The new password is read from a hidden prompt so it never reaches shell
// history or the process list. For non-interactive use, set
// SUPERADMIN_NEW_PASSWORD in the environment instead.

import path from 'node:path';
import readline from 'node:readline';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));

const envCandidates = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'artifacts/api-server/.env.local'),
  path.resolve(process.cwd(), 'artifacts/api-server/.env'),
  path.resolve(runtimeDirectory, '../.env.local'),
  path.resolve(runtimeDirectory, '../.env'),
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

const rawUrl = (process.env['SUPABASE_URL'] ?? '').trim();
const serviceKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
if (!rawUrl || !serviceKey) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in artifacts/api-server/.env.local.');
}
const supabaseUrl = (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).replace(/\/$/, '');
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo so the typed password is never rendered.
    const write = rl._writeToOutput?.bind(rl);
    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) write?.(chunk);
    };
    rl.question(question, (answer) => {
      rl._writeToOutput = write;
      muted = false;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function readNewPassword() {
  const fromEnv = process.env['SUPERADMIN_NEW_PASSWORD'];
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    fail('No TTY available. Set SUPERADMIN_NEW_PASSWORD for non-interactive use.');
  }
  const first = await promptHidden('New superadmin password: ');
  const second = await promptHidden('Confirm password: ');
  if (first !== second) fail('Passwords did not match.');
  return first;
}

const profileResponse = await fetch(
  `${supabaseUrl}/rest/v1/profiles?select=id,email,username,role&role=eq.superadmin&limit=2`,
  { headers },
);
if (!profileResponse.ok) fail(`Could not read profiles (HTTP ${profileResponse.status}).`);
const profiles = await profileResponse.json();
if (profiles.length !== 1) {
  fail(`Expected exactly one profile with role 'superadmin', found ${profiles.length}.`);
}
const profile = profiles[0];

console.log(`Superadmin account: ${profile.username} <${profile.email}>`);

const password = await readNewPassword();
if (password.length < 8 || password.length > 200) {
  fail('Password must be between 8 and 200 characters.');
}

const updateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ password }),
});
if (!updateResponse.ok) {
  fail(`Supabase rejected the password update (HTTP ${updateResponse.status}): ${await updateResponse.text()}`);
}

console.log(`\n✔ Password updated in Supabase for ${profile.username}.`);
console.log('  It applies immediately to local and hosted deployments using this project.');
