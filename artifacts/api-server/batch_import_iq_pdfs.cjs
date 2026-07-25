/**
 * Batch IQ PDF Import Script
 * 
 * USAGE:
 *   1. Place all your PDF files in a folder (or use the current directory)
 *   2. Run: node batch_import_iq_pdfs.cjs <nodeId> <pdfFolder>
 *
 * Example:
 *   node batch_import_iq_pdfs.cjs iq-80 "C:\Users\antoi\Downloads\IQ_PDFs"
 *
 * Arguments:
 *   <nodeId>    - The level node ID to import into (e.g. "iq-80" for Level 1, "iq-90" for Level 2)
 *   <pdfFolder> - Path to folder containing your PDF files
 *
 * List available node IDs by running:
 *   node batch_import_iq_pdfs.cjs --list
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const API_SERVER = 'http://localhost:3001';
const SUPABASE_URL = 'https://sszaskzgzxdxiowjlkxg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzemFza3pnenhkeGlvd2psa3hnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTkyMzE4NiwiZXhwIjoyMDkxNDk5MTg2fQ.cm2HIUJlVV2GEJEFdzuvythAQwlvUt7c_M9M65pjvuM';
// ────────────────────────────────────────────────────────────────────────────

function supabaseReq(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + reqPath);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function listNodes() {
  const res = await supabaseReq('GET', '/rest/v1/logic_game_nodes_public?select=*&order=sort_order.asc');
  return Array.isArray(res.data) ? res.data : [];
}

async function getCurrentQuestions(nodeId) {
  const res = await supabaseReq('GET', `/rest/v1/logic_game_questions_public?select=question_id&node_id=eq.${encodeURIComponent(nodeId)}`);
  return Array.isArray(res.data) ? res.data.map(r => r.question_id) : [];
}

async function saveQuestionsChunked(nodeId, questions, existingCount) {
  const now = new Date().toISOString();
  const CHUNK = 50;
  let saved = 0;

  for (let i = 0; i < questions.length; i += CHUNK) {
    const chunk = questions.slice(i, i + CHUNK);
    const rows = chunk.map((q) => ({
      node_id: nodeId,
      question_id: q.id,
      prompt_blocks: q.promptBlocks ?? null,
      prompt_raw_text: q.promptRawText ?? null,
      prompt_latex: null,
      interaction: q.interaction,
      time_limit_sec: 60,
      iq_delta_correct: 5,
      iq_delta_wrong: -3,
      sort_order: existingCount + questions.indexOf(q),
      updated_at: now,
    }));

    const res = await supabaseReq('POST', '/rest/v1/logic_game_questions_public', rows);
    if (res.status >= 400) {
      console.error(`  Chunk insert failed (${res.status}), trying upsert...`);
      const upsertRes = await supabaseReq('POST', '/rest/v1/logic_game_questions_public?on_conflict=node_id%2Cquestion_id', rows);
      if (upsertRes.status >= 400) {
        throw new Error(`Failed to save chunk ${i}-${i+CHUNK}: HTTP ${upsertRes.status} ${JSON.stringify(upsertRes.data).substring(0, 300)}`);
      }
    }
    saved += chunk.length;
    process.stdout.write(`  ✅ Saved ${saved}/${questions.length} questions...\r`);
  }
  console.log(`\n  ✅ All ${saved} questions saved to node "${nodeId}"`);
}

async function extractFromPdf(pdfPath) {
  return new Promise((resolve, reject) => {
    const filename = path.basename(pdfPath);
    const fileContent = fs.readFileSync(pdfPath);
    
    const boundary = `----FormBoundary${Date.now()}`;
    const headerStr = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: application/pdf`,
      '',
      '',
    ].join('\r\n');
    const footerStr = `\r\n--${boundary}--`;
    
    const headerBuf = Buffer.from(headerStr, 'binary');
    const footerBuf = Buffer.from(footerStr, 'binary');
    const bodyBuf = Buffer.concat([headerBuf, fileContent, footerBuf]);

    const url = new URL(`${API_SERVER}/api/program-ingestion/extract-iq-pdf`);
    const opts = {
      hostname: url.hostname,
      port: parseInt(url.port) || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error));
          else resolve(parsed.questions || []);
        } catch(e) {
          reject(new Error(`Invalid response: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => {
      req.destroy();
      reject(new Error('Request timed out after 180s'));
    });
    req.write(bodyBuf);
    req.end();
  });
}

function formatQuestions(raw, startIndex) {
  return raw.map((q, i) => {
    const blocks = [];
    if (q.promptRawText) blocks.push({ type: 'text', text: q.promptRawText });
    if (q.imageUrl) blocks.push({ type: 'image', url: q.imageUrl });
    return {
      id: `q_batch_${Date.now()}_${startIndex + i}_${Math.random().toString(36).slice(2,7)}`,
      promptBlocks: blocks.length > 0 ? blocks : undefined,
      promptRawText: q.promptRawText || '',
      interaction: {
        type: 'mcq',
        choices: q.interaction?.choices || [],
        correctChoiceIndex: typeof q.interaction?.correctChoiceIndex === 'number' && q.interaction.correctChoiceIndex >= 0
          ? q.interaction.correctChoiceIndex : -1,
      },
    };
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--list') {
    console.log('Fetching available levels...');
    const nodes = await listNodes();
    if (nodes.length === 0) {
      console.log('No levels found. Create levels first in the SuperAdmin → IQ Games tab.');
    } else {
      console.log('Available levels:');
      nodes.forEach(n => console.log(`  ${n.id}  →  "${n.label}" (IQ threshold: ${n.iq})`));
    }
    return;
  }

  if (args.length < 2) {
    console.log('Usage:');
    console.log('  node batch_import_iq_pdfs.cjs --list');
    console.log('  node batch_import_iq_pdfs.cjs <nodeId> <pdfFolder>');
    console.log('\nExamples:');
    console.log('  node batch_import_iq_pdfs.cjs iq-80 "C:\\Users\\antoi\\Downloads\\IQ_PDFs"');
    process.exit(1);
  }

  const nodeId = args[0];
  const pdfFolder = args.slice(1).join(' '); // handle spaces in path

  // Validate node exists
  const nodes = await listNodes();
  const targetNode = nodes.find(n => n.id === nodeId);
  if (!targetNode) {
    console.error(`❌ Node "${nodeId}" not found. Run with --list to see available nodes.`);
    process.exit(1);
  }

  // Find PDFs
  const resolvedFolder = path.resolve(pdfFolder);
  if (!fs.existsSync(resolvedFolder)) {
    console.error(`❌ Folder "${resolvedFolder}" does not exist.`);
    process.exit(1);
  }
  const pdfs = fs.readdirSync(resolvedFolder)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(resolvedFolder, f))
    .sort();

  if (pdfs.length === 0) {
    console.error(`❌ No PDF files found in "${resolvedFolder}".`);
    process.exit(1);
  }

  console.log(`\n🎯 Target level: "${targetNode.label}" (${nodeId})`);
  console.log(`📄 Found ${pdfs.length} PDF(s) to process:`);
  pdfs.forEach((p, i) => console.log(`   ${i+1}. ${path.basename(p)}`));

  const existingIds = await getCurrentQuestions(nodeId);
  console.log(`\n📊 Currently ${existingIds.length} questions in this level`);
  console.log('─'.repeat(60));

  let allNewQuestions = [];
  let globalIndex = existingIds.length;
  const failed = [];

  for (let i = 0; i < pdfs.length; i++) {
    const pdfPath = pdfs[i];
    const filename = path.basename(pdfPath);
    console.log(`\n[${i + 1}/${pdfs.length}] 📄 ${filename}`);
    
    try {
      console.log(`  ⏳ Extracting (this may take 30-60s per PDF)...`);
      const rawQuestions = await extractFromPdf(pdfPath);
      const formatted = formatQuestions(rawQuestions, globalIndex);
      allNewQuestions.push(...formatted);
      globalIndex += formatted.length;
      console.log(`  📝 Extracted ${formatted.length} questions (running total: ${allNewQuestions.length})`);
    } catch(e) {
      console.error(`  ❌ Failed: ${e.message}`);
      failed.push({ file: filename, error: e.message });
    }
    
    // Delay between PDFs to avoid Groq rate limiting
    if (i < pdfs.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n' + '─'.repeat(60));

  if (allNewQuestions.length === 0) {
    console.log('⚠️  No questions were extracted. Nothing to save.');
    if (failed.length > 0) {
      console.log('\nFailed files:');
      failed.forEach(f => console.log(`  - ${f.file}: ${f.error}`));
    }
    return;
  }

  console.log(`\n💾 Saving ${allNewQuestions.length} new questions to "${targetNode.label}"...`);
  try {
    await saveQuestionsChunked(nodeId, allNewQuestions, existingIds.length);
    
    const finalIds = await getCurrentQuestions(nodeId);
    console.log(`\n🎉 SUCCESS! Level "${targetNode.label}" now has ${finalIds.length} questions total.`);
    
    if (failed.length > 0) {
      console.log(`\n⚠️  ${failed.length} PDF(s) failed to extract:`);
      failed.forEach(f => console.log(`   - ${f.file}: ${f.error}`));
    }
  } catch(e) {
    console.error(`\n❌ Failed to save questions: ${e.message}`);
    // Save the extracted data to a JSON file as backup
    const backupPath = path.join(resolvedFolder, `iq_backup_${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ nodeId, questions: allNewQuestions }, null, 2));
    console.log(`\n💾 Extracted questions saved to backup file: ${backupPath}`);
    console.log('   You can retry the import from this backup later.');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
