#!/usr/bin/env node
/**
 * fix-slack-credential-type.js
 * F0fwc1wXChlIz1fb est un slackApi (Bot Token), pas slackOAuth2Api.
 * On passe les deux noeuds Slack en authentication: 'accessToken' + slackApi.
 */
const https = require('https');
const fs    = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY    = envContent.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();
const HOST       = 'n8n.netroia.tech';

const SLACK_CRED = { id: 'F0fwc1wXChlIz1fb', name: 'NetroIA Error N8N' };

const UPDATES = [
  { wfId: 'pafFHP0oemMaFRMt', nodeName: 'Slack Alerte',  channelId: 'C0B27DFSWEA', channelName: 'alertes-erreurs-netroia' },
  { wfId: 'Icz9Mh20mWcZHHQy', nodeName: 'Alerte Slack',  channelId: 'C0B263XRH6Z', channelName: 'prospects-netroia'       },
];

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: HOST, port: 443, path, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function patch({ wfId, nodeName, channelId, channelName }) {
  const { status, body: wf } = await request('GET', `/api/v1/workflows/${wfId}`);
  if (status !== 200) { console.log('GET error', status); return; }

  const node = wf.nodes.find(n => n.name === nodeName);
  if (!node) { console.log('Noeud introuvable:', nodeName); return; }

  // slackApi Bot Token (pas OAuth2)
  node.credentials = { slackApi: SLACK_CRED };
  node.typeVersion  = 2.4;
  node.parameters.authentication = 'accessToken';

  // Canal
  const chVal = { __rl: true, value: channelId, mode: 'list', cachedResultName: channelName };
  if (node.parameters.channelId !== undefined) node.parameters.channelId = chVal;
  else if (node.parameters.channel !== undefined) node.parameters.channel = chVal;

  const put = await request('PUT', `/api/v1/workflows/${wfId}`,
    { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings, staticData: wf.staticData || null });

  if (put.status !== 200) console.log(`  FAIL [${nodeName}]:`, JSON.stringify(put.body).slice(0, 200));
  else console.log(`  OK   [${nodeName}] → #${channelName} | slackApi F0fwc1wXChlIz1fb`);
}

async function main() {
  for (const u of UPDATES) await patch(u);

  // Test
  console.log('\nTest webhook...');
  const data = JSON.stringify({ name:'Test Slack Fix', email:'captain@netroia.com', service:'avance', message:'Validation canaux Slack dedies', source:'netroia.tech' });
  await new Promise(r => {
    const req = https.request({ hostname: HOST, port: 443, path: '/webhook/contact-netroia', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { res.resume(); res.on('end', r); });
    req.write(data); req.end();
  });
  console.log('  Envoye → verifie #prospects-netroia dans Slack');
}

main().catch(e => { console.error(e); process.exit(1); });
