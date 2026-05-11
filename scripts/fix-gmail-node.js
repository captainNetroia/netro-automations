/**
 * Fix ciblé : noeud "Envoyer Email" du CRM
 *
 * Problème : après un LangChain agent, $json ne contient que la sortie
 * de l'agent (output.email_subject etc.), plus les champs d'entrée (email, name...).
 * Solution : référencer explicitement le noeud "Extraire Valider" pour récupérer
 * l'email original.
 */
const https = require('https');
const fs = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';
const WF_ID = '9T3KYNvJs6whJDJW';

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: BASE, port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  // 1. GET
  const get = await apiRequest('GET', `/api/v1/workflows/${WF_ID}`);
  const wf = get.body;
  console.log('Noeuds:', wf.nodes.length);

  // 2. Trouver et patcher les noeuds problématiques
  for (const node of wf.nodes) {

    if (node.name === 'Envoyer Email' && node.type === 'n8n-nodes-base.gmail') {
      console.log('\nAvant Gmail sendTo:', node.parameters.sendTo);
      console.log('Avant Gmail subject:', node.parameters.subject);

      // sendTo : email de l'Extraire Valider (le seul endroit où il est garanti)
      node.parameters.sendTo  = "={{ $('Extraire Valider').first().json.email }}";
      // subject : email_subject de $json (produit par Document Mission)
      node.parameters.subject = "={{ $json.email_subject || 'Votre demande NetroIA' }}";

      console.log('Après Gmail sendTo:', node.parameters.sendTo);
      console.log('Après Gmail subject:', node.parameters.subject);
    }

    // Fix aussi Alerte Slack : guard sur actions_suggerees
    if (node.name === 'Alerte Slack' && node.type === 'n8n-nodes-base.slack') {
      const blocks = node.parameters.blocksUi;
      if (typeof blocks === 'string' && blocks.includes('actions_suggerees.split')) {
        node.parameters.blocksUi = blocks.replace(
          /\$json\.actions_suggerees\.split/g,
          "($json.actions_suggerees || '').split"
        );
        console.log('\nSlack blocks : actions_suggerees guard appliqué');
      }
    }
  }

  // 3. PUT
  const putBody = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
    staticData: wf.staticData || null,
  };
  const put = await apiRequest('PUT', `/api/v1/workflows/${WF_ID}`, putBody);
  if (put.status === 200) {
    // Vérification
    const gmailNode = put.body.nodes.find(n => n.name === 'Envoyer Email');
    console.log('\n✅ PUT OK');
    console.log('Vérification sendTo sauvé:', gmailNode?.parameters?.sendTo);
  } else {
    console.error('❌ PUT échoué:', put.status, JSON.stringify(put.body).slice(0, 300));
  }
}

main().catch(console.error);
