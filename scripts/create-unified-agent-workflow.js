/**
 * create-unified-agent-workflow.js
 * Fusionne "NetroIA - CRM Formulaire Contact" et "NetroIA - Agent Terminal IA"
 * en un seul workflow : "NetroIA - Agent formulaire contact Terminal IA"
 *
 * Actions :
 *   1. Supprime le CRM Formulaire Contact (ID: 9T3KYNvJs6whJDJW)
 *   2. Supprime l'Agent Terminal IA     (ID: iW8Rt9LPFUz8U1sz)
 *   3. Cree le workflow unifie
 *
 * Architecture du workflow unifie :
 *
 *   [Webhook Terminal] → Valider Terminal → Agent IA Terminal ──→ Preparer Terminal ─┐
 *                        OpenAI Conversation ↗                                        │
 *   [Webhook Contact]  → Valider Contact ──────────────────────────────────────────→  ├→ Donnees Source
 *                                                                                     │
 *                         → Classifier Demande (gpt-4.1-mini + schema structuré)     │
 *                           OpenAI Classification ↗                                  │
 *                           Schema Classification ↗                                  │
 *                         → Preparer Enrichi (score_lead, urgence, type_besoin...)   │
 *                         → IF Prospect Qualifie (score >= 5 OU source=form)         │
 *                             TRUE → IF Email Disponible                              │
 *                                      TRUE → Generer Email → Envoyer Email Prospect ─┐
 *                                      FALSE ──────────────────────────────────────────┤
 *                                                                                       → Logger Sheets → Alerte Slack → Reponse Finale
 *                             FALSE → Reponse Directe (terminal non-qualifie)
 *
 * Execution : node scripts/create-unified-agent-workflow.js
 *
 * NOTE CLAUDE 3.5 SONNET :
 *   Modele conversationnel = gpt-4o (credential OpenAI existant).
 *   Pour migrer vers claude-3-5-sonnet-20241022 :
 *     1. Ajouter credential "Anthropic" dans n8n (type: anthropicApi)
 *     2. Remplacer noeud N.openaiConv :
 *        type: '@n8n/n8n-nodes-langchain.lmChatAnthropic'
 *        credentials: { anthropicApi: { id: 'VOTRE_ID', name: 'Anthropic' } }
 *        parameters: { model: 'claude-3-5-sonnet-20241022', options: { temperature: 0.7 } }
 *     3. Sauvegarder la cle dans C:\Netroia\credentials\anthropic-api.env
 *
 * CORS : ajouter N8N_CORS_ALLOWED_ORIGINS=https://netroia.tech a l'env VPS n8n.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const API_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGE5OTU2NC05MWNmLTRlYjQtYjZkOC0wZDU2M2NhODFlNzQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiY2YzNWZjNGUtZWU1Yy00Y2M5LWE1MDEtYjFmMmU3ODMyOTJmIiwiaWF0IjoxNzc1MzkwMDQ5fQ.Ae61Gjr8gsl_U7ElTWuEWT1JQldaOrK3uYvviTaKD4M';
const BASE_URL = 'n8n.netroia.tech';

// ─── Workflows a supprimer ──────────────────────────────────────────────────
const DELETE_IDS = [
  { id: '9T3KYNvJs6whJDJW', name: 'NetroIA - CRM Formulaire Contact' },
  { id: 'iW8Rt9LPFUz8U1sz', name: 'NetroIA - Agent Terminal IA' },
];

// ─── IDs credentials production (verifies 2026-04-05) ──────────────────────
const CRED = {
  openai  : { id: 'g1I5vYXiH7nvxbYX', name: 'OpenAi account' },
  gmail   : { id: '1Bayzmr9ePmWdToL', name: 'captain' },
  slack   : { id: 'HQ7TA73vHn5QPIQs', name: 'Slack account' },
  sheets  : { id: '96DyhZeedQou7Yho', name: 'Google Sheets account' },
};
const DEBBUG_ID   = 'Uc73W2jImd5arguG';
const SLACK_CH_ID = 'C0A8SHN845D';  // #n8n-alerts — TODO: remplacer par #prospects-netroia
const SHEET_ID    = '1MfPCOMGtLsEuOq4AdyE93FTOb58hEthntAHULFLXeKE'; // CRM NetroIA existant

// ─── Noms des noeuds (ASCII pur) ─────────────────────────────────────────────
const N = {
  // Sticky notes
  stickyArchi     : 'Note Architecture',
  stickyBranche1  : 'Note Branche Terminal',
  stickyBranche2  : 'Note Branche Formulaire',
  stickyCRM       : 'Note Pipeline CRM',

  // Webhooks (2 entrees)
  webhookTerminal : 'Webhook Terminal',
  webhookContact  : 'Webhook Contact',

  // Validation
  validerTerminal : 'Valider Terminal',
  validerContact  : 'Valider Contact',

  // Branche terminal : agent conversationnel
  agentIA         : 'Agent IA Terminal',
  openaiConv      : 'OpenAI Conversation',  // gpt-4o, T=0.7
  preparerTerminal: 'Preparer Terminal',    // normalise output Agent IA

  // Fan-in + pipeline CRM
  donneesSource   : 'Donnees Source',       // pass-through, point de reference commun
  classifier      : 'Classifier Demande',   // gpt-4.1-mini, T=0, structured output
  openaiMini      : 'OpenAI Classification',
  schemaClassif   : 'Schema Classification',
  preparerEnrichi : 'Preparer Enrichi',     // enrichit avec score, urgence, pack...

  // IF qualification
  ifProspect      : 'IF Prospect Qualifie', // score >= 5 OU source=form
  ifEmail         : 'IF Email Disponible',  // has_email === true

  // Branche email (prospect avec email)
  genererEmail    : 'Generer Email',        // gpt-4.1, T=0.7, structured output
  openaiEmail     : 'OpenAI Email',
  schemaEmail     : 'Schema Email',
  envoyerEmail    : 'Envoyer Email Prospect',

  // Actions CRM communes (fan-in depuis branche email et branche no-email)
  loggerSheets    : 'Logger Sheets',
  alerteSlack     : 'Alerte Slack',
  reponse         : 'Reponse Finale',       // JSON pour terminal, 200 pour form

  // Reponse directe terminal non-qualifie
  reponseDirect   : 'Reponse Directe',
};

// ─── Workflow definition ────────────────────────────────────────────────────
const workflow = {
  name: 'NetroIA - Agent formulaire contact Terminal IA',
  nodes: [

    // ════════════════════════════════════════════════════════════════════════
    // STICKY NOTES
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'sticky-archi', name: N.stickyArchi,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [200, 40],
      parameters: {
        content: [
          '## NetroIA - Agent formulaire contact Terminal IA',
          '',
          'ENTREES :',
          '  POST /webhook/terminal-agent  → { user_input, session_id }',
          '  POST /webhook/contact-netroia → { name, email, service, message, source, date }',
          '',
          'PIPELINE COMMUN (apres normalisation) :',
          '  Classifier IA (gpt-4.1-mini) → score_lead, urgence, type_besoin, budget_estime',
          '  IF prospect qualifie (score >= 5 OU formulaire) :',
          '    → IF email disponible → Generer email HTML → Envoyer prospect',
          '    → Logger Sheets → Alerte Slack → Reponse',
          '',
          'CORS : N8N_CORS_ALLOWED_ORIGINS=https://netroia.tech sur le VPS.',
          'Claude 3.5 Sonnet : voir NOTE CLAUDE en tete du script.',
        ].join('\n'),
        height: 240, width: 900, color: 5,
      },
    },
    {
      id: 'sticky-b1', name: N.stickyBranche1,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [200, 380],
      parameters: {
        content: [
          '## Branche Terminal',
          '/webhook/terminal-agent',
          '{ user_input, session_id }',
          '',
          'Agent IA : gpt-4o, T=0.7',
          'Retourne reponse conversationnelle.',
        ].join('\n'),
        height: 180, width: 320, color: 6,
      },
    },
    {
      id: 'sticky-b2', name: N.stickyBranche2,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [200, 680],
      parameters: {
        content: [
          '## Branche Formulaire Contact',
          '/webhook/contact-netroia',
          '{ name, email, service, message }',
          '',
          'Validation stricte (nom, email, message >= 10 car.)',
          'Toujours qualifie (source=form).',
        ].join('\n'),
        height: 180, width: 320, color: 3,
      },
    },
    {
      id: 'sticky-crm', name: N.stickyCRM,
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [1200, 40],
      parameters: {
        content: [
          '## Pipeline CRM commun',
          '',
          'Classifier : gpt-4.1-mini | T=0',
          'Champs : urgence / type_besoin / budget_estime',
          '         resume_besoins / actions_suggerees / score_lead',
          '',
          'Pack labels : Starter / Avance / Sur Mesure / Personnalise',
          '',
          'Email : gpt-4.1 | T=0.7 | HTML complet | BCC captain',
          'Sheets ID : ' + SHEET_ID.substring(0, 20) + '...',
          'Slack : ' + SLACK_CH_ID + ' (#n8n-alerts — TODO #prospects)',
        ].join('\n'),
        height: 240, width: 580, color: 4,
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ENTREES — 2 webhooks
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'webhook-terminal', name: N.webhookTerminal,
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [200, 600],
      parameters: {
        httpMethod: 'POST',
        path: 'terminal-agent',
        responseMode: 'responseNode',
        options: {},
      },
    },
    {
      id: 'webhook-contact', name: N.webhookContact,
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [200, 840],
      parameters: {
        httpMethod: 'POST',
        path: 'contact-netroia',
        responseMode: 'responseNode',
        options: {},
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // VALIDATION
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'valider-terminal', name: N.validerTerminal,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [440, 600],
      parameters: {
        jsCode: [
          "const body = $input.item.json.body || $input.item.json;",
          "const user_input = (body.user_input || '').trim();",
          "const session_id = (body.session_id || ('anon-' + Date.now())).trim();",
          "if (!user_input || user_input.length < 1) throw new Error('user_input vide');",
          "if (user_input.length > 2000) throw new Error('user_input trop long');",
          "return [{ json: { user_input, session_id, timestamp: new Date().toISOString() } }];",
        ].join('\n'),
      },
    },
    {
      id: 'valider-contact', name: N.validerContact,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [440, 840],
      parameters: {
        jsCode: [
          "const body = $input.item.json.body || $input.item.json;",
          "const name    = (body.name    || '').trim();",
          "const email   = (body.email   || '').trim().toLowerCase();",
          "const service = (body.service || 'autre').trim();",
          "const message = (body.message || '').trim();",
          "const date    = body.date   || new Date().toISOString();",
          "const source  = body.source || 'netroia.tech';",
          "if (!name    || name.length    < 2)   throw new Error('Champ name invalide');",
          "if (!email   || !email.includes('@')) throw new Error('Champ email invalide');",
          "if (!message || message.length < 10)  throw new Error('Message trop court');",
          "return [{ json: {",
          "  source_type : 'form',",
          "  user_input  : message,",
          "  ai_response : null,",
          "  session_id  : null,",
          "  name, email, service, date,",
          "  timestamp   : new Date().toISOString(),",
          "  has_email   : true,",
          "} }];",
        ].join('\n'),
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // BRANCHE TERMINAL — Agent conversationnel
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'agent-ia', name: N.agentIA,
      type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3,
      position: [700, 600],
      parameters: {
        promptType: 'define',
        text: '={{ $json.user_input }}',
        hasOutputParser: false,
        options: {
          systemMessage: [
            "Tu es l'Agent d'analyse NetroIA, assistant commercial IA specialise en automatisation pour PME.",
            "Tu incarnes NetroIA (agence automatisation IA B2B, Nantes, France — fondateur Jordan Vincent).",
            "",
            "ROLE : Qualifier les besoins du visiteur en automatisation et IA.",
            "- Poser des questions pertinentes pour comprendre le processus metier.",
            "- Proposer des solutions concretes issues de l'offre NetroIA.",
            "- Guider vers un audit express ou un rendez-vous decouverte 30 min.",
            "",
            "OFFRES NETROIA :",
            "- Pack Starter (500-1000 EUR) : automatisation simple, agent IA de base",
            "- Pack Avance (1200-2500 EUR) : workflows complexes, integrations multi-outils",
            "- Pack Sur Mesure (5000-10000 EUR) : systeme agentique complet, architecture IA",
            "- Pack Personnalise (sur devis) : automatisation + IA + webdesign combines",
            "",
            "REGLES :",
            "1. Reponses courtes (2 a 4 phrases max) adaptees a un terminal de chat.",
            "2. Toujours terminer par une question de qualification.",
            "3. Si audit, coordonnees, rendez-vous ou devis mentionne : confirmer et encourager.",
            "4. Ton : professionnel, direct, expert mais accessible.",
            "5. Langue : francais systematiquement.",
            "6. Ne jamais inventer de chiffres ou clients — rester factuel sur l'offre.",
          ].join('\n'),
          returnIntermediateSteps: false,
        },
      },
    },
    // NOTE CLAUDE : remplacer ce noeud par lmChatAnthropic pour Claude 3.5 Sonnet
    {
      id: 'openai-conv', name: N.openaiConv,
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.3,
      position: [620, 800],
      credentials: { openAiApi: CRED.openai },
      parameters: {
        model: { __rl: true, mode: 'list', value: 'gpt-4o' },
        options: { temperature: 0.7 },
      },
    },

    // Normalise la sortie de l'Agent IA en format commun
    {
      id: 'preparer-terminal', name: N.preparerTerminal,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [940, 600],
      parameters: {
        jsCode: [
          "const validData = $('Valider Terminal').first().json;",
          "return [{ json: {",
          "  source_type : 'terminal',",
          "  user_input  : validData.user_input,",
          "  ai_response : $json.output || '',",
          "  session_id  : validData.session_id,",
          "  name        : null,",
          "  email       : null,",
          "  service     : null,",
          "  date        : validData.timestamp,",
          "  timestamp   : validData.timestamp,",
          "  has_email   : false,",
          "} }];",
        ].join('\n'),
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // FAN-IN — Point de convergence des 2 branches
    // ════════════════════════════════════════════════════════════════════════
    // Recoit soit Preparer Terminal, soit Valider Contact.
    // Passe les donnees en l'etat — sert de point de reference $('Donnees Source')
    {
      id: 'donnees-source', name: N.donneesSource,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1180, 700],
      parameters: {
        jsCode: "return [{ json: $input.item.json }];",
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // CLASSIFICATION IA (commun aux deux branches)
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'classifier-node', name: N.classifier,
      type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3,
      position: [1420, 700],
      parameters: {
        promptType: 'define',
        text: [
          "=Analyse ce message prospect et retourne le JSON de classification.",
          "",
          "SOURCE : {{ $json.source_type }}",
          "NOM : {{ $json.name || 'Visiteur terminal' }}",
          "EMAIL : {{ $json.email || 'Non communique' }}",
          "SERVICE : {{ $json.service || 'Non specifie' }}",
          "MESSAGE : {{ $json.user_input }}",
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
            "Tu analyses les messages prospects de NetroIA (agence automatisation IA, Nantes, France).",
            "Temperature=0 : tes reponses sont deterministes.",
            "Tu retournes UNIQUEMENT du JSON valide selon le schema fourni, aucun texte autour.",
          ].join(' '),
          returnIntermediateSteps: false,
        },
      },
    },
    {
      id: 'openai-mini', name: N.openaiMini,
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.3,
      position: [1340, 900],
      credentials: { openAiApi: CRED.openai },
      parameters: {
        model: { __rl: true, mode: 'list', value: 'gpt-4.1-mini' },
        options: { temperature: 0 },
      },
    },
    {
      id: 'schema-classif', name: N.schemaClassif,
      type: '@n8n/n8n-nodes-langchain.outputParserStructured', typeVersion: 1.3,
      position: [1540, 900],
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

    // Aplatit et enrichit la classification avec les donnees source
    {
      id: 'preparer-enrichi', name: N.preparerEnrichi,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1660, 700],
      parameters: {
        jsCode: [
          "const base   = $('Donnees Source').first().json;",
          "const classif = $json.output || {};",
          "const packLabels = {",
          "  starter      : 'Pack Starter (500 - 1 000 EUR)',",
          "  avance       : 'Pack Avance (1 200 - 2 500 EUR)',",
          "  sur_mesure   : 'Pack Sur Mesure (5 000 - 10 000 EUR)',",
          "  personnalise : 'Pack Personnalise (sur devis)',",
          "};",
          "return [{ json: {",
          "  ...base,",
          "  urgence           : classif.urgence           || 'normale',",
          "  type_besoin       : classif.type_besoin       || 'autre',",
          "  budget_estime     : classif.budget_estime     || 'starter',",
          "  resume_besoins    : classif.resume_besoins    || '',",
          "  actions_suggerees : (classif.actions_suggerees || []).join(' | '),",
          "  score_lead        : classif.score_lead        || 1,",
          "  pack_label        : packLabels[classif.budget_estime] || classif.budget_estime || '',",
          "  horodatage        : new Date().toISOString(),",
          "} }];",
        ].join('\n'),
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // IF qualification : score >= 5 OU source=form
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'if-prospect', name: N.ifProspect,
      type: 'n8n-nodes-base.if', typeVersion: 2,
      position: [1900, 700],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' },
          combinator: 'or',
          conditions: [
            {
              id: 'cond-score',
              leftValue: '={{ $json.score_lead }}',
              rightValue: 5,
              operator: { type: 'number', operation: 'gte', name: 'filter.operator.gte' },
            },
            {
              id: 'cond-form',
              leftValue: '={{ $json.source_type }}',
              rightValue: 'form',
              operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
            },
          ],
        },
        options: {},
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // IF email disponible (branche TRUE de ifProspect)
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'if-email', name: N.ifEmail,
      type: 'n8n-nodes-base.if', typeVersion: 2,
      position: [2140, 580],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' },
          combinator: 'and',
          conditions: [{
            id: 'cond-email',
            leftValue: '={{ $json.has_email }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', name: 'filter.operator.true' },
          }],
        },
        options: {},
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GENERATION EMAIL (branche has_email = TRUE)
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'generer-email', name: N.genererEmail,
      type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3,
      position: [2380, 460],
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
          "Message      : {{ $json.user_input }}",
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
      id: 'openai-email', name: N.openaiEmail,
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.3,
      position: [2300, 660],
      credentials: { openAiApi: CRED.openai },
      parameters: {
        model: { __rl: true, mode: 'list', value: 'gpt-4.1' },
        options: { temperature: 0.7 },
      },
    },
    {
      id: 'schema-email', name: N.schemaEmail,
      type: '@n8n/n8n-nodes-langchain.outputParserStructured', typeVersion: 1.3,
      position: [2500, 660],
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

    // Envoie l'email HTML au prospect (BCC captain)
    {
      id: 'envoyer-email', name: N.envoyerEmail,
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2620, 460],
      credentials: { gmailOAuth2: CRED.gmail },
      parameters: {
        sendTo: "={{ $('Preparer Enrichi').first().json.email }}",
        subject: "={{ $json.output.email_subject || 'Votre demande NetroIA - ' + $('Preparer Enrichi').first().json.name }}",
        emailType: 'html',
        message: "={{ $json.output.email_body_html || '<p>Merci pour votre message. Nous vous contactons sous 24h.</p>' }}",
        options: {
          bccList: 'captain@netroia.com',
          senderName: 'NetroIA',
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ACTIONS CRM COMMUNES (fan-in depuis branche email et branche no-email)
    // Toutes les expressions referencent $('Preparer Enrichi').first().json
    // ════════════════════════════════════════════════════════════════════════
    {
      id: 'logger-sheets', name: N.loggerSheets,
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.4,
      position: [2860, 580],
      credentials: { googleSheetsOAuth2Api: CRED.sheets },
      parameters: {
        operation: 'append',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName:  { __rl: true, value: 'Feuille 1', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            date          : "={{ $('Preparer Enrichi').first().json.date }}",
            name          : "={{ $('Preparer Enrichi').first().json.name || 'Terminal - ' + $('Preparer Enrichi').first().json.session_id }}",
            email         : "={{ $('Preparer Enrichi').first().json.email || 'N/A' }}",
            service       : "={{ $('Preparer Enrichi').first().json.service || $('Preparer Enrichi').first().json.source_type }}",
            type_besoin   : "={{ $('Preparer Enrichi').first().json.type_besoin }}",
            budget_estime : "={{ $('Preparer Enrichi').first().json.budget_estime }}",
            urgence       : "={{ $('Preparer Enrichi').first().json.urgence }}",
            score_lead    : "={{ $('Preparer Enrichi').first().json.score_lead }}",
            resume_besoins: "={{ $('Preparer Enrichi').first().json.resume_besoins }}",
            horodatage    : "={{ $('Preparer Enrichi').first().json.horodatage }}",
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

    {
      id: 'alerte-slack', name: N.alerteSlack,
      type: 'n8n-nodes-base.slack', typeVersion: 2.4,
      position: [3100, 580],
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
            text: {
              type: 'plain_text',
              text: "={{ $('Preparer Enrichi').first().json.source_type === 'form' ? 'NOUVEAU PROSPECT (formulaire)' : 'LEAD TERMINAL IA' }} — NetroIA",
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: "*Contact :*\n={{ $('Preparer Enrichi').first().json.name || 'Visiteur terminal - ' + $('Preparer Enrichi').first().json.session_id }}" },
              { type: 'mrkdwn', text: "*Email :*\n={{ $('Preparer Enrichi').first().json.email || 'Non communique' }}" },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: "*Score Lead :*\n={{ $('Preparer Enrichi').first().json.score_lead }}/10 | {{ $('Preparer Enrichi').first().json.urgence }}" },
              { type: 'mrkdwn', text: "*Pack estime :*\n={{ $('Preparer Enrichi').first().json.pack_label }}" },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: "*Besoin :*\n={{ $('Preparer Enrichi').first().json.type_besoin }} | {{ $('Preparer Enrichi').first().json.resume_besoins }}" },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: "*Message :*\n={{ $('Preparer Enrichi').first().json.user_input }}" },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: "={{ $('Preparer Enrichi').first().json.source_type }} | {{ $('Preparer Enrichi').first().json.horodatage }}",
              },
            ],
          },
        ]),
        otherOptions: {},
      },
    },

    // Reponse finale — adapte selon la source (terminal ou formulaire)
    {
      id: 'reponse-finale', name: N.reponse,
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
      position: [3340, 580],
      parameters: {
        respondWith: 'json',
        responseBody: [
          "={{ JSON.stringify(",
          "  $('Preparer Enrichi').first().json.source_type === 'terminal'",
          "    ? { response: $('Preparer Enrichi').first().json.ai_response || 'Votre demande a bien ete enregistree.', session_id: $('Preparer Enrichi').first().json.session_id }",
          "    : { success: true, message: 'Message recu. Nous vous repondons dans les 24h.' }",
          ") }}",
        ].join(''),
        options: {
          responseCode: 200,
          responseHeaders: {
            entries: [
              { name: 'Access-Control-Allow-Origin', value: 'https://netroia.tech' },
              { name: 'Access-Control-Allow-Headers', value: 'Content-Type' },
              { name: 'Content-Type', value: 'application/json' },
            ],
          },
        },
      },
    },

    // Reponse directe pour terminal non-qualifie (score < 5)
    {
      id: 'reponse-direct', name: N.reponseDirect,
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
      position: [2140, 860],
      parameters: {
        respondWith: 'json',
        responseBody: [
          "={{ JSON.stringify({",
          "  response: $('Preparer Enrichi').first().json.ai_response || '',",
          "  session_id: $('Preparer Enrichi').first().json.session_id",
          "}) }}",
        ].join(''),
        options: {
          responseCode: 200,
          responseHeaders: {
            entries: [
              { name: 'Access-Control-Allow-Origin', value: 'https://netroia.tech' },
              { name: 'Access-Control-Allow-Headers', value: 'Content-Type' },
              { name: 'Content-Type', value: 'application/json' },
            ],
          },
        },
      },
    },
  ],

  // ─── Connexions ──────────────────────────────────────────────────────────
  connections: {
    // Webhook Terminal → validation → agent → normalisation → fan-in
    [N.webhookTerminal] : { main: [[{ node: N.validerTerminal, type: 'main', index: 0 }]] },
    [N.validerTerminal] : { main: [[{ node: N.agentIA,         type: 'main', index: 0 }]] },
    [N.agentIA]         : { main: [[{ node: N.preparerTerminal,type: 'main', index: 0 }]] },
    [N.preparerTerminal]: { main: [[{ node: N.donneesSource,   type: 'main', index: 0 }]] },

    // Webhook Contact → validation → fan-in
    [N.webhookContact]  : { main: [[{ node: N.validerContact,  type: 'main', index: 0 }]] },
    [N.validerContact]  : { main: [[{ node: N.donneesSource,   type: 'main', index: 0 }]] },

    // Fan-in → pipeline CRM
    [N.donneesSource]   : { main: [[{ node: N.classifier,      type: 'main', index: 0 }]] },
    [N.classifier]      : { main: [[{ node: N.preparerEnrichi, type: 'main', index: 0 }]] },
    [N.preparerEnrichi] : { main: [[{ node: N.ifProspect,      type: 'main', index: 0 }]] },

    // IF Prospect (TRUE → IF Email, FALSE → Reponse Directe)
    [N.ifProspect]: {
      main: [
        [{ node: N.ifEmail,       type: 'main', index: 0 }],
        [{ node: N.reponseDirect, type: 'main', index: 0 }],
      ],
    },

    // IF Email (TRUE → generer email, FALSE → logger)
    [N.ifEmail]: {
      main: [
        [{ node: N.genererEmail,  type: 'main', index: 0 }],
        [{ node: N.loggerSheets,  type: 'main', index: 0 }],
      ],
    },

    // Branche email
    [N.genererEmail]: { main: [[{ node: N.envoyerEmail,  type: 'main', index: 0 }]] },
    [N.envoyerEmail]: { main: [[{ node: N.loggerSheets,  type: 'main', index: 0 }]] },

    // Actions communes (fan-in)
    [N.loggerSheets]: { main: [[{ node: N.alerteSlack, type: 'main', index: 0 }]] },
    [N.alerteSlack] : { main: [[{ node: N.reponse,     type: 'main', index: 0 }]] },

    // LangChain : modeles → agents
    [N.openaiConv]: {
      ai_languageModel: [[{ node: N.agentIA, type: 'ai_languageModel', index: 0 }]],
    },
    [N.openaiMini]: {
      ai_languageModel: [[{ node: N.classifier, type: 'ai_languageModel', index: 0 }]],
    },
    [N.schemaClassif]: {
      ai_outputParser: [[{ node: N.classifier, type: 'ai_outputParser', index: 0 }]],
    },
    [N.openaiEmail]: {
      ai_languageModel: [[{ node: N.genererEmail, type: 'ai_languageModel', index: 0 }]],
    },
    [N.schemaEmail]: {
      ai_outputParser: [[{ node: N.genererEmail, type: 'ai_outputParser', index: 0 }]],
    },
  },

  settings: {
    executionOrder: 'v1',
    errorWorkflow: DEBBUG_ID,
  },
};

// ─── Validation connexions ────────────────────────────────────────────────────
function validateConnections(wf) {
  const nodeNames = new Set(wf.nodes.map(n => n.name));
  const errors = [];
  for (const [src, conn] of Object.entries(wf.connections)) {
    if (!nodeNames.has(src)) errors.push('Source inconnue : ' + src);
    const targets = [
      ...(conn.main              || []).flat(),
      ...(conn.ai_languageModel  || []).flat(),
      ...(conn.ai_outputParser   || []).flat(),
    ];
    for (const t of targets) {
      if (!nodeNames.has(t.node)) errors.push('Cible inconnue : ' + t.node + ' (depuis ' + src + ')');
    }
  }
  if (errors.length) {
    console.error('VALIDATION ECHOUEE :');
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('Validation connexions : OK (' + Object.keys(wf.connections).length + ' sources)');
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function apiRequest(method, pathUrl, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const options = {
      hostname: BASE_URL,
      port: 443,
      path: pathUrl,
      method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
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
    if (body) req.write(body);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('');
  console.log('=== NetroIA - Agent formulaire contact Terminal IA ===');
  console.log('Noeuds    : ' + workflow.nodes.length);
  console.log('');

  // 1. Supprimer les anciens workflows
  for (const wf of DELETE_IDS) {
    console.log('Suppression : ' + wf.name + ' (' + wf.id + ')');
    const del = await apiRequest('DELETE', '/api/v1/workflows/' + wf.id);
    if (del.status === 200 || del.status === 204) {
      console.log('  ✓ Supprime');
    } else {
      console.warn('  ⚠ HTTP ' + del.status + ' — ' + JSON.stringify(del.body));
    }
  }
  console.log('');

  // 2. Valider les connexions
  validateConnections(workflow);

  // 3. Sauvegarder le payload
  const outFile = path.join(__dirname, '..', 'workflows', 'internal', 'agent-formulaire-contact-terminal-v1.json');
  fs.writeFileSync(outFile, JSON.stringify(workflow, null, 2), 'utf8');
  console.log('Payload sauvegarde : ' + outFile);
  console.log('');

  // 4. Creer le workflow
  const result = await apiRequest('POST', '/api/v1/workflows', {
    name        : workflow.name,
    nodes       : workflow.nodes,
    connections : workflow.connections,
    settings    : workflow.settings,
  });

  if (result.status === 200 || result.status === 201) {
    const wf = result.body;
    console.log('SUCCESS !');
    console.log('  ID n8n    : ' + wf.id);
    console.log('  Nom       : ' + wf.name);
    console.log('  URL n8n   : https://n8n.netroia.tech/workflow/' + wf.id);
    console.log('');
    console.log('WEBHOOKS actifs apres activation :');
    console.log('  Terminal  : https://n8n.netroia.tech/webhook/terminal-agent');
    console.log('  Formulaire: https://n8n.netroia.tech/webhook/contact-netroia');
    console.log('');
    console.log('ETAPES POST-DEPLOIEMENT :');
    console.log('  1. Activer le workflow (toggle Active)');
    console.log('  2. Google Sheet "Feuille 1" : verifier les headers (ligne 1)');
    console.log('     date/name/email/service/type_besoin/budget_estime/urgence/score_lead/resume_besoins/horodatage');
    console.log('  3. Creer #prospects-netroia dans Slack + inviter le bot + remplacer SLACK_CH_ID');
    console.log('  4. VPS : N8N_CORS_ALLOWED_ORIGINS=https://netroia.tech');
    console.log('  5. (Optionnel) Migrer Agent IA vers Claude 3.5 Sonnet (voir NOTE CLAUDE)');
    console.log('');
    console.log('TESTS :');
    console.log('  Terminal :');
    console.log("  curl -X POST https://n8n.netroia.tech/webhook/terminal-agent \\");
    console.log('    -H "Content-Type: application/json" \\');
    console.log("    -d '{\"user_input\":\"Je veux automatiser ma facturation\",\"session_id\":\"test-001\"}'");
    console.log('');
    console.log('  Formulaire :');
    console.log("  curl -X POST https://n8n.netroia.tech/webhook/contact-netroia \\");
    console.log('    -H "Content-Type: application/json" \\');
    console.log("    -d '{\"name\":\"Test Client\",\"email\":\"captain@netroia.com\",\"service\":\"avance\",\"message\":\"Automatisation leads IA pour qualification prospects.\",\"source\":\"netroia.tech\"}'");
  } else {
    console.error('ERREUR HTTP ' + result.status);
    console.error(JSON.stringify(result.body, null, 2));
    process.exit(1);
  }
})();
