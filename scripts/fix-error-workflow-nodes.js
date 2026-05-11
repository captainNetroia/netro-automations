/**
 * Patch le workflow "NetroIA - Gestion Erreurs Pro" pour corriger
 * les parametres invalides qui bloquent l'activation.
 *
 * Problemes identifies :
 * - Switch "Router Gravite" : options.fallbackOutput = 'none' invalide dans n8n 2.11.2
 * - DataTable "Verifier Doublon" : options.limit non supporte par getAll
 */
const https = require('https');
const fs = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';
const WF_ID = 'ArdqPkZkSRCd0EpL';

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BASE, port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Patch workflow — suppression parametres invalides');
  console.log('='.repeat(60));

  // 1. GET le workflow complet
  console.log('\n[1] Lecture du workflow...');
  const get = await apiRequest('GET', `/api/v1/workflows/${WF_ID}`);
  if (get.status !== 200) {
    console.error('ERREUR GET:', get.status, JSON.stringify(get.body).slice(0, 200));
    process.exit(1);
  }
  const wf = get.body;
  console.log(`  Noeuds: ${wf.nodes.length}`);

  // 2. Patcher les noeuds problematiques
  console.log('\n[2] Correction des noeuds...');
  let patchCount = 0;

  for (const node of wf.nodes) {
    // Fix Switch node : supprimer fallbackOutput invalide
    if (node.name === 'Router Gravite' && node.type === 'n8n-nodes-base.switch') {
      if (node.parameters.options && node.parameters.options.fallbackOutput !== undefined) {
        delete node.parameters.options.fallbackOutput;
        console.log('  Router Gravite : supprime options.fallbackOutput');
        patchCount++;
      }
      // S'assurer que options est vide si plus rien dedans
      if (node.parameters.options && Object.keys(node.parameters.options).length === 0) {
        node.parameters.options = {};
      }
    }

    // Fix DataTable getAll : supprimer options.limit non supporte
    if (node.name === 'Verifier Doublon' && node.type === 'n8n-nodes-base.dataTable') {
      if (node.parameters.options) {
        delete node.parameters.options;
        console.log('  Verifier Doublon : supprime options.limit non supporte');
        patchCount++;
      }
    }
  }

  if (patchCount === 0) {
    console.log('  Aucun patch necessaire (parametres deja corrects)');
    // Try to activate anyway
  } else {
    console.log(`  ${patchCount} correction(s) appliquee(s)`);

    // 3. PUT le workflow corrige (seulement les champs autorises)
    console.log('\n[3] Mise a jour du workflow...');
    const putBody = {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings || {},
      staticData: wf.staticData || null,
    };
    const put = await apiRequest('PUT', `/api/v1/workflows/${WF_ID}`, putBody);
    if (put.status !== 200) {
      console.error('ERREUR PUT:', put.status, JSON.stringify(put.body).slice(0, 500));
      process.exit(1);
    }
    console.log('  Workflow mis a jour');
  }

  // 4. Activer
  console.log('\n[4] Activation...');
  const act = await apiRequest('POST', `/api/v1/workflows/${WF_ID}/activate`);
  if (act.status === 200) {
    console.log('  ACTIF');
  } else {
    console.log(`  Status ${act.status}:`, JSON.stringify(act.body).slice(0, 300));
    // Try PATCH as fallback
    console.log('  Tentative PATCH active:true...');
    const patch = await apiRequest('PATCH', `/api/v1/workflows/${WF_ID}`, { active: true });
    console.log(`  PATCH status: ${patch.status}`, JSON.stringify(patch.body).slice(0, 200));
  }

  // 5. Verification finale
  const verify = await apiRequest('GET', `/api/v1/workflows/${WF_ID}`);
  if (verify.status === 200) {
    console.log(`\n  Etat final : active = ${verify.body.active}`);
    if (!verify.body.active) {
      console.log('\n  ⚠️  A activer manuellement dans l\'UI n8n :');
      console.log('     https://n8n.netroia.tech/workflow/' + WF_ID);
      console.log('     Toggle le bouton "Active" en haut a droite');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('DONE');
  console.log('='.repeat(60));
}

main().catch(console.error);
