/**
 * recreate-error-workflow.js
 *
 * Supprime l'ancien "NetroIA - Gestion Erreurs Pro" et le recrée
 * avec UNIQUEMENT des formats de noeuds validés par les workflows actifs.
 *
 * Formats validés (sources : Organisation Intelligente + CRM actifs) :
 * - Switch  : version:3, renameOutput:true, options.fallbackOutput = index number
 * - If      : typeVersion:2, conditions.boolean simple
 * - Slack   : typeVersion:2.2, text simple (PAS de blocks — blocks causent des erreurs)
 * - Code    : typeVersion:2, jsCode
 * - DataTable getAll : SANS filters (filtrage fait en Code ensuite)
 */

const https = require('https');
const fs = require('fs');

const envContent = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = envContent.match(/N8N_API_KEY=(.+)/)[1].trim();
const BASE = 'n8n.netroia.tech';

const OLD_WF_ID = 'ArdqPkZkSRCd0EpL';

const CRED = {
  slack: { id: 'F0fwc1wXChlIz1fb', name: 'NetroIA Error N8N' },
  gmail: { id: '1Bayzmr9ePmWdToL', name: 'captain' },
};
const DATATABLE_ID = 'aRZ1JedsE72lla1s';
const SLACK_CH     = 'C0A8SHN845D'; // #n8n-alerts

const N = {
  trigger      : 'Error Trigger',
  extractCtx   : 'Extraire Contexte',
  fingerprint  : 'Calculer Fingerprint',
  getAllRows    : 'Lire Erreurs',
  detectDup    : 'Detecter Doublon',
  ifDup        : 'Est Doublon',
  updateOcc    : 'Incrementer Occurrence',
  insertNew    : 'Inserer Erreur',
  routeGravite : 'Router Gravite',
  slackP1      : 'Slack Alerte P1',
  slackP2      : 'Slack Alerte P2',
  gmailP1      : 'Gmail Alerte P1',
};

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

