const https = require('https');
const fs = require('fs');
const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'n8n.netroia.tech', port: 443, path, method: 'GET',
      headers: { 'X-N8N-API-KEY': API_KEY },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.on('error', reject); req.end();
  });
}

async function main() {
  // Credentials
  console.log('=== CREDENTIALS ===');
  const creds = await get('/api/v1/credentials?limit=50');
  (creds.data || []).forEach(c => console.log(`ID: ${c.id} | Type: ${c.type} | Nom: ${c.name}`));

  // DataTables
  console.log('\n=== DATA TABLES ===');
  const dt = await get('/api/v1/data-store/tables?limit=50');
  const tables = dt.data || dt.tables || dt || [];
  if (Array.isArray(tables)) {
    tables.forEach(t => console.log(`ID: ${t.id} | Nom: ${t.name}`));
  } else {
    console.log(JSON.stringify(dt).slice(0, 500));
  }
}
main().catch(console.error);
