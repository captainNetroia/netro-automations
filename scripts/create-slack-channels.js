#!/usr/bin/env node
/**
 * create-slack-channels.js
 * 1. Crée un workflow n8n temporaire avec Webhook + Slack (create channels)
 * 2. Active + appelle le webhook → récupère les IDs des deux canaux
 * 3. Si succès → supprime le workflow temp + met à jour les workflows de production
 *
 * Canaux créés :
 *  - #alertes-erreurs-netroia  → Gestion erreurs NetroIA
 *  - #prospects-netroia        → Agent formulaire contact Terminal IA
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY    = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const HOST       = 'n8n.netroia.tech';

const SLACK_CRED = { id: 'HQ7TA73vHn5QPIQs', name: 'Slack account' };

// Workflow IDs de production
const ERROR_WF_ID  = 'pafFHP0oemMaFRMt'; // Gestion erreurs NetroIA
const AGENT_WF_ID  = 'Icz9Mh20mWcZHHQy'; // Agent formulaire contact Terminal IA

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

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET' };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function postWebhook(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = JSON.stringify(body);
    const opts = {
      hostname: u.hostname, port: 443, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Workflow temporaire ────────────────────────────────────────────────────
function buildTempWorkflow() {
  const N = {
    webhook:    'Trigger',
    createErr:  'Create alertes-erreurs-netroia',
    createPros: 'Create prospects-netroia',
    respond:    'Return IDs',
  };

  return {
    name: '__TEMP__ Create Slack Channels',
    nodes: [
      {
        id: 'wh-1', name: N.webhook, type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: [0, 0],
        parameters: { path: 'create-slack-channels', httpMethod: 'POST', responseMode: 'responseNode' },
        webhookId: 'create-slack-channels-temp',
      },
      {
        id: 'sl-1', name: N.createErr, type: 'n8n-nodes-base.slack',
        typeVersion: 2.4, position: [300, 0],
        continueOnFail: true,
        credentials: { slackOAuth2Api: SLACK_CRED },
        parameters: {
          authentication: 'oAuth2',
          select: 'channel',
          operation: 'create',
          channelId: { __rl: true, value: 'alertes-erreurs-netroia', mode: 'name' },
          otherOptions: {},
        },
      },
      {
        id: 'sl-2', name: N.createPros, type: 'n8n-nodes-base.slack',
        typeVersion: 2.4, position: [600, 0],
        continueOnFail: true,
        credentials: { slackOAuth2Api: SLACK_CRED },
        parameters: {
          authentication: 'oAuth2',
          select: 'channel',
          operation: 'create',
          channelId: { __rl: true, value: 'prospects-netroia', mode: 'name' },
          otherOptions: {},
        },
      },
      {
        id: 'rsp-1', name: N.respond, type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1, position: [900, 0],
        parameters: {
          respondWith: 'json',
          responseBody: '={{ JSON.stringify({ "alertes_id": $("' + N.createErr + '").first()?.json?.id || null, "alertes_name": $("' + N.createErr + '").first()?.json?.name || null, "prospects_id": $("' + N.createPros + '").first()?.json?.id || null, "prospects_name": $("' + N.createPros + '").first()?.json?.name || null }) }}',
          options: {},
        },
      },
    ],
    connections: {
      [N.webhook]:    { main: [[{ node: N.createErr,  type: 'main', index: 0 }]] },
      [N.createErr]:  { main: [[{ node: N.createPros, type: 'main', index: 0 }]] },
      [N.createPros]: { main: [[{ node: N.respond,    type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

// ─── Patch workflows de production ─────────────────────────────────────────
async function patchProductionWorkflow(wfId, nodeName, channelId, channelName) {
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${wfId}`);
  if (status !== 200) { console.log(`  GET ${wfId} error:`, status); return; }

  const node = wf.nodes.find(n => n.name === nodeName);
  if (!node) { console.log(`  Noeud "${nodeName}" introuvable dans ${wfId}`); return; }

  // Mettre à jour le canal
  if (node.parameters?.channelId) {
    node.parameters.channelId = { __rl: true, value: channelId, mode: 'list', cachedResultName: channelName };
  } else if (node.parameters?.channel) {
    node.parameters.channel = { __rl: true, value: channelId, mode: 'list', cachedResultName: channelName };
  }

  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings, staticData: wf.staticData || null };
  const put = await request('PUT', `/api/v1/workflows/${wfId}`, payload);
  if (put.status !== 200) {
    console.log(`  PUT ${wfId} error:`, put.status, JSON.stringify(put.body).slice(0, 150));
  } else {
    console.log(`  OK — "${nodeName}" → #${channelName} (${channelId})`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('1. Creation du workflow temporaire...');
  const create = await request('POST', '/api/v1/workflows', buildTempWorkflow());
  if (create.status !== 200) { console.error('Create error:', create.status, create.body); process.exit(1); }
  const tempId = create.body.id;
  console.log('   ID:', tempId);

  console.log('2. Activation...');
  const act = await request('POST', `/api/v1/workflows/${tempId}/activate`);
  if (act.status !== 200) { console.log('   Activation API error (400 connu n8n), test webhook quand meme...'); }
  else { console.log('   OK'); }

  await sleep(2000);

  console.log('3. Appel webhook pour creer les canaux...');
  let channelResult = null;
  try {
    const resp = await postWebhook(`https://${HOST}/webhook/create-slack-channels`, { trigger: true });
    console.log('   Reponse:', JSON.stringify(resp.body));
    if (resp.body && typeof resp.body === 'object') channelResult = resp.body;
  } catch (e) {
    console.log('   Webhook error:', e.message);
  }

  console.log('4. Suppression du workflow temporaire...');
  await request('DELETE', `/api/v1/workflows/${tempId}`);
  console.log('   OK');

  if (!channelResult || (!channelResult.alertes_id && !channelResult.prospects_id)) {
    console.log('\n⚠️  Les canaux Slack n\'ont pas pu etre crees automatiquement (permissions insuffisantes).');
    console.log('   Action manuelle requise — voir instructions ci-dessous.');
    console.log('\n  Pour creer les canaux manuellement dans Slack :');
    console.log('  1. Creer #alertes-erreurs-netroia + inviter le bot (@netroIA ou votre bot)');
    console.log('  2. Creer #prospects-netroia + inviter le bot');
    console.log('  3. Pour chaque canal : clic droit → Voir les details → copier l\'ID (format C0XXXXXXXX)');
    console.log('  4. Relancer ce script avec : node scripts/create-slack-channels.js <id_erreurs> <id_prospects>');
    return;
  }

  const alertesId   = channelResult.alertes_id;
  const alertesName = channelResult.alertes_name || 'alertes-erreurs-netroia';
  const prospectsId   = channelResult.prospects_id;
  const prospectsName = channelResult.prospects_name || 'prospects-netroia';

  console.log(`\n   Canal erreurs   : #${alertesName} (${alertesId})`);
  console.log(`   Canal prospects : #${prospectsName} (${prospectsId})`);

  console.log('\n5. Mise a jour des workflows de production...');
  if (alertesId) {
    await patchProductionWorkflow(ERROR_WF_ID, 'Slack Alerte', alertesId, alertesName);
  }
  if (prospectsId) {
    await patchProductionWorkflow(AGENT_WF_ID, 'Alerte Slack', prospectsId, prospectsName);
  }

  console.log('\nDone. Les deux canaux Slack sont configures et actifs.');
  console.log('Penser a inviter le bot dans les deux canaux si ce n\'est pas deja fait.');
}

// Support mode manuel: node script.js <alertes_id> <prospects_id>
if (process.argv[2] && process.argv[3]) {
  const alertesId   = process.argv[2];
  const prospectsId = process.argv[3];
  console.log('Mode manuel — IDs fournis:', alertesId, prospectsId);
  Promise.all([
    patchProductionWorkflow(ERROR_WF_ID, 'Slack Alerte', alertesId, 'alertes-erreurs-netroia'),
    patchProductionWorkflow(AGENT_WF_ID, 'Alerte Slack', prospectsId, 'prospects-netroia'),
  ]).then(() => console.log('Done.')).catch(console.error);
} else {
  main().catch(e => { console.error(e); process.exit(1); });
}
