/**
 * create-shopify-commande-workflow.js
 * Workflow "NetroIA - Nouvelle Commande -> Notification"
 *
 * Architecture : Shopify Trigger (orders/create) -> Extract Commande (Code) -> Gmail
 * Credential Shopify : "Shopify API netroshop" (shopifyApi) — ID VkJsce89bFspJZ96
 */

const https = require('https');

const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGE5OTU2NC05MWNmLTRlYjQtYjZkOC0wZDU2M2NhODFlNzQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiY2YzNWZjNGUtZWU1Yy00Y2M5LWE1MDEtYjFmMmU3ODMyOTJmIiwiaWF0IjoxNzc1MzkwMDQ5fQ.Ae61Gjr8gsl_U7ElTWuEWT1JQldaOrK3uYvviTaKD4M';
const N8N_HOST = 'n8n.netroia.tech';

const CRED_SHOPIFY = { id: 'pbAx6jpZEfiTHEbf', name: 'Shopify API netroshop' };
const CRED_GMAIL   = { id: 'UJ0Gbik39H0AqoJ3', name: 'Gmail account' };

const N = {
  shopifyTrigger: 'Shopify Trigger Commande',
  extractData:    'Extract Commande',
  sendEmail:      'Email Nouvelle Commande',
};

// Le Shopify Trigger expose le payload directement dans $json (pas de .body)
const CODE_EXTRACT = `
const order = $json;
const lineItem = (order.line_items && order.line_items[0]) ? order.line_items[0] : {};
const customer = order.customer || {};
const shipping = order.shipping_address || {};
const allProducts = (order.line_items || []).map(function(item) {
  return item.name + ' x' + item.quantity;
}).join(', ');

return [{
  json: {
    order_number: order.name || '',
    created_at: order.created_at || '',
    client_nom: ((customer.first_name || '') + ' ' + (customer.last_name || '')).trim(),
    client_email: customer.email || '',
    produit: lineItem.name || '',
    quantite: lineItem.quantity || 0,
    total_price: order.total_price || '',
    currency: order.currency || 'EUR',
    livraison_ville: shipping.city || '',
    livraison_pays: shipping.country || '',
    paiement_statut: order.financial_status || '',
    nb_produits: (order.line_items || []).length,
    all_products: allProducts || lineItem.name || '',
    shopify_order_id: order.id || ''
  }
}];
`.trim();

const emailHtmlParts = [
  '<!DOCTYPE html><html><head>',
  '<meta charset="UTF-8">',
  '<style>',
  'body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;}',
  '.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}',
  '.header{background:#1a0d36;color:#fff;padding:24px;text-align:center;}',
  '.header h1{margin:0;font-size:22px;color:#f4c430;}',
  '.header p{margin:4px 0 0;font-size:13px;color:#ccc;}',
  '.body{padding:24px;}',
  '.badge{display:inline-block;background:#f4c430;color:#1a0d36;font-weight:bold;font-size:11px;padding:3px 8px;border-radius:4px;text-transform:uppercase;margin-bottom:16px;}',
  '.field{border-bottom:1px solid #eee;padding:10px 0;display:flex;justify-content:space-between;align-items:center;}',
  '.field .label{color:#666;font-size:13px;}',
  '.field .value{font-weight:bold;font-size:13px;color:#1a0d36;text-align:right;max-width:60%;}',
  '.highlight{background:#fff8e1;border-left:4px solid #f4c430;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;}',
  '.highlight .total{font-size:24px;font-weight:bold;color:#1a0d36;}',
  '.cta{text-align:center;margin:24px 0;}',
  '.cta a{background:#f4c430;color:#1a0d36;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;}',
  '.footer{background:#f9f9f9;padding:16px;text-align:center;font-size:11px;color:#999;}',
  '</style></head><body>',
  '<div class="container">',
  '<div class="header">',
  '<h1>NetroIA Essentiel</h1>',
  '<p>Nouvelle commande recue !</p>',
  '</div>',
  '<div class="body">',
  '<span class="badge">NetroIA Automation</span>',
  '<div class="highlight">',
  '<div style="font-size:12px;color:#888;margin-bottom:4px;">Total commande</div>',
  '<div class="total">{{ $json.total_price }} {{ $json.currency }}</div>',
  '</div>',
  '<div class="field"><span class="label">Numero commande</span><span class="value">{{ $json.order_number }}</span></div>',
  '<div class="field"><span class="label">Date</span><span class="value">{{ $json.created_at }}</span></div>',
  '<div class="field"><span class="label">Client</span><span class="value">{{ $json.client_nom }}</span></div>',
  '<div class="field"><span class="label">Email client</span><span class="value">{{ $json.client_email }}</span></div>',
  '<div class="field"><span class="label">Produit(s)</span><span class="value">{{ $json.all_products }}</span></div>',
  '<div class="field"><span class="label">Livraison</span><span class="value">{{ $json.livraison_ville }}, {{ $json.livraison_pays }}</span></div>',
  '<div class="field"><span class="label">Paiement</span><span class="value">{{ $json.paiement_statut }}</span></div>',
  '<div class="cta">',
  '<a href="https://www.dsers.com" target="_blank">Commander sur DSers maintenant</a>',
  '</div>',
  '</div>',
  '<div class="footer">Workflow automatique NetroIA &mdash; boutique.netroia.tech</div>',
  '</div>',
  '</body></html>',
];
const EMAIL_HTML = emailHtmlParts.join('');

