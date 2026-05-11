#!/usr/bin/env node
/**
 * fix-error-workflow-slack.js
 * Remplace la credential Slack manquante (cidfXEE5bryWIyKA / slackApi)
 * par HQ7TA73vHn5QPIQs (slackOAuth2Api — "Slack account") dans Gestion erreurs NetroIA.
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY    = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const HOST       = 'n8n.netroia.tech';
const WF_ID      = 'pafFHP0oemMaFRMt';

// Credential Slack OAuth2 existant
const SLACK_CRED = { id: 'HQ7TA73vHn5QPIQs', name: 'Slack account' };

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

  const slackNode = wf.nodes.find(n => n.name === 'Slack Alerte');
  if (!slackNode) { console.error('Noeud Slack Alerte introuvable'); process.exit(1); }

  // Remplacer slackApi par slackOAuth2Api
  slackNode.credentials = { slackOAuth2Api: SLACK_CRED };

  // Aussi mettre le canal en ID direct pour plus de robustesse
  if (slackNode.parameters?.channel) {
    slackNode.parameters.channel = {
      __rl: true,
      value: 'C0A8SHN845D',
      mode: 'list',
      cachedResultName: 'n8n-alerts',
    };
  }

  // continueOnFail sur Slack aussi
  slackNode.continueOnFail = true;

  console.log('2. Slack Alerte — credential: slackApi → slackOAuth2Api (HQ7TA73vHn5QPIQs)');

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
    console.error('PUT error:', put.status, JSON.stringify(put.body).slice(0,200));
    process.exit(1);
  }
  console.log('   OK');
}

main().catch(e => { console.error(e); process.exit(1); });
