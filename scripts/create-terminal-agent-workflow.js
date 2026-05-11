/**
 * create-terminal-agent-workflow.js
 * Cree le workflow "NetroIA - Agent Terminal IA" sur n8n via API REST.
 * Execution : node scripts/create-terminal-agent-workflow.js
 *
 * Fonctionnement :
 *   POST /webhook/terminal-agent → { user_input, session_id }
 *   → Agent IA (OpenAI gpt-4o par defaut — voir NOTE CLAUDE ci-dessous)
 *   → Detecte si prospect (audit/contact/devis/rdv)
 *   → Si prospect : Slack #prospects-netroia + Email interne captain@netroia.com
 *   → Retourne { response, session_id } au terminal
 *
 * NOTE CLAUDE 3.5 SONNET :
 *   Le modele par defaut est gpt-4o (credentials OpenAI existants).
 *   Pour utiliser claude-3-5-sonnet-20241022 :
 *     1. Ajouter credential "Anthropic" dans n8n (type: anthropicApi, API key Anthropic)
 *     2. Remplacer le noeud N.openaiModel par :
 *        type: '@n8n/n8n-nodes-langchain.lmChatAnthropic'
 *        credentials: { anthropicApi: { id: 'VOTRE_ID_CREDENTIAL', name: 'Anthropic' } }
 *        parameters: { model: 'claude-3-5-sonnet-20241022', options: { temperature: 0.7 } }
 *     3. Sauvegarder la cle dans C:\Netroia\credentials\anthropic-api.env
 *
 * CORS :
 *   Sur le VPS, ajouter a l'env n8n (docker-compose ou systemd) :
 *     N8N_CORS_ALLOWED_ORIGINS=https://netroia.tech
 *   Les headers CORS sont aussi inclus dans le noeud "Respond to Webhook".
 *
 * Regles de nommage :
 *   Noms de noeuds : ASCII pur (sans accents, sans emojis)
 *   Raison : connexions LangChain utilisent le NOM comme cle.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const API_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGE5OTU2NC05MWNmLTRlYjQtYjZkOC0wZDU2M2NhODFlNzQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiY2YzNWZjNGUtZWU1Yy00Y2M5LWE1MDEtYjFmMmU3ODMyOTJmIiwiaWF0IjoxNzc1MzkwMDQ5fQ.Ae61Gjr8gsl_U7ElTWuEWT1JQldaOrK3uYvviTaKD4M';
const BASE_URL = 'n8n.netroia.tech';

// ─── IDs production NetroIA (verifies 2026-04-05) ──────────────────────────
const CRED = {
  openai : { id: 'g1I5vYXiH7nvxbYX', name: 'OpenAi account' },
  gmail  : { id: '1Bayzmr9ePmWdToL', name: 'captain' },
  slack  : { id: 'HQ7TA73vHn5QPIQs', name: 'Slack account' },
};
const DEBBUG_ID = 'Uc73W2jImd5arguG';

// ─── Canal Slack ────────────────────────────────────────────────────────────
// ATTENTION : #prospects-netroia doit etre cree dans Slack et le bot invite.
// Si le canal n'existe pas encore, utiliser C0A8SHN845D (#n8n-alerts).
// Pour trouver l'ID d'un canal : https://api.slack.com/methods/conversations.list
const SLACK_PROSPECTS_CH = 'PROSPECTS_CHANNEL_ID'; // TODO : remplacer par l'ID reel
const SLACK_FALLBACK_CH  = 'C0A8SHN845D';          // #n8n-alerts (fonctionne — fallback)

// ─── Noms des noeuds (ASCII pur = connexions stables) ──────────────────────
const N = {
  webhook       : 'Webhook Terminal',
  validateInput : 'Valider Input',
  agentIA       : 'Agent IA Terminal',
  openaiModel   : 'OpenAI GPT4o',
  detectIntent  : 'Detecter Intention',
  ifProspect    : 'Prospect Detecte',
  slackProspect : 'Slack Prospect',
  emailProspect : 'Email Prospect',
  reponseTrue   : 'Reponse Prospect',   // fin branche TRUE (prospect)
  reponseFalse  : 'Reponse Terminal',   // fin branche FALSE (conversation normale)
};

// ─── Workflow definition ────────────────────────────────────────────────────
const workflow = {
  name: 'NetroIA - Agent Terminal IA',
  nodes: [

    // ── Sticky note ─────────────────────────────────────────────────────────
    {
      id: 'sticky-main', name: 'Note Architecture',
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [200, 60],
      parameters: {
        content: [
          '## NetroIA - Agent Terminal IA',
          '',
          'Webhook POST /terminal-agent : { user_input, session_id }',
          '→ Validation → Agent IA (gpt-4o) → Detection intention prospect',
          '→ Si prospect : Slack + Email → Reponse terminale',
          '→ Sinon : Reponse directe',
          '',
          'CORS : configurer N8N_CORS_ALLOWED_ORIGINS=https://netroia.tech sur le VPS.',
          'Claude 3.5 Sonnet : voir commentaire en tete du script de creation.',
        ].join('\n'),
        height: 180, width: 700, color: 5,
      },
    },

    // ── Etape 1 : Webhook ───────────────────────────────────────────────────
    {
      id: 'webhook-node', name: N.webhook,
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [200, 340],
      parameters: {
        httpMethod: 'POST',
        path: 'terminal-agent',
        responseMode: 'responseNode',
        options: {},
      },
    },

    // ── Etape 2 : Validation input ──────────────────────────────────────────
    {
      id: 'validate-node', name: N.validateInput,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [420, 340],
      parameters: {
        jsCode: [
          "const body = $input.item.json.body || $input.item.json;",
          "",
          "const user_input = (body.user_input || '').trim();",
          "const session_id = (body.session_id || ('anon-' + Date.now())).trim();",
          "",
          "if (!user_input || user_input.length < 1) throw new Error('user_input vide');",
          "if (user_input.length > 2000) throw new Error('user_input trop long (max 2000 car.)');",
          "",
          "return [{ json: {",
          "  user_input,",
          "  session_id,",
          "  timestamp: new Date().toISOString(),",
          "} }];",
        ].join('\n'),
      },
    },

    // ── Etape 3 : Agent IA ──────────────────────────────────────────────────
    {
      id: 'agent-ia-node', name: N.agentIA,
      type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3,
      position: [680, 340],
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
            "3. Si audit, coordonnees, rendez-vous ou devis est mentionne : confirmer et encourager.",
            "4. Ton : professionnel, direct, expert mais accessible.",
            "5. Langue : francais systematiquement.",
            "6. Ne jamais inventer de chiffres ou de clients — rester factuel sur l'offre.",
          ].join('\n'),
          returnIntermediateSteps: false,
        },
      },
    },

    // ── LangChain : modele de langage ───────────────────────────────────────
    // Pour passer a Claude 3.5 Sonnet : voir NOTE CLAUDE en tete de fichier.
    {
      id: 'openai-model-node', name: N.openaiModel,
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.3,
      position: [600, 540],
      credentials: { openAiApi: CRED.openai },
      parameters: {
        model: { __rl: true, mode: 'list', value: 'gpt-4o' },
        options: { temperature: 0.7 },
      },
    },

    // ── Etape 4 : Detection intention prospect ──────────────────────────────
    {
      id: 'detect-intent-node', name: N.detectIntent,
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [920, 340],
      parameters: {
        jsCode: [
          "const userInput  = ($('Valider Input').first().json.user_input || '').toLowerCase();",
          "const aiResponse = ($json.output || '').toLowerCase();",
          "const sessionId  = $('Valider Input').first().json.session_id;",
          "const timestamp  = $('Valider Input').first().json.timestamp;",
          "",
          "// Mots-cles signalant un prospect qualifie",
          "const keywords = [",
          "  'audit', 'devis', 'tarif', 'prix', 'cout', 'budget',",
          "  'rendez-vous', 'rdv', 'appel', 'rappel', 'contact',",
          "  'coordonn', 'email', 'telephone', 'interesse',",
          "  'je veux', 'je souhaite', 'comment vous', 'je laisse',",
          "  'planifier', 'reserver', 'booking', 'demo',",
          "];",
          "",
          "const isProspect = keywords.some(kw =>",
          "  userInput.includes(kw) || aiResponse.includes(kw)",
          ");",
          "",
          "return [{",
          "  json: {",
          "    ai_response : $json.output || '',",
          "    session_id  : sessionId,",
          "    user_input  : $('Valider Input').first().json.user_input,",
          "    is_prospect : isProspect,",
          "    timestamp   : timestamp,",
          "  },",
          "}];",
        ].join('\n'),
      },
    },

    // ── Etape 5 : Branchement prospect ─────────────────────────────────────
    {
      id: 'if-prospect-node', name: N.ifProspect,
      type: 'n8n-nodes-base.if', typeVersion: 2,
      position: [1140, 340],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' },
          combinator: 'and',
          conditions: [{
            id: 'cond-prospect',
            leftValue: '={{ $json.is_prospect }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', name: 'filter.operator.true' },
          }],
        },
        options: {},
      },
    },

    // ── Branche TRUE : Slack Prospect ───────────────────────────────────────
    {
      id: 'slack-prospect-node', name: N.slackProspect,
      type: 'n8n-nodes-base.slack', typeVersion: 2.4,
      position: [1360, 220],
      credentials: { slackOAuth2Api: CRED.slack },
      parameters: {
        authentication: 'oAuth2',
        select: 'channel',
        channelId: {
          __rl: true,
          // TODO : remplacer PROSPECTS_CHANNEL_ID par l'ID reel de #prospects-netroia
          // En attendant : utiliser C0A8SHN845D (#n8n-alerts) comme fallback
          value: SLACK_FALLBACK_CH,
          mode: 'list',
          cachedResultName: 'n8n-alerts',
        },
        messageType: 'block',
        blocksUi: JSON.stringify([
          {
            type: 'header',
            text: { type: 'plain_text', text: 'LEAD TERMINAL — NetroIA', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*Session :*\n{{ $json.session_id }}' },
              { type: 'mrkdwn', text: '*Horodatage :*\n{{ $json.timestamp }}' },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Message prospect :*\n{{ $json.user_input }}' },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Reponse IA :*\n{{ $json.ai_response }}' },
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: 'Source : terminal netroia.tech | A contacter rapidement' },
            ],
          },
        ]),
        otherOptions: {},
      },
    },

    // ── Branche TRUE : Email interne prospect ───────────────────────────────
    {
      id: 'email-prospect-node', name: N.emailProspect,
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [1580, 220],
      credentials: { gmailOAuth2: CRED.gmail },
      parameters: {
        sendTo: 'captain@netroia.com',
        subject: '={{ "[LEAD TERMINAL] Session " + $json.session_id }}',
        emailType: 'text',
        message: [
          "={{ [",
          "  'LEAD DETECTE VIA TERMINAL NETROIA',",
          "  '',",
          "  'Session ID  : ' + $json.session_id,",
          "  'Horodatage  : ' + $json.timestamp,",
          "  '',",
          "  'Message prospect :',",
          "  $json.user_input,",
          "  '',",
          "  'Reponse IA :',",
          "  $json.ai_response,",
          "  '',",
          "  '--- NetroIA Terminal Agent ---',",
          "].join('\\n') }}",
        ].join(''),
        options: {
          senderName: 'NetroIA Terminal',
        },
      },
    },

    // ── Branche TRUE : Reponse webhook ──────────────────────────────────────
    {
      id: 'respond-true-node', name: N.reponseTrue,
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
      position: [1800, 220],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ response: $json.ai_response, session_id: $json.session_id }) }}',
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

    // ── Branche FALSE : Reponse webhook directe ─────────────────────────────
    {
      id: 'respond-false-node', name: N.reponseFalse,
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
      position: [1360, 460],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ response: $json.ai_response, session_id: $json.session_id }) }}',
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

  // ─── Connexions ─────────────────────────────────────────────────────────
  // REGLE : la cle DOIT etre identique au champ `name` du noeud source.
  connections: {
    // Flux principal
    [N.webhook]      : { main: [[{ node: N.validateInput, type: 'main', index: 0 }]] },
    [N.validateInput]: { main: [[{ node: N.agentIA,       type: 'main', index: 0 }]] },
    [N.agentIA]      : { main: [[{ node: N.detectIntent,  type: 'main', index: 0 }]] },
    [N.detectIntent] : { main: [[{ node: N.ifProspect,    type: 'main', index: 0 }]] },

    // IF : index 0 = TRUE → Slack, index 1 = FALSE → Reponse directe
    [N.ifProspect]: {
      main: [
        [{ node: N.slackProspect, type: 'main', index: 0 }],
        [{ node: N.reponseFalse,  type: 'main', index: 0 }],
      ],
    },

    // Branche TRUE
    [N.slackProspect]: { main: [[{ node: N.emailProspect, type: 'main', index: 0 }]] },
    [N.emailProspect]: { main: [[{ node: N.reponseTrue,   type: 'main', index: 0 }]] },

    // Connexion LangChain : OpenAI → Agent IA
    [N.openaiModel]: {
      ai_languageModel: [[{ node: N.agentIA, type: 'ai_languageModel', index: 0 }]],
    },
  },

  settings: {
    executionOrder: 'v1',
    errorWorkflow: DEBBUG_ID,
  },
};

// ─── Validation des connexions ───────────────────────────────────────────────
function validateConnections(wf) {
  const nodeNames = new Set(wf.nodes.map(n => n.name));
  const errors = [];
  for (const [src, conn] of Object.entries(wf.connections)) {
    if (!nodeNames.has(src)) errors.push('Source inconnue : ' + src);
    const allTargets = [
      ...(conn.main || []).flat(),
      ...(conn.ai_languageModel || []).flat(),
      ...(conn.ai_outputParser  || []).flat(),
    ];
    for (const t of allTargets) {
      if (!nodeNames.has(t.node)) errors.push('Cible inconnue : ' + t.node + ' (depuis ' + src + ')');
    }
  }
  if (errors.length > 0) {
    console.error('VALIDATION ECHOUEE :');
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('Validation connexions : OK (' + Object.keys(wf.connections).length + ' sources)');
}

// ─── POST vers n8n API ───────────────────────────────────────────────────────
function apiPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: BASE_URL,
      port: 443,
      path: '/api/v1/workflows',
      method: 'POST',
      headers: {
        'X-N8N-API-KEY'  : API_KEY,
        'Content-Type'   : 'application/json',
        'Content-Length' : Buffer.byteLength(body),
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

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('');
  console.log('=== NetroIA - Agent Terminal IA ===');
  console.log('Workflow : ' + workflow.name);
  console.log('Noeuds   : ' + workflow.nodes.length);
  console.log('');

  validateConnections(workflow);

  // Sauvegarder le payload localement avant envoi
  const outFile = path.join(__dirname, '..', 'workflows', 'internal', 'terminal-agent-v1.json');
  fs.writeFileSync(outFile, JSON.stringify(workflow, null, 2), 'utf8');
  console.log('Payload sauvegarde : ' + outFile);
  console.log('');

  const result = await apiPost({
    name        : workflow.name,
    nodes       : workflow.nodes,
    connections : workflow.connections,
    settings    : workflow.settings,
  });

  if (result.status === 200 || result.status === 201) {
    const wf = result.body;
    console.log('SUCCESS !');
    console.log('  ID n8n  : ' + wf.id);
    console.log('  Nom     : ' + wf.name);
    console.log('  Webhook : https://n8n.netroia.tech/webhook/terminal-agent');
    console.log('  URL     : https://n8n.netroia.tech/workflow/' + wf.id);
    console.log('');
    console.log('ETAPES POST-DEPLOIEMENT :');
    console.log('  1. Activer le workflow dans n8n (bouton Activate)');
    console.log('  2. Creer #prospects-netroia dans Slack + inviter le bot');
    console.log('     → Remplacer SLACK_FALLBACK_CH dans ce script par l\'ID reel');
    console.log('     → Mettre a jour le noeud "' + N.slackProspect + '" dans n8n');
    console.log('  3. Ajouter au VPS n8n : N8N_CORS_ALLOWED_ORIGINS=https://netroia.tech');
    console.log('  4. (Optionnel) Migrer vers Claude 3.5 Sonnet : voir NOTE CLAUDE en tete');
    console.log('  5. Tester :');
    console.log('     curl -X POST https://n8n.netroia.tech/webhook/terminal-agent \\');
    console.log('       -H "Content-Type: application/json" \\');
    console.log('       -d \'{"user_input":"Je veux automatiser ma facturation","session_id":"test-001"}\'');
  } else {
    console.error('ERREUR HTTP ' + result.status);
    console.error(JSON.stringify(result.body, null, 2));
    process.exit(1);
  }
})();
