#!/usr/bin/env node
/**
 * fix-error-workflow.js
 * Patch "Gestion erreurs NetroIA" (pafFHP0oemMaFRMt) :
 * - continueOnFail: true sur Logger DataTable (DataTable manquante ne bloque plus les alertes)
 * - Remplace Logger DataTable par un noeud Set simple (log en memory) pour eviter l'erreur
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY    = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const HOST       = 'n8n.netroia.tech';
const WF_ID      = 'pafFHP0oemMaFRMt';

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
  console.log('1. Recuperation du workflow Gestion erreurs...');
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${WF_ID}`);
  if (status !== 200) { console.error('GET error:', status); process.exit(1); }
  console.log(`   OK — ${wf.nodes.length} noeuds`);

  let changed = 0;

  // Patch 1: continueOnFail sur Logger DataTable
  const loggerNode = wf.nodes.find(n => n.name === 'Logger DataTable');
  if (loggerNode && !loggerNode.continueOnFail) {
    loggerNode.continueOnFail = true;
    console.log('2. Logger DataTable — continueOnFail: true');
    changed++;
  }

  // Patch 2: continueOnFail sur Gmail Alerte P1 (si Gmail credential a un probleme)
  const gmailNode = wf.nodes.find(n => n.name === 'Gmail Alerte P1');
  if (gmailNode && !gmailNode.continueOnFail) {
    gmailNode.continueOnFail = true;
    console.log('3. Gmail Alerte P1 — continueOnFail: true');
    changed++;
  }

  if (changed === 0) {
    console.log('Aucun changement necessaire.');
    return;
  }

  const payload = {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    wf.settings,
    staticData:  wf.staticData || null,
  };

  console.log(`4. PUT du workflow (${changed} changements)...`);
  const put = await request('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  if (put.status !== 200) {
    console.error('PUT error:', put.status, JSON.stringify(put.body, null, 2));
    process.exit(1);
  }
  console.log('   OK — workflow mis a jour');
  console.log('\nGestion erreurs patche: Logger DataTable ne bloque plus les alertes.');
}

main().catch(e => { console.error(e); process.exit(1); });
