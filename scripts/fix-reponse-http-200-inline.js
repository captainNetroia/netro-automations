/**
 * fix-reponse-http-200-inline.js
 * Recâble Reponse HTTP 200 en ligne :
 *   Valider Contact → Reponse HTTP 200 → Donnees Source
 * Au lieu du fan-out qui restait synchrone.
 */

const https = require('https');

const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGE5OTU2NC05MWNmLTRlYjQtYjZkOC0wZDU2M2NhODFlNzQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiY2YzNWZjNGUtZWU1Yy00Y2M5LWE1MDEtYjFmMmU3ODMyOTJmIiwiaWF0IjoxNzc1MzkwMDQ5fQ.Ae61Gjr8gsl_U7ElTWuEWT1JQldaOrK3uYvviTaKD4M';
const N8N_HOST = 'n8n.netroia.tech';
const WF_ID   = 'Icz9Mh20mWcZHHQy';

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: N8N_HOST, port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('[1] Récupération workflow...');
  const get = await apiRequest('GET', `/api/v1/workflows/${WF_ID}`);
  if (get.status !== 200) { console.error('GET échoué:', get.body); process.exit(1); }
  const wf = get.body;
  console.log('    Nodes:', wf.nodes.length, '| active:', wf.active);

  // Vérifier que "Reponse HTTP 200" existe
  const rNode = wf.nodes.find(n => n.name === 'Reponse HTTP 200');
  if (!rNode) { console.error('Noeud "Reponse HTTP 200" introuvable'); process.exit(1); }
  console.log('    Noeud "Reponse HTTP 200" trouvé pos:', rNode.position);

  const conn = wf.connections;

  // --- Connexions cibles ---
  // Valider Contact → Reponse HTTP 200 (seulement)
  conn['Valider Contact'].main[0] = [
    { node: 'Reponse HTTP 200', type: 'main', index: 0 }
  ];

  // Reponse HTTP 200 → Donnees Source (passe les données downstream)
  conn['Reponse HTTP 200'] = {
    main: [
      [{ node: 'Donnees Source', type: 'main', index: 0 }]
    ]
  };

  console.log('[2] Connexions après patch:');
  console.log('    Valider Contact ->', conn['Valider Contact'].main[0].map(c => c.node));
  console.log('    Reponse HTTP 200 ->', conn['Reponse HTTP 200'].main[0].map(c => c.node));

  // PUT
  const payload = {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: conn,
    settings:    { executionOrder: 'v1' },
  };

  console.log('[3] PUT workflow...');
  const put = await apiRequest('PUT', `/api/v1/workflows/${WF_ID}`, payload);
  if (put.status !== 200) {
    console.error('PUT échoué HTTP', put.status, JSON.stringify(put.body, null, 2));
    process.exit(1);
  }
  console.log('    PUT OK — nodes:', put.body.nodes.length, '| active:', put.body.active);
  console.log('\n[DONE] Workflow recâblé.');
  console.log('  Flux formulaire : Valider Contact → Reponse HTTP 200 → Donnees Source → AI pipeline');
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
