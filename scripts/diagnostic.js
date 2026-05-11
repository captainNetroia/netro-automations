/**
 * Diagnostic — inspecte les deux workflows problematiques
 */
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
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // --- CRM ---
  console.log('\n=== CRM FORMULAIRE CONTACT (9T3KYNvJs6whJDJW) ===');
  const crm = await get('9T3KYNvJs6whJDJW');
  const crmNodes = crm.body.nodes || [];
  const gmailNode = crmNodes.find(n => n.name === 'Envoyer Email');
  if (gmailNode) {
    console.log('Gmail node params:');
    console.log(JSON.stringify(gmailNode.parameters, null, 2));
  }
  const missionNode = crmNodes.find(n => n.name === 'Document Mission');
  if (missionNode) {
    console.log('\nDocument Mission jsCode (100 premiers chars):');
    const code = missionNode.parameters.jsCode || '';
    console.log(code.slice(0, 800));
  }

  // --- ERROR WF ---
  console.log('\n=== GESTION ERREURS PRO (ArdqPkZkSRCd0EpL) ===');
  const ewf = await get('ArdqPkZkSRCd0EpL');
  console.log('Status API:', ewf.status);
  console.log('Nom:', ewf.body.name);
  console.log('Nb noeuds:', (ewf.body.nodes || []).length);
  console.log('Active:', ewf.body.active);
  if ((ewf.body.nodes || []).length > 0) {
    console.log('Noeuds:');
    ewf.body.nodes.forEach(n => console.log(' -', n.name, '|', n.type));
  }
}

main().catch(console.error);
