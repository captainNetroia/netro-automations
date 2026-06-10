#!/usr/bin/env node
/**
 * fix-gestion-erreurs-v2.js
 * Gestion erreurs NetroIA — refactoring complet
 *
 * Corrections :
 * - Suppression du nœud "Passer" (Set vide produisant 0 items en n8n 2.19.5)
 * - Preparer Erreur → Logger Sheets connexion directe
 * - Contexte enrichi : error_type, error_code, stack_snippet (400 chars)
 * - Colonnes Sheets : statut (OUVERT par defaut) + solution (vide, a remplir manuellement)
 * - Slack Alerte : message plus riche
 *
 * Nouvelles colonnes Sheets (a ajouter ligne 1 si absentes) :
 * workflow_name | workflow_id | execution_id | last_node | error_type | error_code
 * | error_message | stack_snippet | gravite | categorie | statut | solution | horodatage
 */
const https = require('https');
const fs    = require('fs');

const n8nEnv  = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = n8nEnv.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();

const HOST           = 'n8n.netroia.tech';
const WF_ID          = 'pafFHP0oemMaFRMt';
const SHEETS_CRED_ID = '96DyhZeedQou7Yho';
const GMAIL_CRED_ID  = '1Bayzmr9ePmWdToL';
const SLACK_CRED_ID  = 'lHqM2icB8uIKFw8P';
const SHEETS_DOC_ID  = '1gOtuCExk9Yrpm9aXLz1_45ts0MN_YSaExF_u1rhsA28';
const SLACK_CHANNEL  = 'C0B27DFSWEA'; // #alertes-erreurs-netroia

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: HOST, port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const N = {
  trigger:  'Error Trigger',
  preparer: 'Preparer Erreur',
  logger:   'Logger Sheets',
  router:   'Router Gravite',
  gmail:    'Gmail Alerte P1',
  slack:    'Slack Alerte',
};

const nodes = [

  // 1. Error Trigger
  {
    id: 'trigger-01',
    name: N.trigger,
    type: 'n8n-nodes-base.errorTrigger',
    typeVersion: 1,
    position: [-1696, 112],
    parameters: {},
  },

  // 2. Preparer Erreur — enrichi : type, code, stack, statut, solution
  {
    id: 'preparer-01',
    name: N.preparer,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [-1456, 112],
    parameters: {
      assignments: {
        assignments: [
          {
            id: 'f001',
            name: 'workflow_name',
            value: '={{ $json.workflow?.name || "inconnu" }}',
            type: 'string',
          },
          {
            id: 'f002',
            name: 'workflow_id',
            value: '={{ $json.workflow?.id || "" }}',
            type: 'string',
          },
          {
            id: 'f003',
            name: 'execution_id',
            value: '={{ $json.execution?.id || "" }}',
            type: 'string',
          },
          {
            id: 'f004',
            name: 'last_node',
            value: '={{ $json.execution?.lastNodeExecuted || "" }}',
            type: 'string',
          },
          {
            id: 'f005',
            name: 'error_type',
            value: '={{ $json.execution?.error?.name || $json.error?.name || "Error" }}',
            type: 'string',
          },
          {
            id: 'f006',
            name: 'error_code',
            value: '={{ $json.execution?.error?.statusCode || $json.execution?.error?.code || $json.execution?.error?.httpCode || "" }}',
            type: 'string',
          },
          {
            id: 'f007',
            name: 'error_message',
            value: '={{ $json.execution?.error?.message || $json.error?.message || "erreur inconnue" }}',
            type: 'string',
          },
          {
            id: 'f008',
            name: 'stack_snippet',
            value: '={{ ($json.execution?.error?.stack || $json.error?.stack || "").slice(0, 400) }}',
            type: 'string',
          },
          {
            id: 'f009',
            name: 'gravite',
            value: '={{ /500|fatal|crash|cannot read|undefined is not|permission|401|403|ECONNREFUSED|timeout/i.test($json.execution?.error?.message || "") ? "P1" : "P2" }}',
            type: 'string',
          },
          {
            id: 'f010',
            name: 'categorie',
            value: '={{ /401|403|429|timeout|ECONN|ENOTFOUND|rate|credential|auth|token/i.test($json.execution?.error?.message || "") ? "TECHNIQUE" : "METIER" }}',
            type: 'string',
          },
          {
            id: 'f011',
            name: 'statut',
            value: 'OUVERT',
            type: 'string',
          },
          {
            id: 'f012',
            name: 'solution',
            value: '',
            type: 'string',
          },
          {
            id: 'f013',
            name: 'horodatage',
            value: '={{ $now.toISO() }}',
            type: 'string',
          },
        ],
      },
      options: {},
    },
  },

  // 3. Logger Sheets — connexion directe (plus de Passer intermediaire)
  {
    id: 'logger-01',
    name: N.logger,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [-1200, 112],
    continueOnFail: true,
    credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: SHEETS_DOC_ID, mode: 'id' },
      sheetName:  { __rl: true, value: 'Feuille 1', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          workflow_name:  '={{ $json.workflow_name }}',
          workflow_id:    '={{ $json.workflow_id }}',
          execution_id:   '={{ $json.execution_id }}',
          last_node:      '={{ $json.last_node }}',
          error_type:     '={{ $json.error_type }}',
          error_code:     '={{ $json.error_code }}',
          error_message:  '={{ $json.error_message }}',
          stack_snippet:  '={{ $json.stack_snippet }}',
          gravite:        '={{ $json.gravite }}',
          categorie:      '={{ $json.categorie }}',
          statut:         '={{ $json.statut }}',
          solution:       '={{ $json.solution }}',
          horodatage:     '={{ $json.horodatage }}',
        },
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {},
    },
  },

  // 4. Router Gravite — P1 / P2
  {
    id: 'router-01',
    name: N.router,
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position: [-960, 112],
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [{ id: 'r001', leftValue: '={{ $json.gravite }}', rightValue: 'P1', operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'P1 Critique',
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [{ id: 'r002', leftValue: '={{ $json.gravite }}', rightValue: 'P2', operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'P2 Important',
          },
        ],
      },
      options: { fallbackOutput: 1 },
    },
  },

  // 5. Gmail — P1 uniquement
  {
    id: 'gmail-01',
    name: N.gmail,
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.2,
    position: [-760, -80],
    continueOnFail: true,
    credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'captain' } },
    parameters: {
      sendTo: 'captain@netroia.com',
      subject: '=[P1 CRITIQUE] {{ $json.error_type }} — {{ $json.workflow_name }}',
      emailType: 'text',
      message: `=ERREUR CRITIQUE N8N — {{ $json.horodatage }}

Workflow  : {{ $json.workflow_name }} ({{ $json.workflow_id }})
Noeud     : {{ $json.last_node }}
Type      : {{ $json.error_type }} | Code : {{ $json.error_code || "N/A" }}
Gravite   : {{ $json.gravite }} | {{ $json.categorie }}
Execution : {{ $json.execution_id }}

MESSAGE :
{{ $json.error_message }}

STACK (extrait) :
{{ $json.stack_snippet || "non disponible" }}

---
Voir : https://n8n.netroia.tech/execution/{{ $json.execution_id }}
Log Sheets : https://docs.google.com/spreadsheets/d/${SHEETS_DOC_ID}`,
      options: { senderName: 'NetroIA Monitoring' },
    },
  },

  // 6. Slack — P1 + P2
  {
    id: 'slack-01',
    name: N.slack,
    type: 'n8n-nodes-base.slack',
    typeVersion: 2.4,
    position: [-760, 288],
    continueOnFail: true,
    credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Slack account' } },
    parameters: {
      authentication: 'accessToken',
      select: 'channel',
      channelId: { __rl: true, value: SLACK_CHANNEL, mode: 'list', cachedResultName: 'alertes-erreurs-netroia' },
      messageType: 'text',
      text: `={{ $json.gravite === 'P1' ? ':rotating_light: *[P1 CRITIQUE]*' : ':warning: *[P2]*' }} Erreur *{{ $json.workflow_name }}*
:label: Type : \`{{ $json.error_type }}\` | Code : {{ $json.error_code || 'N/A' }} | {{ $json.categorie }}
:pushpin: Noeud : *{{ $json.last_node }}*
:memo: {{ $json.error_message?.slice(0, 250) }}
:clock1: {{ $json.horodatage }}
_Execution : {{ $json.execution_id }}_`,
      otherOptions: {},
    },
  },

];

