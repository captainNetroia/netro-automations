# CLAUDE.md — netro-automations

> Fichier projet-spécifique. Complète `C:\Netroia\CLAUDE.md` (global).
> Ne duplique pas les règles globales — ajoute uniquement ce que le global ne peut pas savoir.
> Créé : 2026-04-05 — Session CRM Formulaire Contact

---

## Identité du projet

**Projet** : netro-automations
**Domaine** : n8n / automatisation / workflows IA
**GODs actifs** : `GOD-n8n.md` + `GOD-CreatorWorkflow.md`
**Propriétaire** : Jordan Vincent — captain@netroia.com
**Instance n8n** : https://n8n.netroia.tech (VPS Hostinger, Ubuntu 24.04, n8n 2.19.5)

---

## État actuel (2026-05-07 — mis à jour post-update n8n 2.19.5)

### Workflows déployés sur n8n

| ID | Nom | Statut | Action requise |
|----|-----|--------|----------------|
| `Icz9Mh20mWcZHHQy` | NetroIA - Agent formulaire contact Terminal IA | ✅ Actif | Pipeline complet opérationnel |
| `pafFHP0oemMaFRMt` | Gestion erreurs NetroIA | ✅ Actif | Logger → Google Sheets `Erreurs N8N` validé ✅ |
| `kEWsfjG2pHRSkZq0` | Mail Perso NetroIA (v2) | ⚠️ Inactif | À activer |
| `026FLd5tS2zyoF9O` | Organisation Intelligente des Urgences | ✅ Actif | Error WF = pafFHP0oemMaFRMt (via UI uniquement) |

### Fichiers locaux clés

```
C:\Netroia\netro-automations\
├── CLAUDE.md                          ← Ce fichier
├── catalog.md                         ← Inventaire complet des workflows
├── scripts\
│   ├── create-unified-agent-workflow.js   ← Script de référence actuel (workflow unifié)
│   ├── create-terminal-agent-workflow.js  ← Archive (remplacé par unified)
│   └── create-crm-workflow.js             ← Archive (remplacé par unified)
└── workflows\
    ├── internal\
    │   ├── agent-formulaire-contact-terminal-v1.json  ← Workflow actif (unifié)
    │   ├── crm-formulaire-contact-v2.json             ← Archive (supprimé de n8n)
    │   ├── terminal-agent-v1.json                     ← Archive (supprimé de n8n)
    │   ├── mail-perso-netroia-v2.json
    │   └── mail-perso-netroia-v1.json
    └── templates\
        ├── error-handling\safety-net-v1.json
        └── lead-qualification\normaliseur-leads-v1.json
```

---

## Credentials n8n (IDs vérifiés 2026-04-05)

| Service | ID credential | Nom dans n8n |
|---------|--------------|--------------|
| Gmail (outbound) | `1Bayzmr9ePmWdToL` | captain |
| Gmail (trigger) | `Qnyc8qWHv3LhocKw` | Captain |
| OpenAI | `g1I5vYXiH7nvxbYX` | OpenAi account |
| Slack (Bot Token) | `lHqM2icB8uIKFw8P` | Slack account (slackApi, xoxb-...) |
| Google Sheets | `96DyhZeedQou7Yho` | Google Sheets account |
| Google Docs | `bs5eChjQo4Ti5SrW` | Google Docs captain |

**Slack canaux** :
- `C0B27DFSWEA` = #alertes-erreurs-netroia (privé — bot invité ✅) → Gestion erreurs NetroIA
- `C0B263XRH6Z` = #prospects-netroia (privé — bot invité ✅) → Agent formulaire contact Terminal IA

**Google Sheet CRM** :
- ID : `1MfPCOMGtLsEuOq4AdyE93FTOb58hEthntAHULFLXeKE`
- Feuille : `Feuille 1`
- Headers ligne 1 : `date / name / email / service / type_besoin / budget_estime / urgence / score_lead / resume_besoins / horodatage`

