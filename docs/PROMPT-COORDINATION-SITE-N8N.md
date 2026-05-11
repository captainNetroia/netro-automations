# Prompt — Session Coordination n8n ↔ Site netroia.tech

> Utilise ce prompt dans une session Claude Code avec accès MCP n8n
> pour résoudre les défaillances entre le site et l'automatisation CRM.

---

## Contexte — Ce que la session SITE a déjà fait

La session Claude Code du projet `site-netroia-tech` a :

1. **Fixé le formulaire côté site** :
   - Bouton "Envoi en cours..." se réinitialise correctement
   - `ok = res.status > 0` : tout réponse HTTP = succès affiché à l'utilisateur
   - **MAIS** : c'est un contournement. Le vrai fix est que n8n retourne un 200 propre.

2. **Webhook configuré** :
   - URL : `https://n8n.netroia.tech/webhook/contact-netroia`
   - Méthode : POST
   - Payload : `{ name, email, service, message, source, date }`

3. **Workflow n8n existant** : "NetroIA - CRM Formulaire Contact" (Published)
   - ETAPE 1 : Webhook Contact + Extraire Valider
   - ETAPE 2 : Classification IA (OpenAI gpt-4.1-mini)
   - ETAPE 3 : Génération email (OpenAI gpt-4.1)
   - ETAPE 4 : Envoyer Email + Alerte Slack + Logger Sheets + Réponse HTTP

---

## Problèmes à résoudre (priorité haute)

### P1 — Workflow retourne non-200
**Symptôme :** Le formulaire affichait "erreur" alors que n8n recevait bien les données.
**Cause probable :** Un node en ETAPE 4 échoue (credentials Gmail/Slack/Sheets non configurés → n8n retourne 500).
**À faire :**
1. Vérifier les credentials dans chaque node de ETAPE 4
2. S'assurer que le node "Réponse HTTP" (Respond to Webhook) est atteint même si Gmail/Slack échoue
3. Mettre le Respond to Webhook en DÉBUT de la chaîne ETAPE 4 (avant Gmail/Slack) pour répondre 200 immédiatement, puis continuer le traitement en parallèle/asynchrone

### P2 — SPREADSHEET_ID manquant dans Logger Sheets
**Note ETAPE 4 :** "Configurer SPREADSHEET_ID dans le noeud Logger Sheets avant activation"
**À faire :**
1. Créer une Google Sheet "CRM NetroIA - Leads" dans le Google Drive de captain@netroia.com
2. Récupérer l'ID de la sheet (dans l'URL)
3. Configurer le node Logger Sheets avec cet ID

### P3 — Credentials à vérifier
Vérifier que ces credentials sont actifs dans n8n :
- Gmail OAuth : `captain@netroia.com` (credential `1BayzmrSePmW6ToL` selon les notes)
- Slack : workspace account (credential `HQ7TA73VWnS3QPIQs`)
- Google Sheets : `96DyhZaedQou7Yho`
- OpenAI : actif et avec solde suffisant

---

## Architecture cible — Workflow robuste

```
Webhook Contact (POST /webhook/contact-netroia)
  ↓
Extraire & Valider champs (name, email, service, message)
  ↓
Respond to Webhook → 200 OK ← METTRE ICI (répond immédiatement au site)
  ↓ (traitement asynchrone après la réponse)
Classification IA (gpt-4.1-mini) → urgence, type_besoin, budget_estime
  ↓
Génération Email personnalisé (gpt-4.1) → email_subject + email_body_html
  ↓
[Parallèle]
├── Envoyer Email → captain@netroia.com + BCC prospect
├── Alerte Slack → #n8n-alerts avec score et résumé
└── Logger Sheets → append ligne dans CRM NetroIA Leads
```

---

## GitHub n8n — À créer cette session

Créer un repo GitHub propre pour `netro-automations` :

**Repo** : `captainNetroia/netro-automations`

**Structure recommandée** :
```
netro-automations/
├── README.md                    ← Vue d'ensemble + badges
├── catalog.md                   ← Index de tous les workflows
├── .gitignore                   ← Exclure credentials, .env
├── workflows/
│   ├── internal/                ← Workflows internes NetroIA
│   │   ├── crm-formulaire-contact.json
│   │   ├── mail-perso-netroia.json
│   │   └── agent-prospection.json
│   └── templates/               ← Templates réutilisables clients
│       ├── lead-qualification/
│       ├── content-factory/
│       └── error-handling/
├── docs/
│   ├── PROMPT-SESSION-AGENT-CRM-N8N.md
│   ├── PROMPT-COORDINATION-SITE-N8N.md
│   ├── delivery-checklist.md
│   └── node-catalog.md
└── scripts/
    └── export-workflow.md       ← Guide export/import workflows n8n
```

**Workflow d'export depuis n8n :**
1. Dans n8n : Menu "..." du workflow → "Download" → `.json`
2. Placer dans `workflows/internal/[nom-workflow].json`
3. Commit + push

---

## Infos credentials n8n

```
URL n8n     : https://n8n.netroia.tech
Email admin : captain@netroia.com
```

**À demander à l'utilisateur au démarrage de session :**
- [ ] Clé API n8n (vérifier `C:\Netroia\credentials\n8n-api.env`)
- [ ] Confirmation que OpenAI API key est active
- [ ] ID de la Google Sheet à créer pour le CRM

---

## Contrat de collaboration sessions

La **session SITE** (projet `site-netroia-tech`) gère :
- HTML/CSS/JS du site
- Déploiement VPS via `deploy.ps1`
- GitHub `captainNetroia/site-netroia-tech`

La **session N8N** (projet `netro-automations`) gère :
- Workflows n8n
- Credentials et connexions
- GitHub `captainNetroia/netro-automations`
- Documentation `C:\Netroia\Production-NetroIA\Documentation-Projets\`

**Point de synchronisation** : Ce fichier + `logs.md` site + `catalog.md` netro-automations.

---

*Créé : 2026-05-06 — Session site-netroia-tech*
