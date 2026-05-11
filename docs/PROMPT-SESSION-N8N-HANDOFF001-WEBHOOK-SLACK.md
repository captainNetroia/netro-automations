# Prompt — Session netro-automations
# Objectifs : HANDOFF-001 + Webhook GitHub → n8n → Slack

> Utilise ce prompt au démarrage de la session Claude Code dans `C:\Netroia\netro-automations\`
> Deux objectifs prioritaires dans cet ordre.

---

## Prompt à coller en début de session

```
Tu es la session netro-automations — responsable des workflows n8n, CRM, et automatisations NetroIA.

Tu as deux objectifs prioritaires cette session, dans cet ordre :

═══════════════════════════════════════════════════════
OBJECTIF 1 (PRIORITÉ CRITIQUE) — HANDOFF-001
Réparer le formulaire contact netroia.tech
═══════════════════════════════════════════════════════

CONTEXTE (ne pas re-diagnostiquer — déjà confirmé par session coordination) :
- Workflow n8n "NetroIA - CRM Formulaire Contact" prend ~13 secondes pour répondre
- Car le node "Respond to Webhook" est en FIN de pipeline (après GPT + Gmail + Slack + Sheets)
- Le formulaire site a un AbortController timeout de 10 secondes → ERR_ABORTED à 10s
- Résultat : l'utilisateur ne voit jamais le message de succès

FIX À APPLIQUER (architecture cible) :
```
Webhook Contact (POST /webhook/contact-netroia)
  ↓
Extraire & Valider champs
  ↓
Respond to Webhook → 200 OK  ← DÉPLACER ICI (répond immédiatement en <2s)
  ↓ (pipeline asynchrone après la réponse)
Classification IA (gpt-4.1-mini) → urgence, type_besoin, budget
  ↓
Génération email (gpt-4.1) → email_subject + email_body_html
  ↓ [Parallèle]
├── Envoyer Email → captain@netroia.com
├── Alerte Slack → #n8n-alerts
└── Logger Sheets → CRM NetroIA Leads
```

ÉTAPES :
1. Ouvrir le workflow "NetroIA - CRM Formulaire Contact" via l'API n8n
   → Clé API dans C:\Netroia\credentials\n8n-api.env
   → URL n8n : https://n8n.netroia.tech
2. Localiser le node "Respond to Webhook" dans le workflow
3. Le déplacer APRÈS "Extraire & Valider" et AVANT "Classification IA"
4. Configurer : statusCode=200, body={"success":true,"message":"Message recu. Nous vous repondons dans les 24h."}
5. Vérifier que le pipeline IA/Email/Slack/Sheets continue EN ASYNCHRONE après la réponse
6. Sauvegarder et activer le workflow
7. Tester : curl POST → doit répondre en < 3 secondes

VALIDATION HANDOFF-001 :
- curl : réponse 200 en < 3s ✅
- Chrome (netroia.tech) : formulaire → message succès visible ✅
- Email captain@netroia.com reçu ✅
- Slack notif reçue ✅
- Ligne dans Google Sheet CRM ✅

═══════════════════════════════════════════════════════
OBJECTIF 2 — Workflow "GitHub → Notification Slack"
Notifier Slack à chaque push sur les repos NetroIA
═══════════════════════════════════════════════════════

CONTEXTE :
Tous les repos NetroIA ont maintenant un hook Stop Claude Code qui auto-push vers GitHub.
On veut être notifié sur Slack à chaque push automatique ou manuel.

REPOS À SURVEILLER :
- captainNetroia/coordination-netroia
- captainNetroia/site-netroia-tech
- captainNetroia/netro-automations
- captainNetroia/production-netroia (si applicable)

ARCHITECTURE CIBLE :
```
GitHub (push event)
  → Webhook GitHub → n8n webhook trigger
      → Extraire : repo, branch, commit message, auteur, timestamp, URL commit
      → Formater message Slack
      → Envoyer sur Slack #netroia-updates
          "[🔄 GitHub] {repo} — {branch}
           💬 {commit_message}
           👤 {auteur} | ⏰ {timestamp}
           🔗 {url_commit}"
```

ÉTAPES :

