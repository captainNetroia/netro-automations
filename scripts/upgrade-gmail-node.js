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

  let changed = 0;
  for (const node of wf.nodes) {
    // Upgrade Gmail 2.1 -> 2.2
    if (node.name === 'Envoyer Email' && node.type === 'n8n-nodes-base.gmail') {
      console.log('Gmail typeVersion avant:', node.typeVersion);
      node.typeVersion = 2.2;
      // Aussi s'assurer que sendTo est correct
      node.parameters.sendTo = "={{ $('Extraire Valider').first().json.email }}";
      node.parameters.subject = "={{ $json.email_subject || 'Votre demande NetroIA' }}";
      console.log('Gmail typeVersion après:', node.typeVersion);
      console.log('sendTo:', node.parameters.sendTo);
      changed++;
    }
  }

  if (changed === 0) { console.log('Noeud Envoyer Email non trouvé'); return; }

  const put = await apiRequest('PUT', `/api/v1/workflows/${WF_ID}`, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings || {}, staticData: wf.staticData || null,
  });

  if (put.status === 200) {
    const g = put.body.nodes.find(n => n.name === 'Envoyer Email');
    console.log('\n✅ Mis à jour. typeVersion sauvé:', g?.typeVersion, '| sendTo:', g?.parameters?.sendTo);
  } else {
    console.error('❌', put.status, JSON.stringify(put.body).slice(0, 200));
  }
}
main().catch(console.error);
