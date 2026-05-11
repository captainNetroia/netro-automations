// Fix Logger DataTable : typeVersion 1.1 → 1 (compatible n8n 2.11.2)
const https = require('https');
const fs = require('fs');
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';
const WF_ID = 'pafFHP0oemMaFRMt';

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

  for (const node of wf.nodes) {
    // Logger DataTable : repasser en v1 avec format simple
    if (node.id === '0644609c-1497-4b82-87df-1af5702a2781') {
      console.log('typeVersion avant:', node.typeVersion);
      node.typeVersion = 1;
      node.disabled = false;
      // Format v1 : columns.value = objet simple, pas de schema
      node.parameters = {
        dataTableId: {
          __rl: true,
          value: 'aRZ1JedsE72lla1s',
          mode: 'list',
          cachedResultName: 'Erreur Interne N8N',
        },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            workflow_name : '={{ $json.workflow_name }}',
            workflow_id   : '={{ $json.workflow_id }}',
            execution_id  : '={{ $json.execution_id }}',
            last_node     : '={{ $json.last_node }}',
            error_message : '={{ $json.error_message }}',
            gravite       : '={{ $json.gravite }}',
            categorie     : '={{ $json.categorie }}',
            horodatage    : '={{ $json.timestamp }}',
          },
          matchingColumns: [],
          schema: [],
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
        options: {},
      };
      console.log('Logger DataTable → typeVersion 1, colonnes configurées');
    }
  }

  const put = await apiRequest('PUT', `/api/v1/workflows/${WF_ID}`, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings || {}, staticData: wf.staticData || null,
  });

  if (put.status === 200) {
    const dt = put.body.nodes.find(n => n.id === '0644609c-1497-4b82-87df-1af5702a2781');
    console.log('✅ Mis à jour. typeVersion sauvé:', dt?.typeVersion);
  } else {
    console.error('❌', put.status, JSON.stringify(put.body).slice(0, 200));
  }
}
main().catch(console.error);