**Partie A — Créer le workflow n8n "GitHub Notif Slack"**
1. Créer un nouveau workflow dans n8n : "NetroIA - GitHub Notif Slack"
2. Node 1 : Webhook trigger (méthode POST, path: /webhook/github-push)
   → Récupérer l'URL complète du webhook (ex: https://n8n.netroia.tech/webhook/github-push)
3. Node 2 : Code JS — extraire les données GitHub
   ```javascript
   const payload = $input.first().json.body || $input.first().json;
   return [{
     json: {
       repo: payload.repository?.full_name || 'unknown',
       branch: payload.ref?.replace('refs/heads/', '') || 'unknown',
       commit_msg: payload.head_commit?.message || payload.commits?.[0]?.message || 'no message',
       auteur: payload.pusher?.name || payload.head_commit?.author?.name || 'unknown',
       url: payload.head_commit?.url || payload.compare || '',
       timestamp: new Date().toLocaleString('fr-FR', {timeZone: 'Europe/Paris'})
     }
   }];
   ```
4. Node 3 : Slack — envoyer dans #netroia-updates
   - Credential : credential Slack existant (vérifier quel ID est actif)
   - Message :
   ```
   🔄 *GitHub Push — {{ $json.repo }}*
   📌 Branch : `{{ $json.branch }}`
   💬 {{ $json.commit_msg }}
   👤 {{ $json.auteur }} | ⏰ {{ $json.timestamp }}
   🔗 {{ $json.url }}
   ```
5. Activer le workflow et noter l'URL webhook

**Partie B — Configurer les webhooks GitHub sur chaque repo**
- PAT GitHub dans C:\Netroia\credentials\github-pat.env (scope admin:repo_hook ✅)
- Pour chaque repo, via l'API GitHub :
  ```
  POST https://api.github.com/repos/captainNetroia/{repo}/hooks
  Body: {
    "name": "web",
    "active": true,
    "events": ["push"],
    "config": {
      "url": "https://n8n.netroia.tech/webhook/github-push",
      "content_type": "json",
      "insecure_ssl": "0"
    }
  }
  ```
- Repos : coordination-netroia, site-netroia-tech, netro-automations

**Partie C — Tester et valider**
1. Faire un push de test sur coordination-netroia
2. Vérifier que la notification arrive sur Slack #netroia-updates
3. Documenter l'URL webhook dans C:\Netroia\coordination-netroia\STATUS-BOARD.md

═══════════════════════════════════════════════════════
BOOTSTRAP OBLIGATOIRE avant de commencer
═══════════════════════════════════════════════════════

1. Lire C:\Netroia\netro-automations\CLAUDE.md
2. Lire C:\Netroia\credentials\n8n-api.env → clé API n8n
3. Lire C:\Netroia\credentials\github-pat.env → PAT GitHub
4. Déclarer les 3 états (CERTAIN / INCONNU / ANGLE MORT)
5. Vérifier que le workflow CRM est bien "Published" dans n8n
6. Commencer par OBJECTIF 1, valider complètement, puis OBJECTIF 2
```

---

## Credentials nécessaires

| Service | Fichier | Clé |
|---------|---------|-----|
| n8n API | `C:\Netroia\credentials\n8n-api.env` | `N8N_API_KEY` |
| GitHub PAT | `C:\Netroia\credentials\github-pat.env` | `GITHUB_PAT` |
| Slack | Credential n8n existant | Vérifier ID actif |

## Références

| Fichier | Contenu |
|---------|---------|
| `C:\Netroia\coordination-netroia\HANDOFFS.md` | HANDOFF-001 détail complet |
| `C:\Netroia\coordination-netroia\STATUS-BOARD.md` | État actuel inter-sessions |
| `C:\Netroia\netro-automations\docs\PROMPT-COORDINATION-SITE-N8N.md` | Architecture CRM complète |
| `C:\Netroia\netro-automations\workflows\internal\crm-formulaire-contact-v2.json` | Dernier export workflow |

## Après cette session

Mettre à jour dans la session coordination-netroia :
- STATUS-BOARD.md : marquer HANDOFF-001 comme [LIVRÉ]
- HANDOFFS.md : archiver HANDOFF-001 avec date de clôture
- Ajouter l'URL webhook GitHub dans STATUS-BOARD.md

---

*Créé : 2026-05-07 — Session orchestrateur pour session netro-automations*
