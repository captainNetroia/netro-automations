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
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.end();
  });
}

async function main() {
  // Supprimer NetroIA Gestion Erreurs Pro (workflow vide problématique)
  const del = await new Promise((resolve, reject) => {
    const req = require('https').request({
      hostname: 'n8n.netroia.tech', port: 443,
      path: '/api/v1/workflows/MCkTHxIspjJvwT5q', method: 'DELETE',
      headers: { 'X-N8N-API-KEY': API_KEY },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  console.log('Suppression NetroIA Gestion Erreurs Pro:', del);

  // Lire Safety Net
  const wf = await get('pafFHP0oemMaFRMt');
  console.log('\n=== Safety Net ===');
  console.log('Nom:', wf.name);
  console.log('Active:', wf.active);
  console.log('Noeuds:');
  wf.nodes.forEach(n => console.log(' -', n.name, '|', n.type, 'v'+n.typeVersion));
  console.log('\nConnexions:', JSON.stringify(Object.keys(wf.connections)));

  // Sauvegarder pour analyse
  fs.writeFileSync('C:/Netroia/netro-automations/workflows/templates/error-handling/safety-net-original.json', JSON.stringify(wf, null, 2));
  console.log('\nSauvegardé dans safety-net-original.json');

  // Afficher chaque noeud en détail
  wf.nodes.forEach(n => {
    if (n.type !== 'n8n-nodes-base.stickyNote') {
      console.log('\n--- ', n.name, '---');
      console.log(JSON.stringify(n.parameters, null, 2).slice(0, 400));
    }
  });
}
main().catch(console.error);
