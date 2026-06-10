/**
 * fix-gmail-notif-captain.js
 * 1. Corrige credential Gmail sur "Envoyer Email Prospect" (ancienne ID supprimée)
 * 2. Ajoute noeud "Notifier Captain Gmail" branché depuis Logger Sheets
 */

const https = require('https');

const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGE5OTU2NC05MWNmLTRlYjQtYjZkOC0wZDU2M2NhODFlNzQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiY2YzNWZjNGUtZWU1Yy00Y2M5LWE1MDEtYjFmMmU3ODMyOTJmIiwiaWF0IjoxNzc1MzkwMDQ5fQ.Ae61Gjr8gsl_U7ElTWuEWT1JQldaOrK3uYvviTaKD4M';
const N8N_HOST   = 'n8n.netroia.tech';
const WF_ID      = 'Icz9Mh20mWcZHHQy';
const CRED_GMAIL = { id: 'UJ0Gbik39H0AqoJ3', name: 'Gmail account' };

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: N8N_HOST, port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
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

const EMAIL_HTML = [
  '<!DOCTYPE html><html><head><meta charset="UTF-8">',
  '<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;}',
  '.c{max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;}',
  '.h{background:#1a0d36;padding:20px 24px;}',
  '.h h1{margin:0;font-size:18px;color:#f4c430;}',
  '.h p{margin:4px 0 0;font-size:12px;color:#aaa;}',
  '.b{padding:24px;}',
  '.badge{display:inline-block;background:#f4c430;color:#1a0d36;font-weight:bold;font-size:10px;padding:2px 8px;border-radius:3px;text-transform:uppercase;margin-bottom:14px;}',
  '.score{font-size:26px;font-weight:bold;color:#1a0d36;background:#fff8e1;border-left:4px solid #f4c430;padding:10px 16px;margin:10px 0;border-radius:0 4px 4px 0;}',
  '.f{border-bottom:1px solid #eee;padding:8px 0;display:flex;justify-content:space-between;}',
  '.l{color:#888;font-size:13px;}',
  '.v{font-weight:bold;font-size:13px;color:#1a0d36;text-align:right;max-width:60%;}',
  '.msg{background:#f9f9f9;border-radius:6px;padding:12px;margin-top:14px;font-size:13px;color:#444;line-height:1.5;}',
  '.ft{background:#f5f5f5;padding:12px 24px;font-size:11px;color:#999;text-align:center;}',
  '</style></head><body>',
  '<div class="c">',
  '<div class="h"><h1>NetroIA — Nouveau Prospect</h1><p>Alerte formulaire contact automatique</p></div>',
  '<div class="b">',
  '<span class="badge">Lead Qualifie</span>',
  '<div class="score">Score : {{ $("Preparer Enrichi").first().json.score_lead }}/10</div>',
  '<div class="f"><span class="l">Nom</span><span class="v">{{ $("Preparer Enrichi").first().json.name }}</span></div>',
  '<div class="f"><span class="l">Email</span><span class="v">{{ $("Preparer Enrichi").first().json.email }}</span></div>',
  '<div class="f"><span class="l">Service</span><span class="v">{{ $("Preparer Enrichi").first().json.service }}</span></div>',
  '<div class="f"><span class="l">Urgence</span><span class="v">{{ $("Preparer Enrichi").first().json.urgence }}</span></div>',
  '<div class="f"><span class="l">Budget</span><span class="v">{{ $("Preparer Enrichi").first().json.budget_estime }}</span></div>',
  '<div class="f"><span class="l">Type besoin</span><span class="v">{{ $("Preparer Enrichi").first().json.type_besoin }}</span></div>',
  '<div class="msg"><strong>Message :</strong><br>{{ $("Preparer Enrichi").first().json.user_input }}</div>',
  '</div>',
  '<div class="ft">NetroIA Automation — netroia.tech</div>',
  '</div></body></html>',
].join('');

async function main() {
  console.log('[1] Recuperation workflow...');
  const get = await apiRequest('GET', '/api/v1/workflows/' + WF_ID);
  if (get.status !== 200) { console.error('GET echoue:', get.status); process.exit(1); }
  const wf = get.body;
  console.log('    Nodes actuels:', wf.nodes.length);

  // FIX 1 : Credential Envoyer Email Prospect
  const emailNode = wf.nodes.find(n => n.name === 'Envoyer Email Prospect');
  const oldId = emailNode && emailNode.credentials && emailNode.credentials.gmailOAuth2 && emailNode.credentials.gmailOAuth2.id;
  if (emailNode) {
    emailNode.credentials = { gmailOAuth2: CRED_GMAIL };
    console.log('[OK] Credential corrigee : ' + oldId + ' -> ' + CRED_GMAIL.id);
  }

  // FIX 2 : Noeud Notifier Captain Gmail
  const slackNode = wf.nodes.find(n => n.name === 'Alerte Slack');
  const notifPos  = [slackNode.position[0], slackNode.position[1] + 220];

  const alreadyExists = wf.nodes.find(n => n.name === 'Notifier Captain Gmail');
  if (!alreadyExists) {
    wf.nodes.push({
      id: 'node-notif-captain-gmail',
      name: 'Notifier Captain Gmail',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.2,
      position: notifPos,
      parameters: {
        sendTo:    'captain@netroia.com',
        subject:   '=🔔 Nouveau prospect — {{ $("Preparer Enrichi").first().json.name }} ({{ $("Preparer Enrichi").first().json.service }})',
        emailType: 'html',
        message:   '=' + EMAIL_HTML,
      },
      credentials: { gmailOAuth2: CRED_GMAIL },
    });
    console.log('[OK] Noeud Notifier Captain Gmail ajoute pos:', notifPos);
  } else {
    console.log('[INFO] Noeud existe deja, mise a jour credential');
    alreadyExists.credentials = { gmailOAuth2: CRED_GMAIL };
  }

  // Connexion Logger Sheets → Notifier Captain Gmail (parallele avec Alerte Slack)
  const loggerConn = wf.connections['Logger Sheets'];
  const alreadyLinked = (loggerConn.main[0] || []).some(t => t.node === 'Notifier Captain Gmail');
  if (!alreadyLinked) {
    loggerConn.main[0] = (loggerConn.main[0] || []).concat([{ node: 'Notifier Captain Gmail', type: 'main', index: 0 }]);
    console.log('[OK] Logger Sheets -> Notifier Captain Gmail connecte');
  }

  // Connexion Notifier Captain Gmail → Reponse Finale
  wf.connections['Notifier Captain Gmail'] = {
    main: [[{ node: 'Reponse Finale', type: 'main', index: 0 }]],
  };

  // PUT
  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1' } };
  console.log('[3] PUT workflow...');
  const put = await apiRequest('PUT', '/api/v1/workflows/' + WF_ID, payload);
  if (put.status !== 200) {
    console.error('PUT echoue HTTP', put.status, JSON.stringify(put.body, null, 2));
    process.exit(1);
  }
  console.log('[OK] PUT — nodes:', put.body.nodes.length, '| active:', put.body.active);
  console.log('\n[DONE] Flux : Logger Sheets -> Alerte Slack + Notifier Captain Gmail -> Reponse Finale');
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
