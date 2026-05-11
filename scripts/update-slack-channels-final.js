#!/usr/bin/env node
/**
 * update-slack-channels-final.js
 * Met à jour les deux workflows avec les vrais canaux Slack et la bonne credential.
 *
 * Gestion erreurs NetroIA (pafFHP0oemMaFRMt)
 *   → Slack Alerte : #alertes-erreurs-netroia (C0B27DFSWEA)
 *   → credential : F0fwc1wXChlIz1fb (NetroIA Error N8N)
 *
 * Agent formulaire contact Terminal IA (Icz9Mh20mWcZHHQy)
 *   → Alerte Slack : #prospects-netroia (C0B263XRH6Z)
 *   → credential : F0fwc1wXChlIz1fb (NetroIA Error N8N)
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY    = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const HOST       = 'n8n.netroia.tech';

const SLACK_CRED = { id: 'F0fwc1wXChlIz1fb', name: 'NetroIA Error N8N' };

const UPDATES = [
  {
    wfId:     'pafFHP0oemMaFRMt',
    wfName:   'Gestion erreurs NetroIA',
    nodeName: 'Slack Alerte',
    channelId:   'C0B27DFSWEA',
    channelName: 'alertes-erreurs-netroia',
  },
  {
    wfId:     'Icz9Mh20mWcZHHQy',
    wfName:   'Agent formulaire contact Terminal IA',
    nodeName: 'Alerte Slack',
    channelId:   'C0B263XRH6Z',
    channelName: 'prospects-netroia',
  },
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

async function updateWorkflow({ wfId, wfName, nodeName, channelId, channelName }) {
  console.log(`\n[${wfName}]`);
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${wfId}`);
  if (status !== 200) { console.log('  GET error:', status); return; }

  const node = wf.nodes.find(n => n.name === nodeName);
  if (!node) { console.log(`  Noeud "${nodeName}" introuvable`); return; }

  // Credential → NetroIA Error N8N
  node.credentials = { slackOAuth2Api: SLACK_CRED };

  // Canal → nouveau canal dédié
  if (node.parameters?.channelId) {
    node.parameters.channelId = { __rl: true, value: channelId, mode: 'list', cachedResultName: channelName };
  } else if (node.parameters?.channel) {
    node.parameters.channel = { __rl: true, value: channelId, mode: 'list', cachedResultName: channelName };
  }

  // S'assurer authentication oAuth2 + typeVersion 2.4
  node.typeVersion = 2.4;
  if (node.parameters) node.parameters.authentication = 'oAuth2';

  console.log(`  Noeud "${nodeName}" → #${channelName} (${channelId}) | cred: F0fwc1wXChlIz1fb`);

  const payload = {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    wf.settings,
    staticData:  wf.staticData || null,
  };

  const put = await request('PUT', `/api/v1/workflows/${wfId}`, payload);
  if (put.status !== 200) {
    console.log('  PUT error:', put.status, JSON.stringify(put.body).slice(0, 200));
  } else {
    console.log('  OK');
  }
}

async function main() {
  for (const update of UPDATES) {
    await updateWorkflow(update);
  }
  console.log('\nDone. Test Slack en cours...');

  // Test rapide webhook pour déclencher une alerte prospect
  const testHttps = require('https');
  const data = JSON.stringify({
    name: 'Test Canal Prospects', email: 'captain@netroia.com',
    service: 'avance', message: 'Test validation nouveau canal #prospects-netroia', source: 'netroia.tech',
  });
  await new Promise(resolve => {
    const req = testHttps.request({
      hostname: HOST, port: 443, path: '/webhook/contact-netroia', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => { res.resume(); res.on('end', resolve); });
    req.write(data); req.end();
  });
  console.log('  Webhook test envoye → verifie #prospects-netroia dans Slack');
}

main().catch(e => { console.error(e); process.exit(1); });
