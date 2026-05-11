// Compare les Slack nodes du CRM (actif) vs Error WF (inactif)
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
  // CRM (actif) - Slack node
  console.log('=== CRM Slack node ===');
  const crm = await get('9T3KYNvJs6whJDJW');
  const crmSlack = crm.nodes.find(n => n.type === 'n8n-nodes-base.slack');
  if (crmSlack) {
    console.log('typeVersion:', crmSlack.typeVersion);
    console.log(JSON.stringify(crmSlack.parameters, null, 2).slice(0, 600));
  }

  // Organisation Intelligente (actif) - Slack node
  console.log('\n=== Organisation Intelligente Slack nodes ===');
  const org = await get('026FLd5tS2zyoF9O');
  org.nodes.filter(n => n.type === 'n8n-nodes-base.slack').forEach(n => {
    console.log('--- Name:', n.name, '| typeVersion:', n.typeVersion);
    console.log(JSON.stringify(n.parameters, null, 2).slice(0, 400));
  });

  // Error WF - Slack nodes
  console.log('\n=== Error WF Slack nodes ===');
  const ewf = await get('ArdqPkZkSRCd0EpL');
  ewf.nodes.filter(n => n.type === 'n8n-nodes-base.slack').forEach(n => {
    console.log('--- Name:', n.name, '| typeVersion:', n.typeVersion);
    console.log(JSON.stringify(n.parameters, null, 2).slice(0, 600));
  });

  // Aussi Gmail
  console.log('\n=== Error WF Gmail node ===');
  const gmail = ewf.nodes.find(n => n.type === 'n8n-nodes-base.gmail');
  if (gmail) {
    console.log('typeVersion:', gmail.typeVersion);
    console.log(JSON.stringify(gmail.parameters, null, 2).slice(0, 400));
  }
}

main().catch(console.error);
