#!/usr/bin/env node
/**
 * fix-logger-sheets.js
 * Remplace le noeud "Logger DataTable" (n8n-nodes-base.dataTable, table inexistante)
 * par un noeud Google Sheets append vers l'onglet "Erreurs N8N" du CRM existant.
 * Le nom du noeud reste identique => connexions preservees sans modification.
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY    = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const HOST       = 'n8n.netroia.tech';
const WF_ID      = 'pafFHP0oemMaFRMt';

const SHEET_ID   = '1MfPCOMGtLsEuOq4AdyE93FTOb58hEthntAHULFLXeKE';
const SHEET_TAB  = 'Erreurs N8N';

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
  console.log('Recuperation du workflow Gestion erreurs NetroIA...');
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${WF_ID}`);
  if (status !== 200) { console.error('GET error', status, JSON.stringify(wf).slice(0, 200)); process.exit(1); }

  const loggerIdx = wf.nodes.findIndex(n => n.name === 'Logger DataTable');
  if (loggerIdx === -1) { console.error('Noeud "Logger DataTable" introuvable'); process.exit(1); }

  const existing = wf.nodes[loggerIdx];
  console.log(`  Noeud trouve (index ${loggerIdx}): type=${existing.type}, position=${JSON.stringify(existing.position)}`);

  // Remplacement : meme nom, meme position, meme continueOnFail, meme id
  // => connexions preservees (n8n reference par name)
  wf.nodes[loggerIdx] = {
    id: existing.id,
    name: existing.name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: existing.position,
    continueOnFail: true,
    credentials: {
      googleSheetsOAuth2Api: { id: '96DyhZeedQou7Yho', name: 'Google Sheets account' },
    },
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
      sheetName:  { __rl: true, value: SHEET_TAB,  mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          workflow_name:  '={{ $json.workflow_name }}',
          workflow_id:    '={{ $json.workflow_id }}',
          execution_id:   '={{ $json.execution_id }}',
          last_node:      '={{ $json.last_node }}',
          error_message:  '={{ $json.error_message }}',
          gravite:        '={{ $json.gravite }}',
          categorie:      '={{ $json.categorie }}',
          horodatage:     '={{ $json.timestamp }}',
        },
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {},
    },
  };

  console.log('  Noeud mis a jour -> Google Sheets append vers onglet "' + SHEET_TAB + '"');

  // Validation connexions
  const nodeNames = new Set(wf.nodes.map(n => n.name));
  for (const [src] of Object.entries(wf.connections)) {
    if (!nodeNames.has(src)) throw new Error('Connexion orpheline : ' + src);
  }

  console.log('Envoi PUT workflow...');
  const put = await request('PUT', `/api/v1/workflows/${WF_ID}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
    staticData: wf.staticData || null,
  });

  if (put.status !== 200) {
    console.error('PUT FAIL', put.status, JSON.stringify(put.body).slice(0, 400));
    process.exit(1);
  }
  console.log('PUT OK — workflow mis a jour avec succes.');

  // Ré-activer si necessaire
  const { status: s2, body: b2 } = await request('GET', `/api/v1/workflows/${WF_ID}`);
  if (s2 === 200) {
    console.log('  Statut actif:', b2.active);
    if (!b2.active) {
      const act = await request('POST', `/api/v1/workflows/${WF_ID}/activate`);
      console.log('  Activation:', act.status === 200 ? 'OK' : `FAIL ${act.status}`);
    }
  }

  console.log('\n=== PROCHAINE ETAPE (manuelle) ===');
  console.log('1. Ouvrir le Google Sheet CRM :');
  console.log('   https://docs.google.com/spreadsheets/d/' + SHEET_ID);
  console.log('2. Ajouter un onglet nomme exactement : "' + SHEET_TAB + '"');
  console.log('3. Coller en ligne 1 (A1:H1) les headers suivants :');
  console.log('   workflow_name | workflow_id | execution_id | last_node | error_message | gravite | categorie | horodatage');
  console.log('4. Tester via le workflow "Gestion erreurs NetroIA" dans n8n');
}

main().catch(e => { console.error(e); process.exit(1); });
