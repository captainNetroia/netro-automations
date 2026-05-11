/**
 * create-crm-workflow.js
 * Cree le workflow "NetroIA - CRM Formulaire Contact" sur n8n via API REST.
 * Execution : node scripts/create-crm-workflow.js
 *
 * Regles de nommage :
 * - Noms de noeuds : ASCII pur (sans accents, sans emojis)
 * - Raison : les connexions LangChain utilisent le NOM comme cle
 *   Si le nom est corrompu lors de l'envoi, la connexion se brise.
 * - Les contenus (sticky notes, prompts, messages) peuvent avoir des accents.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const API_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGE5OTU2NC05MWNmLTRlYjQtYjZkOC0wZDU2M2NhODFlNzQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiY2YzNWZjNGUtZWU1Yy00Y2M5LWE1MDEtYjFmMmU3ODMyOTJmIiwiaWF0IjoxNzc1MzkwMDQ5fQ.Ae61Gjr8gsl_U7ElTWuEWT1JQldaOrK3uYvviTaKD4M';
const BASE_URL = 'n8n.netroia.tech';

// ─── IDs production NetroIA (verifies 2026-04-05) ──────────────────────────
const CRED = {
  openai  : { id: 'g1I5vYXiH7nvxbYX', name: 'OpenAi account' },
  gmail   : { id: '1Bayzmr9ePmWdToL', name: 'captain' },
  slack   : { id: 'HQ7TA73vHn5QPIQs', name: 'Slack account' },
  sheets  : { id: '96DyhZeedQou7Yho', name: 'Google Sheets account' },
};
const DEBBUG_ID    = 'Uc73W2jImd5arguG';
const SLACK_CH_ID  = 'C0A8SHN845D'; // #n8n-alerts (fonctionne - bot deja invite)

// ─── IMPORTANT : Remplacer par l'ID de votre Google Sheet ──────────────────
// Creez un sheet "CRM NetroIA" avec une feuille "Leads"
// L'ID est dans l'URL : docs.google.com/spreadsheets/d/SHEET_ID/edit
const SHEET_ID = 'SPREADSHEET_ID_A_CONFIGURER';

// ─── Noms des noeuds (ASCII pur = connexions stables) ──────────────────────
const N = {
  // Sticky notes
  stickyEtape1   : 'Note Etape 1',
  stickyEtape2   : 'Note Etape 2',
  stickyEtape3   : 'Note Etape 3',
  stickyEtape4   : 'Note Etape 4',
  // Noeuds principaux
  webhook        : 'Webhook Contact',
  extract        : 'Extraire Valider',
  classifierAgent: 'Classifier Demande',
  openaiMini     : 'OpenAI Classification',
  schemaClassif  : 'Schema Classification',
  prepareSet     : 'Preparer Classification',
  emailAgent     : 'Generer Email',
  openaiGPT4     : 'OpenAI Email',
  schemaEmail    : 'Schema Email',
  missionCode    : 'Document Mission',
  gmailSend      : 'Envoyer Email',
  slackAlert     : 'Alerte Slack',
  sheetsLog      : 'Logger Sheets',
  respondHTTP    : 'Reponse HTTP',
};

// ─── Workflow definition ────────────────────────────────────────────────────
const workflow = {
  name: 'NetroIA - CRM Formulaire Contact',
  nodes: [

    // ── Sticky notes ────────────────────────────────────────────────────────
    {
      id: 'sticky-1', name: N.stickyEtape1,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [200, 60],
      parameters: {
        content: [
          '## ETAPE 1 - Reception & Validation',
          'Webhook : POST /webhook/contact-netroia',
          'Champs : name, email, service, message, date, source',
          '',
          'Credential Gmail  : captain (1Bayzmr9ePmWdToL)',
          'Credential Slack  : Slack account (HQ7TA73vHn5QPIQs)',
          'Credential Sheets : Google Sheets (96DyhZeedQou7Yho)',
          '',
          '⚠ Configurer SPREADSHEET_ID dans le noeud Logger Sheets avant activation.',
        ].join('\n'),
        height: 200, width: 480, color: 5,
      },
    },
    {
      id: 'sticky-2', name: N.stickyEtape2,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [740, 60],
      parameters: {
        content: [
          '## ETAPE 2 - Classification IA',
          'Modele : gpt-4.1-mini | Temperature : 0',
          'Output JSON :',
          '  urgence : haute | normale | basse',
          '  type_besoin : automatisation | agent_ia | site_web | combine | autre',
          '  budget_estime : starter | avance | sur_mesure | personnalise',
          '  resume_besoins : string (2-3 phrases)',
          '  actions_suggerees : string[] (3 actions)',
          '  score_lead : 1-10',
        ].join('\n'),
        height: 200, width: 460, color: 6,
      },
    },
    {
      id: 'sticky-3', name: N.stickyEtape3,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [1280, 60],
      parameters: {
        content: [
          '## ETAPE 3 - Generation Email',
          'Modele : gpt-4.1 | Temperature : 0.7',
          'Output : email_subject, email_body_html',
          'Expediteur : NetroIA (senderName)',
          'BCC : captain@netroia.com',
          'Delai promis : 24h',
        ].join('\n'),
        height: 160, width: 440, color: 3,
      },
    },
    {
      id: 'sticky-4', name: N.stickyEtape4,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [1820, 60],
      parameters: {
        content: [
          '## ETAPE 4 - Actions finales (parallele)',
          '1. Gmail   → email auto au prospect (BCC captain)',
          '2. Slack   → alerte #n8n-alerts avec score lead',
          '3. Sheets  → log lead dans CRM NetroIA / Leads',
          '4. HTTP    → reponse 200 au formulaire site',
          '',
          '⚠ Pour utiliser #client-netroia (prive) :',
          '  Inviter le bot Slack au canal puis changer channelId.',
        ].join('\n'),
        height: 200, width: 460, color: 4,
      },
    },

    // ── Etape 1 : Webhook + Validation ──────────────────────────────────────
    {
      id: 'webhook-node', name: N.webhook,
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [260, 340],
      parameters: {
        httpMethod: 'POST',
        path: 'contact-netroia',
        responseMode: 'responseNode',
        options: {},
      },
    },
    {
      id: 'extract-node', name: N.extract,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [480, 340],
      parameters: {
        jsCode: [
          "const body = $input.item.json.body || $input.item.json;",
          "",
          "const name    = (body.name    || '').trim();",
          "const email   = (body.email   || '').trim().toLowerCase();",
          "const service = (body.service || 'autre').trim();",
          "const message = (body.message || '').trim();",
          "const date    = body.date   || new Date().toISOString();",
          "const source  = body.source || 'netroia.tech';",
          "const ip      = ($input.item.json.headers && $input.item.json.headers['x-forwarded-for']) || 'unknown';",
          "",
          "if (!name    || name.length    < 2)  throw new Error('Champ name invalide');",
          "if (!email   || !email.includes('@')) throw new Error('Champ email invalide');",
          "if (!message || message.length < 10)  throw new Error('Message trop court');",
          "",
          "return [{ json: { name, email, service, message, date, source, ip } }];",
        ].join('\n'),
      },
    },

    // ── Etape 2 : Classification IA ─────────────────────────────────────────
    {
      id: 'classifier-agent', name: N.classifierAgent,
      type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3,
      position: [740, 340],
      parameters: {
        promptType: 'define',
        text: [
          "=Analyse la demande de ce prospect et retourne le JSON de classification.",
          "",
          "PROSPECT :",
          "Nom : {{ $json.name }}",
          "Email : {{ $json.email }}",
          "Service : {{ $json.service }}",
          "Message : {{ $json.message }}",
          "Date : {{ $json.date }}",
          "",
          "OFFRES NETROIA :",
          "- starter (500-1000 EUR) : Automatisation simple ou agent IA de base",
          "- avance (1200-2500 EUR) : Workflows complexes, integrations multi-outils",
          "- sur_mesure (5000-10000 EUR) : Systeme agentique complet, architecture IA",
          "- personnalise (sur devis) : Automatisation + Agent IA + Webdesign combines",
          "",
          "Retourne UNIQUEMENT le JSON valide selon le schema fourni.",
        ].join('\n'),
        hasOutputParser: true,
        options: {
          systemMessage: [
            "Tu es un expert commercial IA B2B.",
            "Tu analyses les demandes prospects de NetroIA (agence automatisation IA, Nantes, France).",
            "Temperature=0 : tes reponses sont deterministes.",
            "Tu retournes UNIQUEMENT du JSON valide selon le schema fourni, aucun texte autour.",
          ].join(' '),
          returnIntermediateSteps: false,
        },
      },
    },
    {
      id: 'openai-mini-node', name: N.openaiMini,
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.3,
      position: [660, 540],
      credentials: { openAiApi: CRED.openai },
      parameters: {
        model: { __rl: true, mode: 'list', value: 'gpt-4.1-mini' },
        options: { temperature: 0 },
      },
    },
    {
      id: 'schema-classif-node', name: N.schemaClassif,
      type: '@n8n/n8n-nodes-langchain.outputParserStructured', typeVersion: 1.3,
      position: [860, 540],
      parameters: {
        schemaType: 'manual',
        inputSchema: JSON.stringify({
          type: 'object',
          additionalProperties: false,
          properties: {
            urgence: {
              type: 'string',
              enum: ['haute', 'normale', 'basse'],
              description: "Niveau d'urgence de la demande",
            },
            type_besoin: {
              type: 'string',
              enum: ['automatisation', 'agent_ia', 'site_web', 'combine', 'autre'],
              description: 'Type de besoin principal detecte',
            },
            budget_estime: {
              type: 'string',
              enum: ['starter', 'avance', 'sur_mesure', 'personnalise'],
              description: 'Pack NetroIA correspondant au budget estime',
            },
            resume_besoins: {
              type: 'string',
              description: 'Resume du besoin en 2-3 phrases maximum',
            },
            actions_suggerees: {
              type: 'array',
              items: { type: 'string' },
              description: '3 actions concretes prioritaires pour Jordan',
            },
            score_lead: {
              type: 'integer',
              minimum: 1,
              maximum: 10,
              description: 'Score de qualite du lead (1=froid, 10=pret a signer)',
            },
          },
          required: ['urgence', 'type_besoin', 'budget_estime', 'resume_besoins', 'actions_suggerees', 'score_lead'],
        }),
      },
    },

    // ── Set : aplatir la sortie de l'agent ──────────────────────────────────
    {
      id: 'prepare-set-node', name: N.prepareSet,
      type: 'n8n-nodes-base.set', typeVersion: 3.4,
      position: [980, 340],
      parameters: {
        assignments: {
          assignments: [
            { id: 's01', name: 'urgence',           value: "={{ $json.output.urgence }}",                                      type: 'string' },
            { id: 's02', name: 'type_besoin',        value: "={{ $json.output.type_besoin }}",                                  type: 'string' },
            { id: 's03', name: 'budget_estime',      value: "={{ $json.output.budget_estime }}",                                type: 'string' },
            { id: 's04', name: 'resume_besoins',     value: "={{ $json.output.resume_besoins }}",                               type: 'string' },
            { id: 's05', name: 'actions_suggerees',  value: "={{ $json.output.actions_suggerees.join(' | ') }}",                type: 'string' },
            { id: 's06', name: 'score_lead',         value: "={{ $json.output.score_lead }}",                                   type: 'number' },
            { id: 's07', name: 'name',               value: "={{ $('" + N.extract + "').first().json.name }}",                  type: 'string' },
            { id: 's08', name: 'email',              value: "={{ $('" + N.extract + "').first().json.email }}",                 type: 'string' },
            { id: 's09', name: 'service',            value: "={{ $('" + N.extract + "').first().json.service }}",               type: 'string' },
            { id: 's10', name: 'message',            value: "={{ $('" + N.extract + "').first().json.message }}",               type: 'string' },
            { id: 's11', name: 'date',               value: "={{ $('" + N.extract + "').first().json.date }}",                  type: 'string' },
            { id: 's12', name: 'horodatage',         value: "={{ new Date().toISOString() }}",                                  type: 'string' },
          ],
        },
        options: {},
      },
    },

    // ── Etape 3 : Generation email ───────────────────────────────────────────
    {
      id: 'email-agent', name: N.emailAgent,
      type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3,
      position: [1220, 340],
      parameters: {
        promptType: 'define',
        text: [
          "=Redige un email de reponse professionnel et personnalise pour ce prospect NetroIA.",
          "",
          "PROSPECT :",
          "Prenom       : {{ $json.name.split(' ')[0] }}",
          "Nom complet  : {{ $json.name }}",
          "Email        : {{ $json.email }}",
          "Service      : {{ $json.service }}",
          "Message      : {{ $json.message }}",
          "",
          "ANALYSE IA :",
          "Type besoin  : {{ $json.type_besoin }}",
          "Budget estime: {{ $json.budget_estime }}",
          "Urgence      : {{ $json.urgence }}",
          "Score lead   : {{ $json.score_lead }}/10",
          "Resume       : {{ $json.resume_besoins }}",
          "",
          "OFFRES NETROIA :",
          "- Starter (500-1000 EUR) : Automatisation simple ou agent IA de base",
          "- Avance (1200-2500 EUR) : Workflows complexes, integrations multi-outils",
          "- Sur mesure (5000-10000 EUR) : Systeme agentique complet, architecture IA",
          "- Personnalise (sur devis) : Automatisation + Agent IA + Webdesign",
          "",
          "INSTRUCTIONS :",
          "Redige un email HTML (pas Markdown) avec :",
          "1. Accroche personnalisee (prenom + type besoin detecte)",
          "2. Confirmation reception + delai reponse 24h",
          "3. 3 questions de qualification pertinentes",
          "4. Presentation courte de l'offre correspondante ({{ $json.budget_estime }})",
          "5. CTA : reserver un appel decouverte 30 min",
          "6. Signature : Jordan Vincent | Fondateur NetroIA | captain@netroia.com",
          "",
          "Ton : professionnel, direct, axe resultats. Pas de jargon technique.",
          "Langue : francais. Format : HTML complet.",
        ].join('\n'),
        hasOutputParser: true,
        options: {
          systemMessage: [
            "Tu es Jordan Vincent, fondateur de NetroIA (agence automatisation IA B2B, Nantes).",
            "Tu rediges des emails de reponse prospect chaleureux, professionnels et axes resultats.",
            "Tu retournes UNIQUEMENT du JSON valide selon le schema fourni.",
          ].join(' '),
          returnIntermediateSteps: false,
        },
      },
    },
    {
      id: 'openai-gpt4-node', name: N.openaiGPT4,
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.3,
      position: [1140, 540],
      credentials: { openAiApi: CRED.openai },
      parameters: {
        model: { __rl: true, mode: 'list', value: 'gpt-4.1' },
        options: { temperature: 0.7 },
      },
    },
    {
      id: 'schema-email-node', name: N.schemaEmail,
      type: '@n8n/n8n-nodes-langchain.outputParserStructured', typeVersion: 1.3,
      position: [1340, 540],
      parameters: {
        schemaType: 'manual',
        inputSchema: JSON.stringify({
          type: 'object',
          additionalProperties: false,
          properties: {
            email_subject: {
              type: 'string',
              description: "Objet de l'email, accrocheur et personnalise",
            },
            email_body_html: {
              type: 'string',
              description: "Corps de l'email en HTML complet",
            },
          },
          required: ['email_subject', 'email_body_html'],
        }),
      },
    },

    // ── Code : assembler le document mission ─────────────────────────────────
    {
      id: 'mission-code', name: N.missionCode,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1460, 340],
      parameters: {
        jsCode: [
          "const d = $input.item.json;",
          "const emailOut = d.output || {};",
          "",
          "const packLabels = {",
          "  starter    : 'Pack Starter (500 - 1 000 EUR)',",
          "  avance     : 'Pack Avance (1 200 - 2 500 EUR)',",
          "  sur_mesure : 'Pack Sur Mesure (5 000 - 10 000 EUR)',",
          "  personnalise: 'Pack Personnalise (sur devis)',",
          "};",
          "const packLabel = packLabels[d.budget_estime] || d.budget_estime;",
          "",
          "const actions = (d.actions_suggerees || '').split(' | ');",
          "const actionsText = actions.map((a, i) => (i + 1) + '. ' + a).join('\\n');",
          "",
          "const missionDoc = [",
          "  '# FICHE PROSPECT - ' + d.name,",
          "  '',",
          "  '## Contact',",
          "  '- Nom     : ' + d.name,",
          "  '- Email   : ' + d.email,",
          "  '- Service : ' + d.service,",
          "  '- Date    : ' + d.date,",
          "  '',",
          "  '## Message',",
          "  d.message,",
          "  '',",
          "  '## Analyse IA',",
          "  '- Type    : ' + d.type_besoin,",
          "  '- Urgence : ' + d.urgence,",
          "  '- Score   : ' + d.score_lead + '/10',",
          "  '- Pack    : ' + packLabel,",
          "  '- Resume  : ' + d.resume_besoins,",
          "  '',",
          "  '## Actions pour Jordan',",
          "  actionsText,",
          "  '',",
          "  '## Email envoye',",
          "  '- Objet : ' + (emailOut.email_subject || 'N/A'),",
          "  '',",
          "  '---',",
          "  'Genere par NetroIA CRM - ' + new Date().toISOString(),",
          "].join('\\n');",
          "",
          "return [{",
          "  json: {",
          "    ...d,",
          "    email_subject   : emailOut.email_subject    || 'Votre demande NetroIA - ' + d.name,",
          "    email_body_html : emailOut.email_body_html  || '<p>Merci pour votre message.</p>',",
          "    mission_doc     : missionDoc,",
          "    pack_label      : packLabel,",
          "  },",
          "}];",
        ].join('\n'),
      },
    },

    // ── Etape 4a : Gmail ─────────────────────────────────────────────────────
    {
      id: 'gmail-node', name: N.gmailSend,
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [1700, 240],
      credentials: { gmailOAuth2: CRED.gmail },
      parameters: {
        sendTo: '={{ $json.email }}',
        subject: '={{ $json.email_subject }}',
        emailType: 'html',
        message: '={{ $json.email_body_html }}',
        options: {
          bccList: 'captain@netroia.com',
          senderName: 'NetroIA',
        },
      },
    },

    // ── Etape 4b : Slack ─────────────────────────────────────────────────────
    {
      id: 'slack-node', name: N.slackAlert,
      type: 'n8n-nodes-base.slack', typeVersion: 2.4,
      position: [1700, 380],
      credentials: { slackOAuth2Api: CRED.slack },
      parameters: {
        authentication: 'oAuth2',
        select: 'channel',
        channelId: {
          __rl: true,
          value: SLACK_CH_ID,
          mode: 'list',
          cachedResultName: 'n8n-alerts',
        },
        messageType: 'block',
        blocksUi: JSON.stringify([
          {
            type: 'header',
            text: { type: 'plain_text', text: 'NOUVEAU PROSPECT NetroIA', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*Nom :*\n{{ $json.name }}' },
              { type: 'mrkdwn', text: '*Email :*\n{{ $json.email }}' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*Pack estime :*\n{{ $json.pack_label }}' },
              { type: 'mrkdwn', text: '*Score Lead :*\n{{ $json.score_lead }}/10  |  Urgence : {{ $json.urgence }}' },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Resume :*\n{{ $json.resume_besoins }}' },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: "*Actions suggerees :*\n{{ $json.actions_suggerees.split(' | ').map((a, i) => (i+1) + '. ' + a).join('\\n') }}",
            },
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: '{{ $json.date }} | Source : netroia.tech | Email auto envoye' },
            ],
          },
        ]),
        otherOptions: {},
      },
    },

    // ── Etape 4c : Google Sheets ─────────────────────────────────────────────
    {
      id: 'sheets-node', name: N.sheetsLog,
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.4,
      position: [1700, 520],
      credentials: { googleSheetsOAuth2Api: CRED.sheets },
      parameters: {
        operation: 'append',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName:  { __rl: true, value: 'Leads',   mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            date              : '={{ $json.date }}',
            name              : '={{ $json.name }}',
            email             : '={{ $json.email }}',
            service           : '={{ $json.service }}',
            type_besoin       : '={{ $json.type_besoin }}',
            budget_estime     : '={{ $json.budget_estime }}',
            urgence           : '={{ $json.urgence }}',
            score_lead        : '={{ $json.score_lead }}',
            resume_besoins    : '={{ $json.resume_besoins }}',
            horodatage        : '={{ $json.horodatage }}',
          },
          schema: [
            { id: 'date',           displayName: 'date',           required: false, defaultMatch: false, type: 'string' },
            { id: 'name',           displayName: 'name',           required: false, defaultMatch: false, type: 'string' },
            { id: 'email',          displayName: 'email',          required: false, defaultMatch: false, type: 'string' },
            { id: 'service',        displayName: 'service',        required: false, defaultMatch: false, type: 'string' },
            { id: 'type_besoin',    displayName: 'type_besoin',    required: false, defaultMatch: false, type: 'string' },
            { id: 'budget_estime',  displayName: 'budget_estime',  required: false, defaultMatch: false, type: 'string' },
            { id: 'urgence',        displayName: 'urgence',        required: false, defaultMatch: false, type: 'string' },
            { id: 'score_lead',     displayName: 'score_lead',     required: false, defaultMatch: false, type: 'number' },
            { id: 'resume_besoins', displayName: 'resume_besoins', required: false, defaultMatch: false, type: 'string' },
            { id: 'horodatage',     displayName: 'horodatage',     required: false, defaultMatch: false, type: 'string' },
          ],
        },
        options: {},
      },
    },

    // ── Etape 4d : Reponse webhook ───────────────────────────────────────────
    {
      id: 'respond-node', name: N.respondHTTP,
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
      position: [1940, 380],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ success: true, message: "Message recu. Nous vous repondons dans les 24h." }) }}',
        options: { responseCode: 200 },
      },
    },
  ],

  // ─── Connexions ────────────────────────────────────────────────────────────
  // REGLE : la cle doit etre IDENTIQUE au champ `name` du noeud source.
  connections: {
    // Flux principal
    [N.webhook]        : { main: [[{ node: N.extract,         type: 'main', index: 0 }]] },
    [N.extract]        : { main: [[{ node: N.classifierAgent, type: 'main', index: 0 }]] },
    [N.classifierAgent]: { main: [[{ node: N.prepareSet,      type: 'main', index: 0 }]] },
    [N.prepareSet]     : { main: [[{ node: N.emailAgent,      type: 'main', index: 0 }]] },
    [N.emailAgent]     : { main: [[{ node: N.missionCode,     type: 'main', index: 0 }]] },
    [N.missionCode]    : { main: [[{ node: N.gmailSend,       type: 'main', index: 0 }]] },
    [N.gmailSend]      : { main: [[{ node: N.slackAlert,      type: 'main', index: 0 }]] },
    [N.slackAlert]     : { main: [[{ node: N.sheetsLog,       type: 'main', index: 0 }]] },
    [N.sheetsLog]      : { main: [[{ node: N.respondHTTP,     type: 'main', index: 0 }]] },

    // Connexions LangChain (ai_languageModel + ai_outputParser)
    // Noeud OpenAI → Classifier Demande
    [N.openaiMini]: {
      ai_languageModel: [[{ node: N.classifierAgent, type: 'ai_languageModel', index: 0 }]],
    },
    // Schema Classification → Classifier Demande
    [N.schemaClassif]: {
      ai_outputParser: [[{ node: N.classifierAgent, type: 'ai_outputParser', index: 0 }]],
    },
    // Noeud OpenAI → Generer Email
    [N.openaiGPT4]: {
      ai_languageModel: [[{ node: N.emailAgent, type: 'ai_languageModel', index: 0 }]],
    },
    // Schema Email → Generer Email
    [N.schemaEmail]: {
      ai_outputParser: [[{ node: N.emailAgent, type: 'ai_outputParser', index: 0 }]],
    },
  },

  settings: {
    executionOrder: 'v1',
    errorWorkflow: DEBBUG_ID,
  },
};

// ─── POST vers n8n API ──────────────────────────────────────────────────────
function apiPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: BASE_URL,
      port: 443,
      path: '/api/v1/workflows',
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('Creation du workflow : ' + workflow.name);
  console.log('Noeuds              : ' + workflow.nodes.length);
  console.log('Connexions          : ' + Object.keys(workflow.connections).join(', '));
  console.log('');

  // Sauvegarder le payload localement avant envoi
  const outFile = path.join(__dirname, '..', 'workflows', 'internal', 'crm-formulaire-contact-v2.json');
  fs.writeFileSync(outFile, JSON.stringify(workflow, null, 2), 'utf8');
  console.log('Payload sauvegarde : ' + outFile);

  const result = await apiPost({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings });

  if (result.status === 200 || result.status === 201) {
    const wf = result.body;
    console.log('');
    console.log('SUCCESS !');
    console.log('  ID n8n : ' + wf.id);
    console.log('  Nom    : ' + wf.name);
    console.log('  URL    : https://n8n.netroia.tech/workflow/' + wf.id);
    console.log('');
    console.log('Prochaines etapes :');
    console.log('  1. Dans le noeud "' + N.sheetsLog + '" : remplacer SPREADSHEET_ID_A_CONFIGURER');
    console.log('  2. Activer le workflow (bouton Activate)');
    console.log('  3. Tester avec : curl -X POST https://n8n.netroia.tech/webhook/contact-netroia ...');
  } else {
    console.error('ERREUR HTTP ' + result.status);
    console.error(JSON.stringify(result.body, null, 2));
    process.exit(1);
  }
})();
