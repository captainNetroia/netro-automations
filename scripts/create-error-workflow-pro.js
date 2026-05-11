/**
 * create-error-workflow-pro.js
 *
 * Cree "NetroIA - Gestion Erreurs Pro" sur n8n.
 *
 * ARCHITECTURE DevSecOps (idempotence + auto-correction) :
 *
 *  Error Trigger
 *    → Extraire Contexte      (Code JS — enrichit toutes les donnees d'erreur)
 *    → Calculer Fingerprint   (Code JS — empreinte unique + gravite P1/P2/P3 + categorie)
 *    → Verif Doublon          (DataTable rowExists sur empreinte)
 *      → [EXISTE]  → Incrementer Occurrence  (DataTable update — idempotence)
 *      → [NOUVEAU] → Inserer Erreur          (DataTable insert)
 *    → Router Gravite         (Switch P1 / P2 / P3)
 *      → [P1] Alerte Slack + Gmail (critique — les deux canaux)
 *      → [P2] Alerte Slack seulement (important)
 *      → [P3] Log silencieux (info — deja dans DataTable)
 *
 * Principes DevSecOps appliques :
 * - Idempotence : meme erreur = 1 seul enregistrement, compteur incremente
 * - Audit trail : toutes les erreurs loggees avec contexte complet
 * - Moindre bruit : P3 ne declenche pas d'alerte, P1 declenche les deux canaux
 * - Fingerprint normalise : digits -> # pour eviter les faux doublons
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const API_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGE5OTU2NC05MWNmLTRlYjQtYjZkOC0wZDU2M2NhODFlNzQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiY2YzNWZjNGUtZWU1Yy00Y2M5LWE1MDEtYjFmMmU3ODMyOTJmIiwiaWF0IjoxNzc1MzkwMDQ5fQ.Ae61Gjr8gsl_U7ElTWuEWT1JQldaOrK3uYvviTaKD4M';
const BASE     = 'n8n.netroia.tech';

const CRED = {
  gmail : { id: '1Bayzmr9ePmWdToL', name: 'captain' },
  slack : { id: 'F0fwc1wXChlIz1fb', name: 'NetroIA Error N8N' }, // credential deja utilise dans WF existants
};

// DataTable existante "Erreur Interne N8N" — ID recupere du Safety Net existant
const DATATABLE_ID   = 'aRZ1JedsE72lla1s';
const SLACK_CH       = 'C0A8SHN845D'; // #n8n-alerts

// ─── Noms ASCII purs ────────────────────────────────────────────────────────
const N = {
  stickyArchi  : 'Note Architecture',
  stickyDevsec : 'Note DevSecOps',
  trigger      : 'Error Trigger',
  extractCtx   : 'Extraire Contexte',
  fingerprint  : 'Calculer Fingerprint',
  checkDup     : 'Verifier Doublon',
  ifDup        : 'Est Doublon',
  updateOcc    : 'Incrementer Occurrence',
  insertNew    : 'Inserer Erreur',
  routeGravite : 'Router Gravite',
  slackP1      : 'Slack Alerte P1',
  slackP2      : 'Slack Alerte P2',
  gmailP1      : 'Gmail Alerte P1',
};

// ─── Code JS — Extraire Contexte ────────────────────────────────────────────
const codeExtraireContexte = `
const e = $input.item.json;

const workflow_name    = e.workflow?.name     || 'inconnu';
const workflow_id      = e.workflow?.id       || '';
const execution_id     = e.execution?.id      || '';
const last_node        = e.execution?.lastNodeExecuted || '';
const error_message    = e.execution?.error?.message  || e.error?.message || 'erreur inconnue';
const error_stack      = e.execution?.error?.stack    || '';
const timestamp        = new Date().toISOString();
const env              = 'prod'; // toujours prod sur ce VPS

return [{
  json: {
    workflow_name,
    workflow_id,
    execution_id,
    last_node,
    error_message,
    error_stack: error_stack.substring(0, 500),
    timestamp,
    env,
  }
}];
`.trim();

// ─── Code JS — Calculer Fingerprint + Gravite + Categorie ───────────────────
const codeFingerprint = `
const d = $input.item.json;

// Empreinte normalisee : insensible aux IDs et numeros
const empreinte = (d.workflow_id + '|' + d.last_node + '|' + d.error_message)
  .toLowerCase()
  .replace(/[0-9]+/g, '#')
  .replace(/\\s+/g, ' ')
  .trim()
  .slice(0, 180);

// Gravite selon type d'erreur (DevSecOps : P1=critique, P2=important, P3=info)
const isCritique = /500|fatal|crash|cannot read|undefined is not|permission denied|401|403|ECONNREFUSED|database|timeout/i.test(d.error_message);
const isTechnique = /401|403|429|timeout|ECONN|ENOTFOUND|rate.?limit|credential|auth|token/i.test(d.error_message);

const gravite  = d.env === 'prod' ? (isCritique ? 'P1' : 'P2') : 'P3';
const categorie = isTechnique ? 'TECHNIQUE' : 'METIER';

// Label lisible pour Slack
const graviteLabel = gravite === 'P1' ? 'CRITIQUE' : gravite === 'P2' ? 'IMPORTANT' : 'INFO';
const graviteEmoji = gravite === 'P1' ? 'ALERTE P1' : gravite === 'P2' ? 'ATTENTION P2' : 'INFO P3';

return [{
  json: {
    ...d,
    empreinte,
    gravite,
    gravite_label: graviteLabel,
    gravite_emoji: graviteEmoji,
    categorie,
    occurrences: 1,
  }
}];
`.trim();

// ─── Bloc Slack (reutilise pour P1 et P2) ───────────────────────────────────
function slackBlocks(niveau) {
  return JSON.stringify([
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '{{ $json.gravite_emoji }} - {{ $json.workflow_name }}',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Workflow :*\n{{ $json.workflow_name }}' },
        { type: 'mrkdwn', text: '*Gravite :*\n{{ $json.gravite }} {{ $json.categorie }}' },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Noeud en echec :*\n{{ $json.last_node }}' },
        { type: 'mrkdwn', text: '*Execution ID :*\n{{ $json.execution_id }}' },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Erreur :*\n```{{ $json.error_message.substring(0, 300) }}```',
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '{{ $json.timestamp }} | ' + niveau + ' | Occurrences : {{ $json.occurrences }}',
        },
      ],
    },
  ]);
}

// ─── Workflow definition ────────────────────────────────────────────────────
const workflow = {
  name: 'NetroIA - Gestion Erreurs Pro',
  nodes: [

    // ── Documentation ────────────────────────────────────────────────────────
    {
      id: 'sticky-archi', name: N.stickyArchi,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [200, 40],
      parameters: {
        content: [
          '## ARCHITECTURE — Gestion Erreurs Pro',
          '',
          'Error Trigger',
          '  -> Extraire Contexte  (enrichissement donnees)',
          '  -> Calculer Fingerprint (empreinte + P1/P2/P3)',
          '  -> Verifier Doublon    (DataTable rowExists)',
          '     -> OUI : Incrementer Occurrence (idempotence)',
          '     -> NON : Inserer Erreur (nouveau log)',
          '  -> Router Gravite',
          '     -> P1 : Slack + Gmail (critique)',
          '     -> P2 : Slack seul (important)',
          '     -> P3 : Log silencieux (info)',
        ].join('\n'),
        height: 220, width: 480, color: 4,
      },
    },
    {
      id: 'sticky-devsec', name: N.stickyDevsec,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [720, 40],
      parameters: {
        content: [
          '## DevSecOps — Principes appliques',
          '',
          'IDEMPOTENCE : meme erreur = 1 enregistrement',
          '  -> empreinte normalisee (digits -> #)',
          '  -> rowExists avant insert -> update si doublon',
          '',
          'AUDIT TRAIL : 100% des erreurs loggees',
          '  -> DataTable "Erreur Interne N8N"',
          '  -> contexte complet (stack, noeud, execution)',
          '',
          'MOINDRE BRUIT :',
          '  -> P3 : log seul, pas d\'alerte',
          '  -> P2 : Slack seul',
          '  -> P1 : Slack + Gmail (critique)',
          '',
          'CATEGORISATION : TECHNIQUE / METIER',
        ].join('\n'),
        height: 260, width: 460, color: 6,
      },
    },

    // ── 1. Trigger ───────────────────────────────────────────────────────────
    {
      id: 'error-trigger', name: N.trigger,
      type: 'n8n-nodes-base.errorTrigger', typeVersion: 1,
      position: [260, 360],
      parameters: {},
    },

    // ── 2. Extraire contexte complet ─────────────────────────────────────────
    {
      id: 'extract-ctx', name: N.extractCtx,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [480, 360],
      parameters: { jsCode: codeExtraireContexte },
    },

    // ── 3. Fingerprint + Gravite ─────────────────────────────────────────────
    {
      id: 'fingerprint-node', name: N.fingerprint,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [700, 360],
      parameters: { jsCode: codeFingerprint },
    },

    // ── 4. Verifier doublon (DataTable rowExists) ────────────────────────────
    {
      id: 'check-dup', name: N.checkDup,
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
      position: [920, 360],
      parameters: {
        operation: 'getAll',
        dataTableId: { __rl: true, value: DATATABLE_ID, mode: 'list', cachedResultName: 'Erreur Interne N8N' },
        filters: {
          conditions: [
            {
              id: 'filter-empreinte',
              leftValue: '={{ $json.empreinte }}',
              rightValue: 'empreinte_erreur',
              operator: { type: 'string', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
        options: { limit: 1 },
      },
    },

    // ── 5. Branchement doublon ───────────────────────────────────────────────
    {
      id: 'if-dup', name: N.ifDup,
      type: 'n8n-nodes-base.if', typeVersion: 2.2,
      position: [1140, 360],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'cond-dup',
            leftValue: '={{ $json.count }}',
            rightValue: 0,
            operator: { type: 'number', operation: 'gt' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },

    // ── 6a. DOUBLON : incrementer occurrence ─────────────────────────────────
    {
      id: 'update-occ', name: N.updateOcc,
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
      position: [1360, 240],
      parameters: {
        operation: 'update',
        dataTableId: { __rl: true, value: DATATABLE_ID, mode: 'list', cachedResultName: 'Erreur Interne N8N' },
        filters: {
          conditions: [{
            id: 'filter-update',
            leftValue: '={{ $json.empreinte }}',
            rightValue: 'empreinte_erreur',
            operator: { type: 'string', operation: 'equals' },
          }],
          combinator: 'and',
        },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            occurrences      : '={{ ($json.occurrences || 0) + 1 }}',
            horodatage_dernier: '={{ $json.timestamp }}',
          },
          schema: [
            { id: 'occurrences',       displayName: 'occurrences',       type: 'number', required: false, defaultMatch: false },
            { id: 'horodatage_dernier', displayName: 'horodatage_dernier', type: 'string', required: false, defaultMatch: false },
          ],
        },
      },
    },

    // ── 6b. NOUVEAU : inserer dans DataTable ─────────────────────────────────
    {
      id: 'insert-new', name: N.insertNew,
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
      position: [1360, 480],
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

    // ── 7. Router selon gravite ──────────────────────────────────────────────
    {
      id: 'route-gravite', name: N.routeGravite,
      type: 'n8n-nodes-base.switch', typeVersion: 3.4,
      position: [1580, 360],
      parameters: {
        mode: 'rules',
        rules: {
          values: [
            {
              outputKey: 'P1',
              conditions: {
                options: { caseSensitive: false, leftValue: '', typeValidation: 'strict', version: 2 },
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
              outputKey: 'P2',
              conditions: {
                options: { caseSensitive: false, leftValue: '', typeValidation: 'strict', version: 2 },
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
        options: { fallbackOutput: 'none' }, // P3 = aucun output (log seul)
      },
    },

    // ── 8a. Slack P1 (critique) ──────────────────────────────────────────────
    {
      id: 'slack-p1', name: N.slackP1,
      type: 'n8n-nodes-base.slack', typeVersion: 2.4,
      position: [1800, 240],
      credentials: { slackOAuth2Api: CRED.slack },
      parameters: {
        authentication: 'oAuth2',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CH, mode: 'list', cachedResultName: 'n8n-alerts' },
        messageType: 'block',
        blocksUi: slackBlocks('P1 - CRITIQUE'),
        otherOptions: {},
      },
    },

    // ── 8b. Gmail P1 (critique uniquement) ───────────────────────────────────
    {
      id: 'gmail-p1', name: N.gmailP1,
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2020, 240],
      credentials: { gmailOAuth2: CRED.gmail },
      parameters: {
        sendTo: 'captain@netroia.com',
        subject: '=[P1 CRITIQUE] Erreur n8n : {{ $json.workflow_name }} — {{ $json.last_node }}',
        emailType: 'text',
        message: [
          '=ERREUR CRITIQUE DETECTEE',
          '',
          'Workflow  : {{ $json.workflow_name }} ({{ $json.workflow_id }})',
          'Noeud     : {{ $json.last_node }}',
          'Execution : {{ $json.execution_id }}',
          'Gravite   : {{ $json.gravite }} | {{ $json.categorie }}',
          'Occurrences: {{ $json.occurrences }}',
          '',
          'ERREUR :',
          '{{ $json.error_message }}',
          '',
          '{{ $json.timestamp }}',
        ].join('\n'),
        options: { senderName: 'NetroIA n8n Monitoring' },
      },
    },

    // ── 8c. Slack P2 (important) ─────────────────────────────────────────────
    {
      id: 'slack-p2', name: N.slackP2,
      type: 'n8n-nodes-base.slack', typeVersion: 2.4,
      position: [1800, 480],
      credentials: { slackOAuth2Api: CRED.slack },
      parameters: {
        authentication: 'oAuth2',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CH, mode: 'list', cachedResultName: 'n8n-alerts' },
        messageType: 'block',
        blocksUi: slackBlocks('P2 - IMPORTANT'),
        otherOptions: {},
      },
    },
  ],

  // ─── Connexions ────────────────────────────────────────────────────────────
  connections: {
    [N.trigger]     : { main: [[{ node: N.extractCtx,   type: 'main', index: 0 }]] },
    [N.extractCtx]  : { main: [[{ node: N.fingerprint,  type: 'main', index: 0 }]] },
    [N.fingerprint] : { main: [[{ node: N.checkDup,     type: 'main', index: 0 }]] },
    [N.checkDup]    : { main: [[{ node: N.ifDup,        type: 'main', index: 0 }]] },
    [N.ifDup]: {
      main: [
        [{ node: N.updateOcc,   type: 'main', index: 0 }], // true  = doublon
        [{ node: N.insertNew,   type: 'main', index: 0 }], // false = nouveau
      ],
    },
    [N.updateOcc]  : { main: [[{ node: N.routeGravite, type: 'main', index: 0 }]] },
    [N.insertNew]  : { main: [[{ node: N.routeGravite, type: 'main', index: 0 }]] },
    [N.routeGravite]: {
      main: [
        [{ node: N.slackP1, type: 'main', index: 0 }], // output 0 = P1
        [{ node: N.slackP2, type: 'main', index: 0 }], // output 1 = P2
        // P3 = fallback = aucun output (log seul dans DataTable)
      ],
    },
    [N.slackP1]: { main: [[{ node: N.gmailP1, type: 'main', index: 0 }]] },
  },

  settings: {
    executionOrder: 'v1',
    // Ce workflow EST le gestionnaire d'erreurs — pas d'errorWorkflow sur lui-meme
  },
};

// ─── API ────────────────────────────────────────────────────────────────────
function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: BASE, port: 443, path: urlPath, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('='.repeat(60));
  console.log('NetroIA - Gestion Erreurs Pro');
  console.log('Architecture : DevSecOps + Idempotence + P1/P2/P3');
  console.log('='.repeat(60));

  // Verifier doublon
  const list = await apiRequest('GET', '/api/v1/workflows?limit=50', null);
  const existing = (list.body.data || []).find(w => w.name === workflow.name);
  if (existing) {
    console.log('ATTENTION : workflow "' + workflow.name + '" existe deja (ID: ' + existing.id + ')');
    console.log('Suppression avant recreation...');
    await apiRequest('DELETE', '/api/v1/workflows/' + existing.id, null);
    console.log('Supprime.');
  }

  // Sauvegarder le payload
  const outFile = path.join(__dirname, '..', 'workflows', 'templates', 'error-handling', 'gestion-erreurs-pro-v1.json');
  fs.writeFileSync(outFile, JSON.stringify(workflow, null, 2), 'utf8');
  console.log('Payload sauvegarde : ' + outFile);

  // Creer
  const result = await apiRequest('POST', '/api/v1/workflows', {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
  });

  if (result.status === 200 || result.status === 201) {
    const wf = result.body;

    // Validation connexions
    const nodeNames = new Set(wf.nodes.map(n => n.name));
    let valid = true;
    for (const [src, conn] of Object.entries(wf.connections)) {
      if (!nodeNames.has(src)) { console.error('ERREUR connexion source: ' + src); valid = false; }
      ['main'].forEach(t => {
        if (conn[t]) conn[t].forEach(arr => arr.forEach(c => {
          if (!nodeNames.has(c.node)) { console.error('ERREUR connexion target: ' + c.node); valid = false; }
        }));
      });
    }

    console.log('');
    console.log('SUCCESS !');
    console.log('  ID     : ' + wf.id);
    console.log('  Nom    : ' + wf.name);
    console.log('  Noeuds : ' + wf.nodes.length);
    console.log('  Valide : ' + (valid ? 'OUI - toutes connexions OK' : 'ERREUR - voir ci-dessus'));
    console.log('');
    console.log('Prochaines etapes :');
    console.log('  1. Verifier que la DataTable "Erreur Interne N8N" a les colonnes : empreinte_erreur, gravite, categorie, occurrences, horodatage_dernier');
    console.log('  2. Activer ce workflow (bouton Activate)');
    console.log('  3. Dans TOUS les autres workflows : Settings -> Error Workflow -> "NetroIA - Gestion Erreurs Pro" (ID: ' + wf.id + ')');
  } else {
    console.error('ERREUR HTTP ' + result.status);
    console.error(JSON.stringify(result.body, null, 2).substring(0, 1000));
    process.exit(1);
  }
})();
