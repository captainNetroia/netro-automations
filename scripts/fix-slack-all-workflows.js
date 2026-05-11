/**
 * Applique le credential Slack qui fonctionne (slackApi cidfXEE5bryWIyKA)
 * sur tous les noeuds Slack du CRM et de Gestion erreurs NetroIA.
 * Format validé par "Organisation Intelligente" (actif) : typeVersion 2.2, slackApi, mode "name"
 */
const https = require('https');
const fs = require('fs');
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';

const SLACK_CRED = { id: 'cidfXEE5bryWIyKA', name: 'Slack account 2' };
const SLACK_CHANNEL = 'n8n-alerts'; // mode name

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: BASE, port: 443, path, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); }});
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function fixWorkflow(wfId, wfLabel, messageBuilder) {
  console.log(`\n[${wfLabel}] Lecture...`);
  const get = await apiRequest('GET', `/api/v1/workflows/${wfId}`);
  const wf = get.body;
  let fixed = 0;

  for (const node of wf.nodes) {
    if (node.type === 'n8n-nodes-base.slack') {
      const msg = messageBuilder(node.name);
      node.typeVersion = 2.2;
      node.credentials = { slackApi: SLACK_CRED };
      // Supprimer authentication oAuth2 — non nécessaire avec slackApi
      delete node.parameters.authentication;
      node.parameters.select = 'channel';
      node.parameters.channelId = { mode: 'name', value: '#' + SLACK_CHANNEL };
      node.parameters.text = msg;
      // Supprimer blocksUi si présent (incompatible avec slackApi simple)
      delete node.parameters.blocksUi;
      delete node.parameters.messageType;
      node.parameters.otherOptions = {};
      console.log(`  ✅ ${node.name} → slackApi ${SLACK_CRED.id}`);
      fixed++;
    }
  }

  if (fixed === 0) { console.log('  Aucun noeud Slack'); return; }

  const put = await apiRequest('PUT', `/api/v1/workflows/${wfId}`, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings || {}, staticData: wf.staticData || null,
  });

  if (put.status === 200) {
    console.log(`  ✅ ${wfLabel} mis à jour`);
  } else {
    console.error(`  ❌ PUT ${put.status}:`, JSON.stringify(put.body).slice(0, 200));
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Fix Slack — credential slackApi validé');
  console.log('='.repeat(60));

  // CRM — message prospect
  await fixWorkflow('9T3KYNvJs6whJDJW', 'CRM', (name) =>
    "=🎯 NOUVEAU PROSPECT NetroIA\n*Nom :* {{ $json.name }}\n*Email :* {{ $('Extraire Valider').first().json.email }}\n*Service :* {{ $json.service }}\n*Budget :* {{ $json.budget_estime }}\n*Urgence :* {{ $json.urgence }}\n*Résumé :* {{ $json.resume_besoins }}"
  );

  // Gestion erreurs NetroIA — message alerte
  await fixWorkflow('pafFHP0oemMaFRMt', 'Gestion erreurs NetroIA', (name) =>
    "={{ $json.gravite === 'P1' ? '🚨 [P1 CRITIQUE]' : '⚠️ [P2 IMPORTANT]' }} {{ $json.workflow_name }}\n*Noeud :* {{ $json.last_node }}\n*Erreur :* {{ $json.error_message }}\n*Catégorie :* {{ $json.categorie }}\n{{ $json.timestamp }}"
  );

  console.log('\n' + '='.repeat(60));
  console.log('DONE — Tester le formulaire netroia.tech');
  console.log('='.repeat(60));
}

main().catch(console.error);
