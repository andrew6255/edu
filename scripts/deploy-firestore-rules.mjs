/**
 * Deploys firestore.rules to the Firebase project using the Security Rules REST API.
 * Uses FIREBASE_SERVICE_ACCOUNT_JSON to authenticate.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, '../firestore.rules');
const rulesSource = readFileSync(RULES_PATH, 'utf8');

// ── 1. Load service account ───────────────────────────────────────────────────
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!saJson) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON env var not set');
  process.exit(1);
}
const sa = JSON.parse(saJson);
const PROJECT_ID = sa.project_id;
console.log(`📦 Deploying Firestore rules to project: ${PROJECT_ID}`);

// ── 2. Get a Google OAuth2 access token via service account JWT ───────────────
async function getAccessToken() {
  // Build a JWT for the Google OAuth2 token endpoint
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };

  function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
  }

  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  // Sign using Node.js crypto
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, 'base64url');
  const jwt = `${signingInput}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── 3. Create ruleset ─────────────────────────────────────────────────────────
async function createRuleset(token) {
  const url = `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`;
  const body = {
    source: {
      files: [{ name: 'firestore.rules', content: rulesSource }],
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Create ruleset failed: ${JSON.stringify(data)}`);
  return data.name; // e.g. "projects/logiclords-mvp/rulesets/abc123"
}

// ── 4. Release (apply) ruleset to Firestore ───────────────────────────────────
async function releaseRuleset(token, rulesetName) {
  const releaseName = `projects/${PROJECT_ID}/releases/cloud.firestore`;

  // Try PATCH first (update existing release)
  const patchUrl = `https://firebaserules.googleapis.com/v1/${releaseName}`;
  const releaseBody = { name: releaseName, rulesetName };

  let resp = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ release: releaseBody }),
  });

  if (resp.status === 404) {
    // Release doesn't exist yet — create it
    const createUrl = `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`;
    resp = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(releaseBody),
    });
  }

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Release ruleset failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────
try {
  console.log('🔑 Getting access token...');
  const token = await getAccessToken();

  console.log('📝 Creating ruleset...');
  const rulesetName = await createRuleset(token);
  console.log(`   Ruleset created: ${rulesetName}`);

  console.log('🚀 Releasing ruleset to Firestore...');
  await releaseRuleset(token, rulesetName);

  console.log('✅ Firestore security rules deployed successfully!');
} catch (err) {
  console.error('❌ Deployment failed:', err.message);
  process.exit(1);
}
