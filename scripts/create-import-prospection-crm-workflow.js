#!/usr/bin/env node
/**
 * create-import-prospection-crm-workflow.js
 * Workflow "Import Prospection -> CRM" : declenchement manuel + Code (lit un
 * JSON passe en input) + Google Sheets (append dans l'onglet EXISTANT du CRM,
 * "Feuille 1" — decision Jordan 2026-07-18 : reutiliser le CRM existant
 * plutot que creer un nouvel onglet separe.
 *
 * Colonnes du CRM ("Feuille 1") : les 12 d'origine
 * (date, name, email, service, type_besoin, budget_estime, urgence,
 * score_lead, resume_besoins, horodatage, segment_marche, canal)
 * + 2 colonnes M/N ajoutees le 2026-07-18 (telephone, site_web) — corrige
 * un defaut du premier import ou le telephone etait noye dans le texte de
 * resume_besoins au lieu d'avoir sa propre colonne exploitable/filtrable.
 *
 * Mapping prospection -> CRM :
 *   date            <- date d'import (ISO)
 *   name            <- nom entreprise + ", " + commune (identification claire)
 *   email           <- $json.email si trouve (SIRENE ne le fournit pas ;
 *                      colonne native gosom vide en pratique ; enrichi par
 *                      email_enrichment.py — scraping site web, ~52% de
 *                      reussite sur le lot 2026-07-18), sinon vide
 *   service         <- "prospection" (distingue des leads entrants "starter/avance")
 *   type_besoin     <- "a_qualifier" (pas encore determine, contrairement a un lead entrant)
 *   budget_estime   <- effectif_salaries en texte (proxy budget, cf. criteres-ciblage-prospects.md)
 *   urgence         <- "normale" (valeur par defaut coherente avec les leads existants)
 *   score_lead      <- score du moteur de regles (0-100, memes unites que le CRM)
 *   resume_besoins  <- "Prospect [secteur] a [commune] (SIREN [siren])"
 *   horodatage      <- meme timestamp ISO que "date"
 *   segment_marche  <- vide (a determiner en appel, cf. criteres-ciblage-prospects.md § segment A/B/C)
 *   canal           <- "prospection-sirene-gmaps" (distingue des leads via "email"/formulaire)
 *   telephone       <- $json.telephone (colonne M, dediee)
 *   site_web        <- $json.site_web (colonne N, dediee)
 *
 * Reutilisable pour chaque nouveau lot de prospection (autres mots-cles,
 * autres secteurs) — pas un script jetable pour ce seul import.
 *
 * Defense en profondeur (audit securite 2026-07-18, prospection-ia) :
 * valueInputMode=RAW force l'ecriture en texte brut cote Google Sheets,
 * independamment de la neutralisation deja faite cote Python (exporter_csv).
 * Meme si une valeur echappait a la neutralisation Python, RAW empeche
 * Sheets d'interpreter un "=..." comme une formule.
 */
const https = require('https');
const fs    = require('fs');

const n8nEnv  = fs.readFileSync('C:/Netroia/credentials/n8n-api.env', 'utf8');
const API_KEY = n8nEnv.match(/N8N_API_KEY=(.+)/)?.[1]?.trim();

const HOST           = 'n8n.netroia.tech';
const CRM_SHEET_ID   = '1MfPCOMGtLsEuOq4AdyE93FTOb58hEthntAHULFLXeKE'; // CRM NetroIA existant
const CRM_TAB        = 'Feuille 1'; // onglet EXISTANT (leads entrants), reutilise pour la prospection
const SHEETS_CRED_ID = '96DyhZeedQou7Yho'; // "Google Sheets account", deja autorise

const N = {
  trigger: 'Webhook Import',
  code:    'Lire Prospects JSON',
  clear:   'Vider Ancien Import',
  save:    'Ajouter au CRM',
};

// Webhook protege par un chemin non devinable + un token partage verifie
// dans le node Code (sinon un webhook n8n public permettrait a n'importe
// qui d'injecter des lignes dans le CRM de Jordan). Token fixe (pas
// regenere a chaque run de ce script, sinon inutilisable par un appel
// curl ulterieur) — stocke dans credentials/, jamais en dur ailleurs.
const WEBHOOK_PATH  = 'import-prospection-a1f6e9c2';
const tokenEnvPath  = 'C:/Netroia/credentials/prospection-webhook.env';
let WEBHOOK_TOKEN;
if (fs.existsSync(tokenEnvPath)) {
  WEBHOOK_TOKEN = fs.readFileSync(tokenEnvPath, 'utf8').match(/WEBHOOK_TOKEN=(.+)/)?.[1]?.trim();
} else {
  WEBHOOK_TOKEN = 'ntr-prospection-' + require('crypto').randomBytes(16).toString('hex');
  fs.writeFileSync(tokenEnvPath, `WEBHOOK_TOKEN=${WEBHOOK_TOKEN}\n`, 'utf8');
  console.log('Nouveau token webhook genere et sauvegarde dans ' + tokenEnvPath);
}

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

