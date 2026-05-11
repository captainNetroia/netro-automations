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
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.on('error', reject); req.end();
  });
}

async function main() {
  const wf = await get('026FLd5tS2zyoF9O'); // Organisation Intelligente — actif
  console.log('=== Slack nodes dans Organisation Intelligente ===');
  wf.nodes.filter(n => n.type === 'n8n-nodes-base.slack').forEach(n => {
    console.log('Nom:', n.name);
    console.log('typeVersion:', n.typeVersion);
    console.log('credentials:', JSON.stringify(n.credentials));
    console.log('authentication:', n.parameters.authentication);
    console.log('select:', n.parameters.select);
    console.log('channelId:', JSON.stringify(n.parameters.channelId));
    console.log('---');
  });
}
main().catch(console.error);
