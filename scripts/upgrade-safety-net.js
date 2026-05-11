/**
 * upgrade-safety-net.js
 *
 * Transforme "Gestion des Erreurs (Le Safety Net)" en un workflow
 * pro et fonctionnel, renommé "Gestion erreurs NetroIA".
 *
 * Stratégie : conserver les IDs de noeuds créés dans l'UI (structure valide),
 * patcher uniquement les paramètres. Aucun ajout/suppression de noeud = UI intact.
 *
 * Architecture finale :
 *  Error Trigger
 *    → Preparer Erreur (Set) — enrichit avec gravite P1/P2, categorie, empreinte
 *    → [appeler autre workflow] désactivé — conservé tel quel
 *    → Logger DataTable (Insert row1) — log dans "Erreur Interne N8N"
 *    → Router Gravite (Switch) — P1 = output 0, P2 = output 1
 *      → [output 0] Gmail Alerte P1 + Slack Alerte
 *      → [output 1] Slack Alerte seulement
 */

const https = require('https');
const fs = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';
const WF_ID = 'pafFHP0oemMaFRMt';
const DATATABLE_ID = 'aRZ1JedsE72lla1s';
const SLACK_CH = 'C0A8SHN845D'; // #n8n-alerts

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: BASE, port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json',
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
  console.log('='.repeat(60));
  console.log('Upgrade Safety Net → Gestion erreurs NetroIA');
  console.log('='.repeat(60));

  const get = await apiRequest('GET', `/api/v1/workflows/${WF_ID}`);
  const wf = get.body;

  // ── 1. Renommer ─────────────────────────────────────────────
  wf.name = 'Gestion erreurs NetroIA';

  // ── 2. Patcher chaque noeud par son ID (pas son nom) ────────
  for (const node of wf.nodes) {

    // Error Trigger — rien à changer, déjà OK
    if (node.id === 'd32a3ceb-9473-415d-9b80-cbad0810bde3') {
      node.name = 'Error Trigger';
      console.log('  Error Trigger : OK');
    }

    // Préparer Donnée Erreur → enrichissement complet avec gravité + empreinte
    if (node.id === '603343a5-81af-498e-a4b4-5e354281f9b0') {
      node.name = 'Preparer Erreur';
      node.parameters = {
        assignments: {
          assignments: [
            {
              id: '3335dcab-9d85-46fb-a1c4-c84913aefabd',
              name: 'workflow_name',
              value: '={{ $json.workflow?.name || "inconnu" }}',
              type: 'string',
            },
            {
              id: '212ddce3-f5aa-4bc0-a00c-3ef1347c9c15',
              name: 'workflow_id',
              value: '={{ $json.workflow?.id || "" }}',
              type: 'string',
            },
            {
              id: '6cb28022-f103-4f1b-8933-daf9dcffee24',
              name: 'execution_id',
              value: '={{ $json.execution?.id || "" }}',
              type: 'string',
            },
            {
              id: '2752ad64-0dda-4b28-a54c-64178bf1c6d9',
              name: 'last_node',
              value: '={{ $json.execution?.lastNodeExecuted || "" }}',
              type: 'string',
            },
            {
              id: '05fd3880-9960-4eed-be79-9e01a63cd4ec',
              name: 'error_message',
              value: '={{ $json.execution?.error?.message || $json.error?.message || "erreur inconnue" }}',
              type: 'string',
            },
            {
              id: 'aaa00001-0000-0000-0000-000000000001',
              name: 'timestamp',
              value: '={{ $now.toISO() }}',
              type: 'string',
            },
            {
              id: 'aaa00002-0000-0000-0000-000000000002',
              name: 'gravite',
              value: '={{ /500|fatal|crash|cannot read|undefined is not|permission|401|403|ECONNREFUSED|timeout/i.test($json.execution?.error?.message || "") ? "P1" : "P2" }}',
              type: 'string',
            },
            {
              id: 'aaa00003-0000-0000-0000-000000000003',
              name: 'categorie',
              value: '={{ /401|403|429|timeout|ECONN|ENOTFOUND|rate|credential|auth|token/i.test($json.execution?.error?.message || "") ? "TECHNIQUE" : "METIER" }}',
              type: 'string',
            },
          ],
        },
        options: {},
      };
      console.log('  Preparer Erreur : paramètres mis à jour');
    }

    // appeler autre workflow — garder désactivé, juste nettoyer le nom
    if (node.id === '7a8db549-9cf9-41ee-8d3e-b2f343b74e97') {
      node.disabled = true;
      console.log('  appeler autre workflow : conservé désactivé');
    }

    // Normaliser Données → Logger DataTable (Insert)
    if (node.id === 'ce841530-ddba-46e3-b813-d530726b0d4d') {
      // On remplace ce Set par un passthrough — les données viennent de Preparer Erreur
      node.name = 'Passer';
      node.parameters = { assignments: { assignments: [] }, options: {} };
      console.log('  Normaliser Données → Passer (noeud transparent)');
    }

    // Insert row1 → Logger DataTable
    if (node.id === '0644609c-1497-4b82-87df-1af5702a2781') {
      node.name = 'Logger DataTable';
      node.disabled = false;
      node.typeVersion = 1.1;
      node.parameters = {
        operation: 'create',
        dataTableId: {
          __rl: true,
          value: DATATABLE_ID,
          mode: 'list',
          cachedResultName: 'Erreur Interne N8N',
        },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            workflow_name  : '={{ $json.workflow_name }}',
            workflow_id    : '={{ $json.workflow_id }}',
            execution_id   : '={{ $json.execution_id }}',
            last_node      : '={{ $json.last_node }}',
            error_message  : '={{ $json.error_message }}',
            gravite        : '={{ $json.gravite }}',
            categorie      : '={{ $json.categorie }}',
            horodatage     : '={{ $json.timestamp }}',
          },
          schema: [
            { id: 'workflow_name',  displayName: 'workflow_name',  type: 'string', required: false, defaultMatch: false },
            { id: 'workflow_id',    displayName: 'workflow_id',    type: 'string', required: false, defaultMatch: false },
            { id: 'execution_id',   displayName: 'execution_id',   type: 'string', required: false, defaultMatch: false },
            { id: 'last_node',      displayName: 'last_node',      type: 'string', required: false, defaultMatch: false },
            { id: 'error_message',  displayName: 'error_message',  type: 'string', required: false, defaultMatch: false },
            { id: 'gravite',        displayName: 'gravite',        type: 'string', required: false, defaultMatch: false },
            { id: 'categorie',      displayName: 'categorie',      type: 'string', required: false, defaultMatch: false },
            { id: 'horodatage',     displayName: 'horodatage',     type: 'string', required: false, defaultMatch: false },
          ],
          matchingColumns: [],
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
        options: {},
      };
      console.log('  Logger DataTable : configuré sur Erreur Interne N8N');
    }

    // Switch → Router Gravite (format identique à Organisation Intelligente = actif et valide)
    if (node.id === '2cf5550c-686f-4a4a-9bad-8b2d19ad3ff8') {
      node.name = 'Router Gravite';
      node.typeVersion = 3.4;
      node.parameters = {
        rules: {
          values: [
            {
              renameOutput: true,
              outputKey: 'P1 Critique',
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
                conditions: [{
                  id: '691af15f-0188-447f-8a2f-6eb23caff17a',
                  leftValue: '={{ $json.gravite }}',
                  rightValue: 'P1',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
            },
            {
              renameOutput: true,
              outputKey: 'P2 Important',
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
                conditions: [{
                  id: 'b0000000-0000-0000-0000-000000000001',
                  leftValue: '={{ $json.gravite }}',
                  rightValue: 'P2',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
            },
          ],
        },
        options: { fallbackOutput: 1 }, // P2 par défaut si pas P1
      };
      console.log('  Router Gravite : Switch v3.4 avec P1/P2 configuré');
    }

    // Send a message → Gmail Alerte P1
    if (node.id === '5e0ded28-b153-4438-a565-fa605caef657') {
      node.name = 'Gmail Alerte P1';
      node.disabled = false;
      node.typeVersion = 2.2;
      node.parameters = {
        sendTo: 'captain@netroia.com',
        subject: '=[P1 CRITIQUE] Erreur n8n - {{ $json.workflow_name }}',
        emailType: 'text',
        message: '=ERREUR CRITIQUE N8N\n\nWorkflow  : {{ $json.workflow_name }}\nNoeud     : {{ $json.last_node }}\nErreur    : {{ $json.error_message }}\nGravite   : {{ $json.gravite }} | {{ $json.categorie }}\nExecution : {{ $json.execution_id }}\nDate      : {{ $json.timestamp }}',
        options: { senderName: 'NetroIA Monitoring' },
      };
      console.log('  Gmail Alerte P1 : configuré captain@netroia.com');
    }

    // Send a message1 → Slack Alerte
    if (node.id === '573ade34-dfc3-4693-9bea-872d7fa88e6d') {
      node.name = 'Slack Alerte';
      node.disabled = false;
      node.typeVersion = 2.3;
      node.credentials = { slackOAuth2Api: { id: 'F0fwc1wXChlIz1fb', name: 'NetroIA Error N8N' } };
      node.parameters = {
        authentication: 'oAuth2',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CH, mode: 'list', cachedResultName: 'n8n-alerts' },
        text: '={{ $json.gravite === "P1" ? "🚨 [P1 CRITIQUE]" : "⚠️ [P2 IMPORTANT]" }} {{ $json.workflow_name }}\n*Noeud :* {{ $json.last_node }}\n*Erreur :* {{ $json.error_message }}\n*Catégorie :* {{ $json.categorie }}\n{{ $json.timestamp }}',
        otherOptions: {},
      };
      console.log('  Slack Alerte : configuré #n8n-alerts');
    }
  }

  // ── 3. Reconstruire les connexions avec les nouveaux noms ────
  wf.connections = {
    'Error Trigger': {
      main: [[{ node: 'Preparer Erreur', type: 'main', index: 0 }]],
    },
    'Preparer Erreur': {
      main: [[{ node: 'Passer', type: 'main', index: 0 }]],
    },
    'Passer': {
      main: [[{ node: 'Logger DataTable', type: 'main', index: 0 }]],
    },
    'Logger DataTable': {
      main: [[{ node: 'Router Gravite', type: 'main', index: 0 }]],
    },
    'Router Gravite': {
      main: [
        [{ node: 'Gmail Alerte P1', type: 'main', index: 0 }], // P1
        [{ node: 'Slack Alerte',    type: 'main', index: 0 }], // P2 (fallback aussi)
      ],
    },
    'Gmail Alerte P1': {
      main: [[{ node: 'Slack Alerte', type: 'main', index: 0 }]],
    },
  };
  console.log('\n  Connexions reconstruites');

  // ── 4. PUT ───────────────────────────────────────────────────
  console.log('\n[2] Mise à jour via API...');
  const putBody = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || { executionOrder: 'v1' },
    staticData: wf.staticData || null,
  };

  const put = await apiRequest('PUT', `/api/v1/workflows/${WF_ID}`, putBody);
  if (put.status !== 200) {
    console.error('❌ PUT échoué:', put.status, JSON.stringify(put.body).slice(0, 400));
    process.exit(1);
  }
  console.log('✅ Workflow mis à jour :', put.body.name);
  console.log('   Noeuds :', put.body.nodes.length);

  // ── 5. Activer ───────────────────────────────────────────────
  console.log('\n[3] Activation...');
  const act = await apiRequest('POST', `/api/v1/workflows/${WF_ID}/activate`);
  if (act.status === 200) {
    console.log('✅ ACTIF');
  } else {
    console.log('  Status:', act.status, JSON.stringify(act.body).slice(0, 200));
    console.log('  → Activer manuellement dans l\'UI (toggle Active)');
  }

  // ── 6. Lier aux workflows CRM + Mail Perso ───────────────────
  console.log('\n[4] Liaison error workflow...');
  for (const [wfId, wfName] of [
    ['9T3KYNvJs6whJDJW', 'CRM'],
    ['kEWsfjG2pHRSkZq0', 'Mail Perso v2'],
  ]) {
    const g = await apiRequest('GET', `/api/v1/workflows/${wfId}`);
    if (g.status !== 200) continue;
    const w = g.body;
    if (!w.settings) w.settings = {};
    w.settings.errorWorkflow = WF_ID;
    const p = await apiRequest('PUT', `/api/v1/workflows/${wfId}`, {
      name: w.name, nodes: w.nodes, connections: w.connections,
      settings: w.settings, staticData: w.staticData || null,
    });
    console.log(' ', wfName, ':', p.status === 200 ? '✅ Error WF lié' : `❌ ${p.status}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('DONE — ID conservé :', WF_ID);
  console.log('Ouvrir dans l\'UI : chercher "Gestion erreurs NetroIA"');
  console.log('='.repeat(60));
}

main().catch(console.error);
