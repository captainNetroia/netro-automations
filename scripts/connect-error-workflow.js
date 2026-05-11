#!/usr/bin/env node
/**
 * connect-error-workflow.js
 * Connecte pafFHP0oemMaFRMt (Gestion erreurs NetroIA) comme error workflow
 * de tous les workflows actifs ou importants qui ne l'ont pas encore.
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY    = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const HOST       = 'n8n.netroia.tech';
const ERROR_WF   = 'pafFHP0oemMaFRMt'; // Gestion erreurs NetroIA

// Workflows à NE PAS toucher (l'error workflow lui-même)
const SKIP = new Set([ERROR_WF]);

// Workflows à forcer même s'ils sont inactifs (workflows NetroIA importants)
const FORCE_UPDATE = new Set([
  'Icz9Mh20mWcZHHQy', // Agent formulaire contact Terminal IA
  'kEWsfjG2pHRSkZq0', // Mail Perso NetroIA
  '026FLd5tS2zyoF9O', // Organisation Intelligente des Urgences
]);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: HOST, port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function patchErrorWorkflow(wfId) {
  // Get current workflow
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${wfId}`);
  if (status !== 200) {
    console.log(`  SKIP ${wfId} — GET failed: ${status}`);
    return false;
  }

  const current = wf.settings?.errorWorkflow;
  if (current === ERROR_WF) {
    console.log(`  OK   [${wfId}] "${wf.name}" — deja connecte`);
    return true;
  }

  // Update settings
  if (!wf.settings) wf.settings = {};
  const oldRef = current || 'NONE';
  wf.settings.errorWorkflow = ERROR_WF;

  const payload = {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    wf.settings,
    staticData:  wf.staticData || null,
  };

  const put = await request('PUT', `/api/v1/workflows/${wfId}`, payload);
  if (put.status !== 200) {
    console.log(`  FAIL [${wfId}] "${wf.name}" — PUT ${put.status}: ${JSON.stringify(put.body).slice(0,100)}`);
    return false;
  }

  console.log(`  FIXED [${wfId}] "${wf.name}" — ${oldRef} → ${ERROR_WF}`);
  return true;
}

async function main() {
  console.log('1. Recuperation de la liste des workflows...');
  const { status, body } = await request('GET', '/api/v1/workflows?limit=50');
  if (status !== 200) { console.error('GET list error:', status); process.exit(1); }

  const workflows = body.data;
  console.log(`   ${workflows.length} workflows trouves`);

  // Identifier les workflows à patcher :
  // - actifs ET pas l'error workflow lui-même
  // - OU dans la liste FORCE_UPDATE
  const toUpdate = workflows.filter(wf =>
    !SKIP.has(wf.id) && (wf.active || FORCE_UPDATE.has(wf.id))
  );

  console.log(`\n2. Mise a jour de ${toUpdate.length} workflows:`);
  let ok = 0, fail = 0;
  for (const wf of toUpdate) {
    const success = await patchErrorWorkflow(wf.id);
    success ? ok++ : fail++;
    await new Promise(r => setTimeout(r, 300)); // rate limiting
  }

  console.log(`\nResultat: ${ok} OK, ${fail} echecs`);
  console.log('\nError workflow "Gestion erreurs NetroIA" connecte a tous les workflows actifs.');
}

main().catch(e => { console.error(e); process.exit(1); });