const workflow = {
  name: 'NetroIA - Gestion Erreurs Pro',
  nodes: [

    // 1. Error Trigger
    {
      id: 'n-trigger', name: N.trigger,
      type: 'n8n-nodes-base.errorTrigger', typeVersion: 1,
      position: [260, 360],
      parameters: {},
    },

    // 2. Extraire le contexte de l'erreur
    {
      id: 'n-extract', name: N.extractCtx,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [460, 360],
      parameters: {
        jsCode: `const e = $input.item.json;
const workflow_name  = e.workflow?.name || 'inconnu';
const workflow_id    = e.workflow?.id   || '';
const execution_id   = e.execution?.id  || '';
const last_node      = e.execution?.lastNodeExecuted || '';
const error_message  = e.execution?.error?.message || e.error?.message || 'erreur inconnue';
const timestamp      = new Date().toISOString();
return [{ json: { workflow_name, workflow_id, execution_id, last_node, error_message, timestamp } }];`,
      },
    },

    // 3. Calculer fingerprint + gravité + catégorie
    {
      id: 'n-fp', name: N.fingerprint,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [660, 360],
      parameters: {
        jsCode: `const d = $input.item.json;
const empreinte = (d.workflow_id + '|' + d.last_node + '|' + d.error_message)
  .toLowerCase().replace(/[0-9]+/g, '#').replace(/\\s+/g, ' ').trim().slice(0, 180);
const isCritique  = /500|fatal|crash|cannot read|undefined is not|permission|401|403|ECONNREFUSED|timeout/.test(d.error_message);
const isTechnique = /401|403|429|timeout|ECONN|ENOTFOUND|rate|credential|auth|token/.test(d.error_message);
const gravite   = isCritique ? 'P1' : 'P2';
const categorie = isTechnique ? 'TECHNIQUE' : 'METIER';
return [{ json: { ...d, empreinte, gravite, categorie, occurrences: 1 } }];`,
      },
    },

    // 4. Lire toutes les erreurs (getAll SANS filters — filtrage en Code)
    {
      id: 'n-getall', name: N.getAllRows,
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
      position: [860, 360],
      parameters: {
        operation: 'getAll',
        dataTableId: { __rl: true, value: DATATABLE_ID, mode: 'list', cachedResultName: 'Erreur Interne N8N' },
      },
    },

    // 5. Détecter le doublon en Code (cherche l'empreinte dans les résultats)
    {
      id: 'n-detect', name: N.detectDup,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1060, 360],
      parameters: {
        jsCode: `const allRows = $input.all();
const fpData = $('Calculer Fingerprint').first().json;
const match = allRows.find(r => r.json.empreinte_erreur === fpData.empreinte);
const is_duplicate = !!match;
const existing_occurrences = match ? (match.json.occurrences || 1) : 0;
return [{ json: { ...fpData, is_duplicate, existing_occurrences } }];`,
      },
    },

    // 6. Branchement doublon (format validé par Organisation Intelligente)
    {
      id: 'n-if', name: N.ifDup,
      type: 'n8n-nodes-base.if', typeVersion: 2,
      position: [1260, 360],
      parameters: {
        conditions: {
          boolean: [{
            value1: '={{ $json.is_duplicate }}',
            value2: true,
          }],
        },
        options: {},
      },
    },

    // 7a. Doublon → incrémenter occurrence
    {
      id: 'n-update', name: N.updateOcc,
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
      position: [1460, 200],
      parameters: {
        operation: 'update',
        dataTableId: { __rl: true, value: DATATABLE_ID, mode: 'list', cachedResultName: 'Erreur Interne N8N' },
        filters: {
          conditions: [{
            id: 'f-update',
            leftValue: '={{ $json.empreinte }}',
            rightValue: 'empreinte_erreur',
            operator: { type: 'string', operation: 'equals' },
          }],
          combinator: 'and',
        },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            occurrences       : '={{ ($json.existing_occurrences || 0) + 1 }}',
            horodatage_dernier: '={{ $json.timestamp }}',
          },
          schema: [
            { id: 'occurrences',        displayName: 'occurrences',        type: 'number', required: false, defaultMatch: false },
            { id: 'horodatage_dernier', displayName: 'horodatage_dernier', type: 'string', required: false, defaultMatch: false },
          ],
        },
      },
    },

    // 7b. Nouveau → insérer
    {
      id: 'n-insert', name: N.insertNew,
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
      position: [1460, 520],
      parameters: {
        operation: 'create',
        dataTableId: { __rl: true, value: DATATABLE_ID, mode: 'list', cachedResultName: 'Erreur Interne N8N' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            workflow_name     : '={{ $json.workflow_name }}',
            workflow_id       : '={{ $json.workflow_id }}',
            execution_id      : '={{ $json.execution_id }}',
            last_node         : '={{ $json.last_node }}',
            error_message     : '={{ $json.error_message }}',
            empreinte_erreur  : '={{ $json.empreinte }}',
            gravite           : '={{ $json.gravite }}',
            categorie         : '={{ $json.categorie }}',
            occurrences       : 1,
            horodatage        : '={{ $json.timestamp }}',
            horodatage_dernier: '={{ $json.timestamp }}',
          },
          schema: [
            { id: 'workflow_name',      displayName: 'workflow_name',      type: 'string', required: false, defaultMatch: false },
            { id: 'workflow_id',        displayName: 'workflow_id',        type: 'string', required: false, defaultMatch: false },
            { id: 'execution_id',       displayName: 'execution_id',       type: 'string', required: false, defaultMatch: false },
            { id: 'last_node',          displayName: 'last_node',          type: 'string', required: false, defaultMatch: false },
            { id: 'error_message',      displayName: 'error_message',      type: 'string', required: false, defaultMatch: false },
            { id: 'empreinte_erreur',   displayName: 'empreinte_erreur',   type: 'string', required: false, defaultMatch: false },
            { id: 'gravite',            displayName: 'gravite',            type: 'string', required: false, defaultMatch: false },
            { id: 'categorie',          displayName: 'categorie',          type: 'string', required: false, defaultMatch: false },
            { id: 'occurrences',        displayName: 'occurrences',        type: 'number', required: false, defaultMatch: false },
            { id: 'horodatage',         displayName: 'horodatage',         type: 'string', required: false, defaultMatch: false },
            { id: 'horodatage_dernier', displayName: 'horodatage_dernier', type: 'string', required: false, defaultMatch: false },
          ],
        },
      },
    },

    // 8. Router gravité (format validé par Organisation Intelligente)
    {
      id: 'n-router', name: N.routeGravite,
      type: 'n8n-nodes-base.switch', typeVersion: 3.4,
      position: [1660, 360],
      parameters: {
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
        options: { fallbackOutput: 2 },
      },
    },

    // 9a. Slack P1 — format simple TEXT (validé, pas de blocks)
    {
      id: 'n-slack-p1', name: N.slackP1,
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [1860, 200],
      credentials: { slackOAuth2Api: CRED.slack },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CH, mode: 'list', cachedResultName: 'n8n-alerts' },
        text: "=🚨 [P1 CRITIQUE] {{ $json.workflow_name }}\nNoeud: {{ $json.last_node }}\nErreur: {{ $json.error_message }}\nCatégorie: {{ $json.categorie }}\n{{ $json.timestamp }}",
        otherOptions: {},
      },
    },

    // 9b. Gmail P1
    {
      id: 'n-gmail-p1', name: N.gmailP1,
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2060, 200],
      credentials: { gmailOAuth2: CRED.gmail },
      parameters: {
        sendTo: 'captain@netroia.com',
        subject: '=[P1 CRITIQUE] {{ $json.workflow_name }} — {{ $json.last_node }}',
        emailType: 'text',
        message: "=ERREUR CRITIQUE\n\nWorkflow : {{ $json.workflow_name }}\nNoeud    : {{ $json.last_node }}\nErreur   : {{ $json.error_message }}\nGravité  : {{ $json.gravite }} | {{ $json.categorie }}\n{{ $json.timestamp }}",
        options: { senderName: 'NetroIA Monitoring' },
      },
    },

    // 9c. Slack P2
    {
      id: 'n-slack-p2', name: N.slackP2,
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [1860, 520],
      credentials: { slackOAuth2Api: CRED.slack },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CH, mode: 'list', cachedResultName: 'n8n-alerts' },
        text: "=⚠️ [P2 IMPORTANT] {{ $json.workflow_name }}\nNoeud: {{ $json.last_node }}\nErreur: {{ $json.error_message }}\nCatégorie: {{ $json.categorie }}\n{{ $json.timestamp }}",
        otherOptions: {},
      },
    },
  ],

  connections: {
    [N.trigger]     : { main: [[{ node: N.extractCtx,   type: 'main', index: 0 }]] },
    [N.extractCtx]  : { main: [[{ node: N.fingerprint,  type: 'main', index: 0 }]] },
    [N.fingerprint] : { main: [[{ node: N.getAllRows,    type: 'main', index: 0 }]] },
    [N.getAllRows]   : { main: [[{ node: N.detectDup,    type: 'main', index: 0 }]] },
    [N.detectDup]   : { main: [[{ node: N.ifDup,        type: 'main', index: 0 }]] },
    [N.ifDup]: {
      main: [
        [{ node: N.updateOcc,   type: 'main', index: 0 }], // true = doublon
        [{ node: N.insertNew,   type: 'main', index: 0 }], // false = nouveau
      ],
    },
    [N.updateOcc]   : { main: [[{ node: N.routeGravite, type: 'main', index: 0 }]] },
    [N.insertNew]   : { main: [[{ node: N.routeGravite, type: 'main', index: 0 }]] },
    [N.routeGravite]: {
      main: [
        [{ node: N.slackP1, type: 'main', index: 0 }], // P1
        [{ node: N.slackP2, type: 'main', index: 0 }], // P2
        // P3 = fallback 2 sans connexion = silencieux
      ],
    },
    [N.slackP1]: { main: [[{ node: N.gmailP1, type: 'main', index: 0 }]] },
  },

  settings: { executionOrder: 'v1' },
};

