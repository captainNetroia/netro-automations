#!/usr/bin/env node
/**
 * fix-continue-on-fail.js
 * Ajoute continueOnFail:true sur les noeuds effets de bord du workflow unifie.
 * Ainsi, meme si Slack/Sheets/Email echoue, Reponse Finale est toujours atteint.
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const WF_ID   = 'Icz9Mh20mWcZHHQy';
const HOST    = 'n8n.netroia.tech';

// Noeuds sur lesquels continueOnFail doit etre true
const RESILIENT_NODES = [
  'Alerte Slack',
  'Envoyer Email Prospect',
  'Logger Sheets',
  'Generer Email',
];

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
  if (status !== 200) { console.error('GET error:', status); process.exit(1); }
  console.log(`   OK — ${wf.nodes.length} noeuds`);

  let changed = 0;
  wf.nodes.forEach(node => {
    if (RESILIENT_NODES.includes(node.name)) {
      if (!node.continueOnFail) {
        node.continueOnFail = true;
        console.log(`2. continueOnFail=true sur "${node.name}"`);
        changed++;
      } else {
        console.log(`   "${node.name}" — deja continueOnFail, skip`);
      }
    }
  });

  if (changed === 0) {
    console.log('   Aucun changement necessaire.');
    return;
  }

  const payload = {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    wf.settings,
    staticData:  wf.staticData || null,
  };

  console.log(`3. PUT du workflow (${changed} changements)...`);
  const put = await request('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  if (put.status !== 200) {
    console.error('PUT error:', put.status, JSON.stringify(put.body, null, 2));
    process.exit(1);
  }
  console.log('   OK — workflow mis a jour');

  fs.writeFileSync(
    'C:/Netroia/netro-automations/workflows/internal/agent-formulaire-contact-terminal-v1.json',
    JSON.stringify(put.body, null, 2)
  );
  console.log('   Sauvegarde locale OK');
}

main().catch(e => { console.error(e); process.exit(1); });
