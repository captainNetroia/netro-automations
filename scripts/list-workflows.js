const https = require('https');
const fs = require('fs');
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();

const options = {
  hostname: 'n8n.netroia.tech', port: 443,
  path: '/api/v1/workflows?limit=50', method: 'GET',
  headers: { 'X-N8N-API-KEY': API_KEY },
};
https.request(options, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const j = JSON.parse(data);
    (j.data || []).forEach(wf => {
      console.log(`ID: ${wf.id} | Active: ${wf.active} | Nom: ${wf.name}`);
    });
  });
}).end();
