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
  const wf = await get('9T3KYNvJs6whJDJW');
  console.log('=== Extraire Valider (Code node) ===');
  const ev = wf.nodes.find(n => n.name === 'Extraire Valider');
  if (ev) {
    console.log('typeVersion:', ev.typeVersion);
    console.log('jsCode:\n', ev.parameters.jsCode);
  }

  console.log('\n=== Envoyer Email (Gmail node) ===');
  const gmail = wf.nodes.find(n => n.name === 'Envoyer Email');
  if (gmail) {
    console.log('typeVersion:', gmail.typeVersion);
    console.log('sendTo:', gmail.parameters.sendTo);
    console.log('subject:', gmail.parameters.subject);
    console.log('options:', JSON.stringify(gmail.parameters.options));
  }

  console.log('\n=== Preparer Classification (Set node) ===');
  const prep = wf.nodes.find(n => n.name === 'Preparer Classification');
  if (prep) {
    console.log(JSON.stringify(prep.parameters, null, 2).slice(0, 600));
  }
}

main().catch(console.error);
