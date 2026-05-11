/**
 * Activate "NetroIA - Gestion Erreurs Pro" and set it as Error Workflow
 * on all other active workflows.
 */
const https = require('https');
const fs = require('fs');

// Load .env manually (no dotenv dependency)
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';
const ERROR_WF_ID = 'ArdqPkZkSRCd0EpL';

// Workflows to update (all except the error workflow itself and Debbug reference)
const WORKFLOWS_TO_UPDATE = [
  { id: '9T3KYNvJs6whJDJW', name: 'NetroIA - CRM Formulaire Contact' },
  { id: 'kEWsfjG2pHRSkZq0', name: 'Mail Perso NetroIA v2' },
  { id: '026FLd5tS2zyoF9O', name: 'Organisation Intelligente des Urgences' },
];

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BASE,
      port: 443,
      path,
      method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Only send fields allowed by n8n PUT /workflows/:id
function cleanForPut(wf) {
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
    staticData: wf.staticData || null,
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Activation + Liaison Error Workflow Pro');
  console.log('='.repeat(60));

  // Step 1: Try to activate the error workflow
  console.log('\n[1] Activation de "NetroIA - Gestion Erreurs Pro"...');
  const act = await apiRequest('POST', `/api/v1/workflows/${ERROR_WF_ID}/activate`);
  if (act.status === 200) {
    console.log('  OK Workflow ACTIVE');
  } else {
    console.log(`  Status ${act.status}:`, JSON.stringify(act.body).slice(0, 300));
    // Check current state
    const check = await apiRequest('GET', `/api/v1/workflows/${ERROR_WF_ID}`);
    if (check.status === 200) {
      console.log('  Etat actuel active:', check.body.active);
      if (check.body.active) console.log('  -> Deja actif, OK');
    }
  }

  // Step 2: For each workflow, GET full definition, patch settings.errorWorkflow, PUT back
  for (const wf of WORKFLOWS_TO_UPDATE) {
    console.log(`\n[2] Error workflow -> ${wf.name} (${wf.id})`);

    const get = await apiRequest('GET', `/api/v1/workflows/${wf.id}`);
    if (get.status !== 200) {
      console.log(`  ERREUR GET (${get.status})`);
      continue;
    }

    const workflow = get.body;
    if (!workflow.settings) workflow.settings = {};
    workflow.settings.errorWorkflow = ERROR_WF_ID;

    // Strip fields not allowed by PUT
    const putBody = cleanForPut(workflow);
    const put = await apiRequest('PUT', `/api/v1/workflows/${wf.id}`, putBody);
    if (put.status === 200) {
      const saved = put.body.settings && put.body.settings.errorWorkflow;
      console.log(`  OK Error workflow configure -> ${saved || ERROR_WF_ID}`);
    } else {
      console.log(`  ERREUR PUT (${put.status}):`, JSON.stringify(put.body).slice(0, 300));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('DONE');
  console.log('  Activer manuellement si needed : n8n UI -> toggle Active');
  console.log('  Verifier DataTable colonnes :');
  console.log('    empreinte_erreur | gravite | categorie | occurrences | horodatage_dernier');
  console.log('='.repeat(60));
}

main().catch(console.error);
