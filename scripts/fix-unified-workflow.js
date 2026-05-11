#!/usr/bin/env node
/**
 * fix-unified-workflow.js
 * Corrige 3 bugs dans le workflow Icz9Mh20mWcZHHQy :
 * 1. Preparer Enrichi — ajoute has_email boolean
 * 2. IF Email Disponible — typeValidation strict → loose
 * 3. Settings errorWorkflow — Uc73W2jImd5arguG → pafFHP0oemMaFRMt
 */
const https = require('https');
const fs    = require('fs');

// Load API key from env file directly
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const WF_ID   = 'Icz9Mh20mWcZHHQy';
const HOST    = 'n8n.netroia.tech';

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

async function main() {
  console.log('1. Recuperation du workflow...');
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${WF_ID}`);
  if (status !== 200) { console.error('Erreur GET:', status, wf); process.exit(1); }
  console.log(`   OK — ${wf.nodes.length} noeuds`);

  // FIX 1 — Preparer Enrichi: ajouter has_email
  const preparerEnrichi = wf.nodes.find(n => n.name === 'Preparer Enrichi');
  if (!preparerEnrichi) { console.error('Noeud Preparer Enrichi introuvable'); process.exit(1); }

  const oldCode = preparerEnrichi.parameters.jsCode;
  if (oldCode.includes('has_email')) {
    console.log('2. Preparer Enrichi — has_email deja present, skip.');
  } else {
    // Insert has_email before the closing }};
    const newCode = oldCode.replace(
      /horodatage\s*:\s*new Date\(\)\.toISOString\(\),/,
      `horodatage        : new Date().toISOString(),\n  has_email         : !!(base.email && base.email.trim()),`
    );
    preparerEnrichi.parameters.jsCode = newCode;
    console.log('2. Preparer Enrichi — has_email ajoute OK');
  }

  // FIX 2 — IF Email Disponible: typeValidation strict → loose
  const ifEmail = wf.nodes.find(n => n.name === 'IF Email Disponible');
  if (!ifEmail) { console.error('Noeud IF Email Disponible introuvable'); process.exit(1); }
  if (ifEmail.parameters.conditions.options.typeValidation === 'strict') {
    ifEmail.parameters.conditions.options.typeValidation = 'loose';
    console.log('3. IF Email Disponible — typeValidation: strict → loose OK');
  } else {
    console.log('3. IF Email Disponible — typeValidation deja loose, skip.');
  }

  // FIX 3 — errorWorkflow
  if (wf.settings) {
    const old = wf.settings.errorWorkflow;
    wf.settings.errorWorkflow = 'pafFHP0oemMaFRMt';
    console.log(`4. errorWorkflow: ${old} → pafFHP0oemMaFRMt`);
  }

  // Build minimal PUT payload — only the fields n8n API accepts
  const payload = {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    wf.settings,
    staticData:  wf.staticData || null,
  };

  console.log('5. PUT du workflow modifie...');
  const put = await request('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  if (put.status !== 200) {
    console.error('Erreur PUT:', put.status, JSON.stringify(put.body, null, 2));
    process.exit(1);
  }
  console.log('   OK — workflow mis a jour (ID:', put.body.id, ')');

  // Save updated JSON
  fs.writeFileSync(
    'C:/Netroia/netro-automations/workflows/internal/agent-formulaire-contact-terminal-v1.json',
    JSON.stringify(put.body, null, 2)
  );
  console.log('   Sauvegarde locale OK');
  console.log('\nDone. Tester: curl -X POST https://n8n.netroia.tech/webhook/contact-netroia ...');
}

main().catch(e => { console.error(e); process.exit(1); });
