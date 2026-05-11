// Fix credential Slack dans CRM : remplace HQ7TA73vHn5QPIQs par F0fwc1wXChlIz1fb
const https = require('https');
const fs = require('fs');
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';
const WF_ID = '9T3KYNvJs6whJDJW';

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

async function main() {
  const get = await apiRequest('GET', `/api/v1/workflows/${WF_ID}`);
  const wf = get.body;
  let fixed = 0;

  for (const node of wf.nodes) {
    if (node.type === 'n8n-nodes-base.slack') {
      const before = node.credentials?.slackOAuth2Api?.id;
      node.credentials = {
        slackOAuth2Api: { id: 'F0fwc1wXChlIz1fb', name: 'NetroIA Error N8N' }
      };
      console.log(`Slack "${node.name}" : ${before} → F0fwc1wXChlIz1fb`);
      fixed++;
    }
  }

  if (fixed === 0) { console.log('Aucun noeud Slack trouvé'); return; }

  const put = await apiRequest('PUT', `/api/v1/workflows/${WF_ID}`, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings || {}, staticData: wf.staticData || null,
  });

  if (put.status === 200) {
    const slackNodes = put.body.nodes.filter(n => n.type === 'n8n-nodes-base.slack');
    slackNodes.forEach(n => console.log(`✅ ${n.name} → credential: ${n.credentials?.slackOAuth2Api?.id}`));
  } else {
    console.error('❌', put.status, JSON.stringify(put.body).slice(0, 200));
  }
}
main().catch(console.error);