---

## Règles critiques découvertes en session (anti-patterns projet)

### ⛔ RÈGLE 1 — Jamais de curl bash pour créer des workflows n8n sur Windows

**Cause** : Bash Windows (Git Bash/MSYS2) corrompt l'encodage UTF-8 → les accents et emojis deviennent `◆` dans n8n. Les noms de nœuds corrompus brisent les connexions LangChain.

**Solution obligatoire** : Toujours utiliser un script **Node.js** avec `https.request()` natif.
**Script de référence** : `scripts/create-crm-workflow.js`

### ⛔ RÈGLE 2 — Noms de nœuds : ASCII pur uniquement

Les noms de nœuds servent de **clés** dans l'objet `connections`. Toute corruption = connexion muette (le nœud existe mais n'est relié à rien).

```javascript
// BON
const N = { classifierAgent: 'Classifier Demande' };  // ASCII pur

// MAUVAIS
const N = { classifierAgent: 'Classifier Déma nde' };  // accent = risque
```

Utiliser la constante `N` partout (nœud ET connexion) pour garantir la cohérence.

### ⛔ RÈGLE 3 — Toujours valider les connexions après création

```javascript
const nodeNames = new Set(wf.nodes.map(n => n.name));
for (const [src, conn] of Object.entries(wf.connections)) {
  if (!nodeNames.has(src)) throw new Error('Source connexion inconnue : ' + src);
}
```

### ✅ RÈGLE 4 — Connexions LangChain : structure exacte

```javascript
// OpenAI → Agent
[N.openaiNode]: { ai_languageModel: [[{ node: N.agentNode, type: 'ai_languageModel', index: 0 }]] }
// Schema → Agent
[N.schemaNode]: { ai_outputParser:  [[{ node: N.agentNode, type: 'ai_outputParser',  index: 0 }]] }
```

### ✅ RÈGLE 5 — Vérifier doublon avant toute création

```bash
curl -s -H "X-N8N-API-KEY: $KEY" "https://n8n.netroia.tech/api/v1/workflows?limit=50" \
  | grep "NomDuWorkflow"
```

---

## Commandes utiles

```bash
# Lister tous les workflows
curl -s -H "X-N8N-API-KEY: $(grep N8N_API_KEY C:/Netroia/credentials/n8n-api.env | cut -d= -f2)" \
  https://n8n.netroia.tech/api/v1/workflows?limit=50 | grep -o '"id":"[^"]*","name":"[^"]*"'

# Créer un workflow (méthode correcte)
node scripts/create-crm-workflow.js

# Tester le webhook CRM
curl -X POST https://n8n.netroia.tech/webhook/contact-netroia \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test Client\",\"email\":\"captain@netroia.com\",\"service\":\"avance\",\"message\":\"Test automatisation leads IA pour qualification prospects.\",\"source\":\"netroia.tech\"}"
```

---

## Prochaines étapes (roadmap session suivante)

- [ ] Activer CRM Formulaire Contact (`9T3KYNvJs6whJDJW`) + test complet
- [ ] Activer Mail Perso NetroIA v2 (`kEWsfjG2pHRSkZq0`)
- [ ] Inviter bot Slack au canal `#client-netroia` → changer channelId dans les 2 workflows
- [ ] Valider email reçu sur captain@netroia.com après test webhook
- [ ] Valider ligne apparue dans Google Sheet CRM

---

## Questions intelligentes à poser au démarrage de session

- Workflow CRM activé ? Test passé ?
- Canal Slack `#client-netroia` opérationnel ?
- Nouveau workflow à créer ? → Utiliser `scripts/create-crm-workflow.js` comme base
- Credentials à ajouter ? → Vérifier `C:\Netroia\credentials\n8n-api.env` d'abord

---

*Créé : 2026-04-05 | Domaine : n8n / automation | GODs : GOD-n8n.md + GOD-CreatorWorkflow.md*
