#!/usr/bin/env node
/**
 * fix-error-slack-v2.js
 * Met à jour le noeud Slack Alerte dans Gestion erreurs NetroIA :
 * - typeVersion 2.2 → 2.4
 * - Ajoute authentication: "oAuth2" dans parameters
 * - Met à jour channel vers channelId format __rl
 * - Credentials → slackOAuth2Api HQ7TA73vHn5QPIQs
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
  console.log('1. Recuperation workflow...');
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${WF_ID}`);
  if (status !== 200) { console.error('GET error:', status); process.exit(1); }

  const slackNode = wf.nodes.find(n => n.name === 'Slack Alerte');
  if (!slackNode) { console.error('Noeud Slack Alerte introuvable'); process.exit(1); }

  console.log('  Avant: typeVersion', slackNode.typeVersion, '| auth:', slackNode.parameters?.authentication || 'NONE');

  // Update typeVersion
  slackNode.typeVersion = 2.4;

  // Update credentials
  slackNode.credentials = {
    slackOAuth2Api: { id: 'HQ7TA73vHn5QPIQs', name: 'Slack account' }
  };

  // Rebuild parameters with proper auth + channel format
  const existingText = slackNode.parameters?.text || '={{ $json.gravite }} Erreur workflow: {{ $json.workflow_name }} — {{ $json.error_message }}';
  slackNode.parameters = {
    authentication: 'oAuth2',
    select: 'channel',
    channelId: {
      __rl: true,
      value: 'C0A8SHN845D',
      mode: 'list',
      cachedResultName: 'n8n-alerts',
    },
    messageType: 'text',
    text: existingText,
    otherOptions: {},
  };

  slackNode.continueOnFail = true;

  console.log('2. Slack Alerte — typeVersion 2.4, authentication: oAuth2, credential: HQ7TA73vHn5QPIQs');

  const payload = {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    wf.settings,
    staticData:  wf.staticData || null,
  };

  console.log('3. PUT...');
  const put = await request('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  if (put.status !== 200) {
    console.error('PUT error:', put.status, JSON.stringify(put.body).slice(0, 300));
    process.exit(1);
  }
  console.log('   OK — workflow mis a jour');
}

main().catch(e => { console.error(e); process.exit(1); });