const connections = {
  [N.trigger]:  { main: [[{ node: N.preparer, type: 'main', index: 0 }]] },
  [N.preparer]: { main: [[{ node: N.logger,   type: 'main', index: 0 }]] },
  [N.logger]:   { main: [[{ node: N.router,   type: 'main', index: 0 }]] },
  [N.router]:   { main: [
    [{ node: N.gmail, type: 'main', index: 0 }],  // P1 → Gmail
    [{ node: N.slack, type: 'main', index: 0 }],  // P2 → Slack
  ]},
  [N.gmail]:    { main: [[{ node: N.slack, type: 'main', index: 0 }]] }, // P1 → Gmail + Slack
};

async function main() {
  if (!API_KEY) throw new Error('N8N_API_KEY manquant');

  const nodeNames = new Set(nodes.map(n => n.name));
  for (const [src] of Object.entries(connections)) {
    if (!nodeNames.has(src)) throw new Error('Connexion source inconnue : ' + src);
  }
  console.log('Validation OK — ' + nodes.length + ' noeuds (Passer supprime, Logger direct)');

  const payload = {
    name: 'Gestion erreurs NetroIA',
    nodes,
    connections,
    settings: { saveManualExecutions: true },
    staticData: null,
  };

  const put = await request('PUT', '/api/v1/workflows/' + WF_ID, payload);
  if (put.status !== 200) {
    console.error('PUT FAIL', put.status, JSON.stringify(put.body).slice(0, 500));
    process.exit(1);
  }
  console.log('PUT OK — ID :', WF_ID);

  console.log('\n=== ACTION MANUELLE REQUISE ===');
  console.log('Mettre a jour les headers ligne 1 du Google Sheet "Erreurs N8N" :');
  console.log('');
  console.log('  A1: workflow_name');
  console.log('  B1: workflow_id');
  console.log('  C1: execution_id');
  console.log('  D1: last_node');
  console.log('  E1: error_type        ← NOUVEAU');
  console.log('  F1: error_code        ← NOUVEAU');
  console.log('  G1: error_message');
  console.log('  H1: stack_snippet     ← NOUVEAU');
  console.log('  I1: gravite');
  console.log('  J1: categorie');
  console.log('  K1: statut            ← NOUVEAU (OUVERT par defaut)');
  console.log('  L1: solution          ← NOUVEAU (a remplir quand resolue)');
  console.log('  M1: horodatage');
  console.log('');
  console.log('Sheet URL : https://docs.google.com/spreadsheets/d/' + SHEETS_DOC_ID);
  console.log('URL workflow : https://n8n.netroia.tech/workflow/' + WF_ID);
}

main().catch(e => { console.error(e.message); process.exit(1); });