async function main() {
  console.log('='.repeat(60));
  console.log('Recréation — NetroIA Gestion Erreurs Pro');
  console.log('='.repeat(60));

  // 1. Supprimer l'ancien
  console.log('\n[1] Suppression ancien workflow...');
  const del = await apiRequest('DELETE', `/api/v1/workflows/${OLD_WF_ID}`);
  console.log('  Status suppression:', del.status);

  // 2. Créer le nouveau
  console.log('\n[2] Création nouveau workflow...');
  const create = await apiRequest('POST', '/api/v1/workflows', workflow);
  if (create.status !== 200) {
    console.error('  ERREUR création:', create.status, JSON.stringify(create.body).slice(0, 400));
    process.exit(1);
  }
  const newId = create.body.id;
  console.log('  ID:', newId);
  console.log('  Nom:', create.body.name);
  console.log('  Noeuds:', (create.body.nodes || []).length);

  // Valider connexions
  const nodeNames = new Set((create.body.nodes || []).map(n => n.name));
  let valid = true;
  for (const src of Object.keys(workflow.connections)) {
    if (!nodeNames.has(src)) { console.error('  CONNEXION INVALIDE source:', src); valid = false; }
  }
  console.log('  Connexions:', valid ? 'OK' : 'ERREUR');

  // 3. Tenter activation
  console.log('\n[3] Activation...');
  const act = await apiRequest('POST', `/api/v1/workflows/${newId}/activate`);
  if (act.status === 200) {
    console.log('  ACTIF via API ✅');
  } else {
    console.log('  Status:', act.status, JSON.stringify(act.body).slice(0, 200));
    console.log('  → Activer manuellement dans l\'UI n8n');
  }

  // 4. Lier aux autres workflows
  console.log('\n[4] Liaison error workflow sur CRM + Mail Perso...');
  for (const [wfId, wfName] of [['9T3KYNvJs6whJDJW', 'CRM'], ['kEWsfjG2pHRSkZq0', 'Mail Perso v2']]) {
    const g = await apiRequest('GET', `/api/v1/workflows/${wfId}`);
    if (g.status !== 200) { console.log('  GET échoué pour', wfName); continue; }
    const w = g.body;
    if (!w.settings) w.settings = {};
    w.settings.errorWorkflow = newId;
    const p = await apiRequest('PUT', `/api/v1/workflows/${wfId}`, {
      name: w.name, nodes: w.nodes, connections: w.connections,
      settings: w.settings, staticData: w.staticData || null,
    });
    console.log(' ', wfName, ':', p.status === 200 ? 'Error WF lié ✅' : `ERREUR ${p.status}`);
  }

  // Sauvegarder
  fs.writeFileSync(
    'C:/Netroia/netro-automations/workflows/templates/error-handling/gestion-erreurs-pro-v2.json',
    JSON.stringify({ ...workflow, id: newId }, null, 2)
  );

  console.log('\n' + '='.repeat(60));
  console.log('DONE');
  console.log('  Nouveau ID:', newId);
  console.log('  URL UI: https://n8n.netroia.tech');
  console.log('  → Chercher "NetroIA - Gestion Erreurs Pro" dans la liste');
  console.log('  → Toggle Active si pas déjà actif');
  console.log('='.repeat(60));
}

main().catch(console.error);
