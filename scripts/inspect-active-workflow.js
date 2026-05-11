// Inspecte le workflow "Organisation Intelligente des Urgences" (actif)
// pour voir le format exact des noeuds Switch/If/Code qu'il utilise
const https = require('https');
const fs = require('fs');
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();

function get(id) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'n8n.netroia.tech', port: 443,
      path: `/api/v1/workflows/${id}`, method: 'GET',
      headers: { 'X-N8N-API-KEY': API_KEY },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const wf = await get('026FLd5tS2zyoF9O');
  console.log('Noeuds dans Organisation Intelligente des Urgences :');
  wf.nodes.forEach(n => {
    if (['n8n-nodes-base.switch', 'n8n-nodes-base.if'].includes(n.type)) {
      console.log('\n--- NOEUD:', n.name, '|', n.type, 'v' + n.typeVersion);
      console.log(JSON.stringify(n.parameters, null, 2));
    }
  });

  // Aussi regarder le error workflow pour les noeuds Switch/DataTable
  console.log('\n\n=== GESTION ERREURS PRO — Switch + DataTable ===');
  const ewf = await get('ArdqPkZkSRCd0EpL');
  ewf.nodes.forEach(n => {
    if (['n8n-nodes-base.switch', 'n8n-nodes-base.dataTable'].includes(n.type)) {
      console.log('\n--- NOEUD:', n.name, '|', n.type, 'v' + n.typeVersion);
      console.log(JSON.stringify(n.parameters, null, 2));
    }
  });
}

main().catch(console.error);