const nodes = [
  {
    id: 'trigger-01',
    name: N.trigger,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [240, 400],
    parameters: {
      httpMethod: 'POST',
      path: WEBHOOK_PATH,
      responseMode: 'lastNode',
      options: {},
    },
  },
  {
    id: 'code-01',
    name: N.code,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [460, 400],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const body = $json.body || {};

if (body.token !== '${WEBHOOK_TOKEN}') {
  throw new Error('Token invalide — import refuse.');
}

if (body.action === 'clear_prospection') {
  return [{ json: { _clear_only: true } }];
}

const jsonProspects = body.prospects;
if (!Array.isArray(jsonProspects) || jsonProspects.length === 0) {
  throw new Error('body.prospects vide ou absent (ou body.action="clear_prospection" pour vider les lignes de prospection existantes).');
}
return jsonProspects.map(p => ({ json: p }));
`.trim(),
    },
  },
  {
    // Vide les lignes 19 a 108 (89 anciens prospects + 1 ligne de test) —
    // jamais les lignes 1-18 (en-tete + 2 leads entrants existants).
    // Parametres verifies sur le code source reel n8n (clear.operation.ts) :
    // clear="specificRows", startIndex, rowsToDelete.
    // N'agit que si le payload contient action="clear_prospection" —
    // sinon ce node est court-circuite par l'IF ci-dessous.
    id: 'if-clear-01',
    name: 'Si Vider',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [560, 250],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: '={{ $json._clear_only }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'clear-01',
    name: N.clear,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [780, 150],
    credentials: {
      googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' },
    },
    parameters: {
      operation: 'clear',
      documentId: { __rl: true, value: CRM_SHEET_ID, mode: 'id' },
      sheetName:  { __rl: true, value: CRM_TAB, mode: 'name' },
      clear: 'specificRows',
      startIndex: 19,
      rowsToDelete: 90,
    },
  },
  {
    id: 'save-01',
    name: N.save,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [680, 400],
    continueOnFail: true,
    credentials: {
      googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' },
    },
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: CRM_SHEET_ID, mode: 'id' },
      sheetName:  { __rl: true, value: CRM_TAB, mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        // Mapping vers les 12 colonnes REELLES du CRM (Feuille 1) —
        // voir commentaire d'en-tete du fichier pour la justification de
        // chaque champ. Un prospect scrape est en amont d'un lead entrant
        // qualifie : email/segment_marche restent vides intentionnellement.
        value: {
          date:           '={{ $now.toISO() }}',
          name:           '={{ $json.nom + ($json.commune ? ", " + $json.commune : "") }}',
          email:          '={{ $json.email || "" }}',
          service:        'prospection',
          type_besoin:    'a_qualifier',
          budget_estime:  '={{ $json.effectif_salaries ? $json.effectif_salaries + " salaries (proxy budget)" : "" }}',
          urgence:        'normale',
          score_lead:     '={{ $json.score }}',
          resume_besoins: '={{ "Prospect " + ($json.libelle_secteur || "secteur inconnu") + " a " + ($json.commune || $json.code_postal || "commune inconnue") + (($json.siren) ? " (SIREN " + $json.siren + ")" : "") }}',
          horodatage:     '={{ $now.toISO() }}',
          segment_marche: '',
          canal:          'prospection-sirene-gmaps',
          telephone:      '={{ $json.telephone || "" }}',
          "site web":     '={{ $json.site_web || "" }}',
        },
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      // Defense en profondeur : force le texte brut, empeche Sheets
      // d'interpreter une valeur "=..." comme une formule meme si elle
      // avait echappe a la neutralisation Python en amont.
      options: { valueInputMode: 'RAW' },
    },
  },
];

const connections = {
  [N.trigger]:  { main: [[{ node: N.code, type: 'main', index: 0 }]] },
  [N.code]:     { main: [[{ node: 'Si Vider', type: 'main', index: 0 }]] },
  'Si Vider':   { main: [
    [{ node: N.clear, type: 'main', index: 0 }],  // true : action=clear_prospection
    [{ node: N.save,  type: 'main', index: 0 }],  // false : import normal
  ]},
};

async function main() {
  if (!API_KEY) throw new Error('N8N_API_KEY manquant');

  const nodeNames = new Set(nodes.map(n => n.name));
  for (const [src] of Object.entries(connections)) {
    if (!nodeNames.has(src)) throw new Error('Connexion source inconnue : ' + src);
  }
  console.log('Validation OK — ' + nodes.length + ' noeuds, ' + Object.keys(connections).length + ' connexions');

  const wfName = 'Import Prospection -> CRM';
  const list   = await request('GET', '/api/v1/workflows?limit=50');
  const existing = (list.body.data || []).find(w => w.name === wfName);

  const payload = {
    name: wfName,
    nodes,
    connections,
    settings: { saveManualExecutions: true },
    staticData: null,
  };

  let wfId;
  if (existing) {
    console.log('Mise a jour — ID : ' + existing.id);
    const put = await request('PUT', '/api/v1/workflows/' + existing.id, payload);
    if (put.status !== 200) { console.error('PUT FAIL', put.status, JSON.stringify(put.body).slice(0, 300)); process.exit(1); }
    wfId = existing.id;
    console.log('PUT OK');
  } else {
    const create = await request('POST', '/api/v1/workflows', payload);
    if (create.status !== 200 && create.status !== 201) {
      console.error('CREATE FAIL', create.status, JSON.stringify(create.body).slice(0, 300));
      process.exit(1);
    }
    wfId = create.body.id;
    console.log('Workflow cree — ID : ' + wfId);
  }

  console.log('URL : https://n8n.netroia.tech/workflow/' + wfId);
  console.log('');
  console.log('Cible : onglet EXISTANT "' + CRM_TAB + '" du CRM — aucune creation d\'onglet requise.');
  console.log('');
  console.log('IMPORTANT : le workflow doit etre ACTIVE dans n8n pour que le webhook fonctionne');
  console.log('(bouton Active en haut a droite de l\'editeur, ou via /workflows/{id}/activate).');
  console.log('');
  console.log('Pour importer un lot, appeler :');
  console.log('  curl -X POST https://n8n.netroia.tech/webhook/' + WEBHOOK_PATH + ' \\\\');
  console.log('    -H "Content-Type: application/json" \\\\');
  console.log('    -d \'{"token":"' + WEBHOOK_TOKEN + '","prospects":[...]}\'');
}

main().catch(e => { console.error(e); process.exit(1); });