const workflow = {
  name: 'NetroIA - Nouvelle Commande -> Notification',
  settings: { executionOrder: 'v1' },
  nodes: [
    {
      id: 'node-shopify-trigger',
      name: N.shopifyTrigger,
      type: 'n8n-nodes-base.shopifyTrigger',
      typeVersion: 1,
      position: [100, 300],
      webhookId: 'shopify-ordre-netroshop',
      parameters: {
        topic: 'orders/create',
      },
      credentials: {
        shopifyApi: CRED_SHOPIFY,
      },
    },
    {
      id: 'node-extract-data',
      name: N.extractData,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [380, 300],
      parameters: {
        jsCode: CODE_EXTRACT,
      },
    },
    {
      id: 'node-send-email',
      name: N.sendEmail,
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.2,
      position: [660, 300],
      parameters: {
        sendTo: 'captain@netroia.com',
        subject: "=🛒 Nouvelle commande {{ $json.order_number }} — {{ $json.total_price }}{{ $json.currency }}",
        emailType: 'html',
        message: '=' + EMAIL_HTML,
      },
      credentials: {
        gmailOAuth2: CRED_GMAIL,
      },
    },
  ],
  connections: {
    [N.shopifyTrigger]: {
      main: [[{ node: N.extractData, type: 'main', index: 0 }]],
    },
    [N.extractData]: {
      main: [[{ node: N.sendEmail, type: 'main', index: 0 }]],
    },
  },
};

// Validation connexions
const nodeNames = new Set(workflow.nodes.map(n => n.name));
for (const [src] of Object.entries(workflow.connections)) {
  if (!nodeNames.has(src)) throw new Error('Connexion source inconnue : ' + src);
}
console.log('[OK] Connexions validees:', Object.keys(workflow.connections).join(', '));

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: N8N_HOST,
      port: 443,
      path,
      method,
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('\n=== CREATE SHOPIFY COMMANDE WORKFLOW (TRIGGER NATIF) ===\n');

  // Supprimer doublon si existant
  const list = await apiRequest('GET', '/api/v1/workflows?limit=50');
  const existing = (list.body.data || []).find(w => w.name === workflow.name);
  if (existing) {
    console.log('[1] Doublon trouvé (' + existing.id + ') — suppression...');
    await apiRequest('DELETE', '/api/v1/workflows/' + existing.id);
    console.log('[OK] Supprimé.');
  } else {
    console.log('[1] Aucun doublon.');
  }

  // Créer
  console.log('[2] Création du workflow...');
  const create = await apiRequest('POST', '/api/v1/workflows', workflow);
  if (create.status !== 200 && create.status !== 201) {
    console.error('[ERREUR] HTTP', create.status, JSON.stringify(create.body, null, 2));
    process.exit(1);
  }
  const wfId = create.body.id;
  console.log('[OK] Créé — ID :', wfId);

  // Activer
  console.log('[3] Activation...');
  const act = await apiRequest('POST', '/api/v1/workflows/' + wfId + '/activate');
  if (act.status === 200) {
    console.log('[OK] Workflow actif — active:', act.body.active);
    console.log('     → Le Shopify Trigger a enregistré le webhook sur netroshop-3731 automatiquement');
  } else {
    console.warn('[WARN] Activation HTTP', act.status, ':', JSON.stringify(act.body));
  }

  console.log('\n=== RÉSULTAT ===');
  console.log('Workflow ID :', wfId);
  console.log('Nodes :', workflow.nodes.map(n => n.name).join(' → '));
  console.log('Credential Shopify :', CRED_SHOPIFY.name, '(' + CRED_SHOPIFY.id + ')');
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
