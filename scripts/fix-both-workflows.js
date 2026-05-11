/**
 * fix-both-workflows.js
 *
 * CORRECTION 1 — CRM Formulaire Contact
 *   Problème : $json.email undefined dans "Envoyer Email"
 *   Cause    : LangChain agents ne propagent pas automatiquement les champs d'entrée
 *   Fix      : sendTo -> référence absolue $('Extraire Valider').first().json.email
 *              Guard sur actions_suggerees.split() dans Alerte Slack
 *
 * CORRECTION 2 — Gestion Erreurs Pro
 *   Problème : Switch version:2 invalide pour n8n 2.11.2 + DataTable getAll retourne
 *              0 items si pas de doublon → If node ne reçoit rien → architecture cassée
 *   Fix      : Switch version:3 + renameOutput:true + ajouter Code "Agreger Resultat"
 *              entre DataTable et If pour garantir 1 item sortant
 */

const https = require('https');
const fs = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';

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
      let d = '';
      res.on('data', c => d += c);
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

function cleanForPut(wf) {
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
    staticData: wf.staticData || null,
  };
}

// ═══════════════════════════════════════════════════════════════
// CORRECTION 1 — CRM
// ═══════════════════════════════════════════════════════════════
async function fixCRM() {
  console.log('\n[CRM] Lecture du workflow...');
  const get = await apiRequest('GET', '/api/v1/workflows/9T3KYNvJs6whJDJW');
  if (get.status !== 200) { console.error('GET échoué:', get.status); return; }

  const wf = get.body;
  let changed = 0;

  for (const node of wf.nodes) {
    // Fix Gmail : sendTo en référence absolue
    if (node.name === 'Envoyer Email' && node.type === 'n8n-nodes-base.gmail') {
      node.parameters.sendTo = "={{ $('Extraire Valider').first().json.email }}";
      // Aussi sécuriser le sujet si email_subject est undefined
      node.parameters.subject = "={{ $json.email_subject || ('Votre demande NetroIA - ' + $('Extraire Valider').first().json.name) }}";
      console.log('  [CRM] Gmail sendTo + subject corrigés');
      changed++;
    }

    // Fix Alerte Slack : guard sur actions_suggerees.split()
    if (node.name === 'Alerte Slack' && node.type === 'n8n-nodes-base.slack') {
      const blocks = node.parameters.blocksUi;
      if (typeof blocks === 'string' && blocks.includes("actions_suggerees.split")) {
        node.parameters.blocksUi = blocks.replace(
          /\{\{\s*\$json\.actions_suggerees\.split/g,
          "{{ ($json.actions_suggerees || '').split"
        );
        console.log('  [CRM] Slack actions_suggerees guard ajouté');
        changed++;
      }
    }
  }

  if (changed === 0) { console.log('  Aucun changement nécessaire'); return; }

  const put = await apiRequest('PUT', '/api/v1/workflows/9T3KYNvJs6whJDJW', cleanForPut(wf));
  if (put.status === 200) {
    console.log('  [CRM] ✅ Workflow mis à jour');
  } else {
    console.error('  [CRM] ❌ PUT échoué:', put.status, JSON.stringify(put.body).slice(0, 300));
  }
}

// ═══════════════════════════════════════════════════════════════
// CORRECTION 2 — Error Workflow
// ═══════════════════════════════════════════════════════════════
async function fixErrorWorkflow() {
  console.log('\n[Error WF] Lecture du workflow...');
  const get = await apiRequest('GET', '/api/v1/workflows/ArdqPkZkSRCd0EpL');
  if (get.status !== 200) { console.error('GET échoué:', get.status); return; }

  const wf = get.body;

  // ── 1. Corriger le Switch "Router Gravite" ──────────────────
  for (const node of wf.nodes) {
    if (node.name === 'Router Gravite' && node.type === 'n8n-nodes-base.switch') {
      node.parameters = {
        rules: {
          values: [
            {
              renameOutput: true,
              outputKey: 'P1',
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
                conditions: [{
                  id: 'rule-p1',
                  leftValue: '={{ $json.gravite }}',
                  rightValue: 'P1',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
            },
            {
              renameOutput: true,
              outputKey: 'P2',
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
                conditions: [{
                  id: 'rule-p2',
                  leftValue: '={{ $json.gravite }}',
                  rightValue: 'P2',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
            },
          ],
        },
        options: { fallbackOutput: 2 }, // index 2 = P3 sans connexion = silencieux
      };
      console.log('  [Error WF] Switch "Router Gravite" corrigé (version:3 + renameOutput)');
    }

    // ── 2. Corriger le If "Est Doublon" → format simple (typeVersion 2) ────
    if (node.name === 'Est Doublon' && node.type === 'n8n-nodes-base.if') {
      node.typeVersion = 2;
      node.parameters = {
        conditions: {
          boolean: [{
            value1: '={{ $json.is_duplicate }}',
            value2: true,
          }],
        },
        options: {},
      };
      console.log('  [Error WF] If "Est Doublon" corrigé (format simple v2)');
    }
  }

  // ── 3. Insérer nœud "Agreger Resultat" entre Verifier Doublon et Est Doublon ──
  // Ce nœud garantit toujours 1 item en sortie (même si 0 lignes trouvées)
  const hasAgreger = wf.nodes.some(n => n.name === 'Agreger Resultat');
  if (!hasAgreger) {
    wf.nodes.push({
      id: 'agreger-result',
      name: 'Agreger Resultat',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1040, 360],
      parameters: {
        jsCode: [
          '// DataTable getAll retourne 0 items si pas de doublon -> ce noeud',
          '// garantit toujours 1 item avec is_duplicate pour que le If node fonctionne',
          'const allRows = $input.all();',
          'const isDuplicate = allRows.length > 0;',
          '',
          '// Recuperer les donnees du fingerprint (toujours disponible)',
          "const fpData = $('Calculer Fingerprint').first().json;",
          '',
          'return [{',
          '  json: {',
          '    ...fpData,',
          '    is_duplicate: isDuplicate,',
          '    existing_occurrences: isDuplicate ? (allRows[0].json.occurrences || 1) : 0,',
          '  }',
          '}];',
        ].join('\n'),
      },
    });
    console.log('  [Error WF] Nœud "Agreger Resultat" ajouté');

    // ── 4. Rewire connexions ────────────────────────────────────
    // Ancien : Verifier Doublon → Est Doublon
    // Nouveau : Verifier Doublon → Agreger Resultat → Est Doublon
    wf.connections['Verifier Doublon'] = {
      main: [[{ node: 'Agreger Resultat', type: 'main', index: 0 }]],
    };
    wf.connections['Agreger Resultat'] = {
      main: [[{ node: 'Est Doublon', type: 'main', index: 0 }]],
    };
    console.log('  [Error WF] Connexions re-câblées : Verifier Doublon → Agreger Resultat → Est Doublon');
  } else {
    console.log('  [Error WF] Agreger Resultat déjà présent');
  }

  // ── 5. PUT ──────────────────────────────────────────────────
  const put = await apiRequest('PUT', '/api/v1/workflows/ArdqPkZkSRCd0EpL', cleanForPut(wf));
  if (put.status === 200) {
    console.log('  [Error WF] ✅ Workflow mis à jour (', (put.body.nodes || []).length, 'noeuds)');
  } else {
    console.error('  [Error WF] ❌ PUT échoué:', put.status, JSON.stringify(put.body).slice(0, 400));
    return;
  }

  // ── 6. Tenter activation ────────────────────────────────────
  console.log('  [Error WF] Tentative activation...');
  const act = await apiRequest('POST', '/api/v1/workflows/ArdqPkZkSRCd0EpL/activate');
  if (act.status === 200) {
    console.log('  [Error WF] ✅ ACTIF');
  } else {
    console.log(`  [Error WF] Status ${act.status}:`, JSON.stringify(act.body).slice(0, 200));
    console.log('  → Activer manuellement dans l\'UI : https://n8n.netroia.tech');
    console.log('    Chercher "NetroIA - Gestion Erreurs Pro" dans la liste et toggle Active');
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('='.repeat(60));
  console.log('Fix Both Workflows');
  console.log('='.repeat(60));

  await fixCRM();
  await fixErrorWorkflow();

  console.log('\n' + '='.repeat(60));
  console.log('DONE — Tester maintenant :');
  console.log('  1. Formulaire netroia.tech → soumettre un test');
  console.log('  2. Vérifier exécution CRM sans erreur dans n8n → Executions');
  console.log('  3. Activer "NetroIA - Gestion Erreurs Pro" dans l\'UI si non actif');
  console.log('='.repeat(60));
}

main().catch(console.error);
