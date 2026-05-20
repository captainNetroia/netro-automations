# Briefing Session netro-automations — 2026-05-21

> **Émetteur** : session site-netroia-tech (Orchestrateur)
> **Priorité** : CRITIQUE — deux tâches bloquantes, ordre obligatoire
> **Référence** : C:\Netroia\coordination-netroia\HANDOFFS.md

---

## ÉTAT AU DÉMARRAGE (CERTAIN)

| Item | État |
|------|------|
| SSL n8n.netroia.tech | 🔴 Expire 2026-06-07 — **17 jours** |
| SSL netroia.tech | ✅ Renouvelé 2026-08-18 (fait par session site) |
| HANDOFF-001 (Respond to Webhook) | 🔴 OUVERT — bloque le formulaire netroia.tech |
| Workflow unifié | ✅ Actif (`Icz9Mh20mWcZHHQy`) |

---

## TÂCHE 1 — SSL n8n.netroia.tech 🔴 URGENT (17 jours)

### Contexte critique

> ⚠️ `certbot renew --nginx` et `certbot renew --standalone` **échouent tous les deux** sur ce VPS.
> La session site a découvert cela aujourd'hui. Raison : certbot est sur le HOST,
> mais nginx est dans Docker et occupe le port 80. Il faut impérativement utiliser `--webroot`.

### Infra vérifiée (CERTAIN)

```
certbot         : /usr/bin/certbot 2.9.0 — sur le HOST (pas dans Docker)
nginx           : container n8n_nginx — port 80 occupé → standalone IMPOSSIBLE
Volume webroot  : /opt/n8n/compose/nginx/.well-known → /usr/share/nginx/html/.well-known (RW)
n8n.conf        : location /.well-known/acme-challenge/ { root /usr/share/nginx/html; } ✅
renewal actuel  : authenticator = standalone → À MIGRER vers webroot
```

### Commandes exactes (copier-coller)

```bash
# 1. SSH sur le VPS
ssh root@187.124.36.81

# 2. Renouveler via webroot (même volume que netroia.tech — déjà validé)
certbot certonly \
  --webroot \
  -w /opt/n8n/compose/nginx \
  -d n8n.netroia.tech \
  --non-interactive \
  --agree-tos

# 3. Recharger nginx dans le container
docker exec n8n_nginx nginx -s reload

# 4. Vérifier
certbot certificates
curl -sI https://n8n.netroia.tech | head -3
```

### Résultat attendu

```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/n8n.netroia.tech/fullchain.pem
This certificate expires on 2026-08-19.
```

```
HTTP/2 200
server: nginx/1.29.5
```

Le renewal config sera automatiquement mis à jour de `standalone` → `webroot`.
Les futurs `certbot renew` automatiques fonctionneront sans intervention.

### Validation finale SSL

```bash
certbot certificates
# n8n.netroia.tech → VALID: 89 days ✅
```

---

## TÂCHE 2 — HANDOFF-001 : Respond to Webhook avant pipeline IA

### Contexte

**Problème** : Le formulaire contact sur netroia.tech soumet vers
`https://n8n.netroia.tech/webhook/contact-netroia`.

Le workflow n8n prend ~13 secondes (GPT-4.1-mini + GPT-4.1 + Email + Slack + Sheets).
Le formulaire a un `AbortController` timeout de **10 secondes**.
→ 13s > 10s → Chrome abort → catch silencieux → utilisateur ne sait pas si envoyé.

**Fix** : Déplacer le nœud "Réponse HTTP 200" AVANT le pipeline IA.
n8n répond en <2s → pipeline continue en arrière-plan.

### Workflow ciblé

```
Nom : NetroIA - Agent formulaire contact Terminal IA
ID  : Icz9Mh20mWcZHHQy
URL n8n : https://n8n.netroia.tech
```

### Architecture actuelle (BLOQUÉE)

```
Webhook Contact → Extraire & Valider
    → Classifier Demande (GPT-4.1-mini ~3s)
    → Préparer Résultat Classification
    → Générer Email Personnalisé (GPT-4.1 ~5s)
    → Générer Document Mission
    → [Envoyer Email → Alerte Slack → Logger Sheets] (~3s)
    → Réponse HTTP 200   ← ARRIVE TROP TARD (~13s total)
```

### Architecture cible (après fix)

```
Webhook Contact → Extraire & Valider
    → Réponse HTTP 200   ← ICI, IMMÉDIATEMENT (<2s)
    → Classifier Demande (GPT-4.1-mini)
    → Préparer Résultat Classification
    → Générer Email Personnalisé (GPT-4.1)
    → Générer Document Mission
    → [Envoyer Email → Alerte Slack → Logger Sheets]
```

### Étapes dans l'éditeur n8n

1. Ouvrir https://n8n.netroia.tech → workflow `Icz9Mh20mWcZHHQy`
2. Trouver le nœud **"Réponse HTTP 200"** (Respond to Webhook, actuellement en fin de chaîne)
3. **Couper la connexion** entre "Logger Lead Google Sheets" → "Réponse HTTP 200"
4. **Créer une nouvelle connexion** : "Extraire & Valider" → "Réponse HTTP 200"
5. **Créer une connexion** : "Réponse HTTP 200" → "Classifier Demande"
   (n8n continue l'exécution après avoir répondu — c'est le comportement natif)
6. Sauvegarder → vérifier que le workflow reste **Actif**

> **Note importante** : Le nœud terminal agent (`Webhook Terminal`) a sa propre branche
> avec ses propres nœuds "Reponse Prospect" / "Reponse Terminal" — NE PAS les toucher.
> Modifier uniquement la branche **formulaire contact** (`Webhook Contact`).

### Vérification du fix

**Test curl depuis le terminal** (doit répondre en <3s) :

```powershell
# Depuis Windows PowerShell
$start = Get-Date
Invoke-RestMethod -Uri "https://n8n.netroia.tech/webhook/contact-netroia" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"name":"Test Fix","email":"captain@netroia.com","service":"avance","message":"Test HANDOFF-001 timing fix validation","source":"test"}'
$elapsed = (Get-Date) - $start
Write-Host "Temps de reponse : $($elapsed.TotalSeconds)s"
```

**Résultat attendu** :
```json
{ "success": true, "message": "Message reçu. Nous vous répondons dans les 24h." }
Temps de réponse : 1.2s   ← bien en dessous des 10s
```

**Test depuis le navigateur** :
1. Ouvrir https://netroia.tech → section Contact
2. Remplir le formulaire (nom, email, service, message)
3. Cliquer Envoyer
4. Vérifier que le message de succès s'affiche en <3s
5. Vérifier email reçu sur captain@netroia.com dans les 2 minutes
6. Vérifier alerte Slack #prospects-netroia

### Une fois validé — Marquer HANDOFF-001 LIVRÉ

Dans `C:\Netroia\coordination-netroia\HANDOFFS.md` :
```
**Statut** : [LIVRÉ — 2026-05-21]
```

La session site-netroia-tech se chargera du reste (retrait du contournement `ok = res.status > 0`).

---

## TÂCHE 3 (BONUS) — Exporter workflow mis à jour

Après modification du workflow :

```
n8n → Workflow "NetroIA - Agent formulaire contact Terminal IA"
    → Menu "..." → Download → Remplacer :
    C:\Netroia\netro-automations\workflows\internal\agent-formulaire-contact-terminal-v1.json
```

```powershell
cd C:\Netroia\netro-automations
git add workflows\internal\agent-formulaire-contact-terminal-v1.json
git commit -m "fix: Respond to Webhook avant pipeline IA (HANDOFF-001)"
```

---

## Credentials & Infra de référence

```
VPS SSH   : root@187.124.36.81
n8n URL   : https://n8n.netroia.tech
API Key   : C:\Netroia\credentials\n8n-api.env (N8N_API_KEY)
SSH Key   : C:\Netroia\credentials\ssh-vps.env
```

**Credentials n8n (IDs vérifiés 2026-05-07)** :

| Service | ID | Nom |
|---------|----|-----|
| Gmail | `1Bayzmr9ePmWdToL` | captain |
| OpenAI | `g1I5vYXiH7nvxbYX` | OpenAi account |
| Slack | `lHqM2icB8uIKFw8P` | Slack account |
| Google Sheets | `96DyhZeedQou7Yho` | Google Sheets account |

**Canaux Slack** :
- `C0B27DFSWEA` → #alertes-erreurs-netroia
- `C0B263XRH6Z` → #prospects-netroia ✅

---

## Ordre d'exécution

```
[1] SSL n8n.netroia.tech (Tâche 1) ← URGENT, fait en <5min
[2] HANDOFF-001 Respond to Webhook (Tâche 2) ← fix workflow n8n
[3] Test curl timing <3s
[4] Test navigateur formulaire netroia.tech
[5] Marquer HANDOFF-001 [LIVRÉ] dans HANDOFFS.md
[6] Export workflow + commit (Tâche 3)
```

---

## Points d'attention (ANGLE MORT)

| # | Risque | Vérification |
|---|--------|-------------|
| 1 | `certbot renew` sans `--webroot` → échoue (port 80 Docker) | Toujours utiliser `certonly --webroot -w /opt/n8n/compose/nginx` |
| 2 | Modifier la branche terminal par erreur | Ne toucher que la branche Webhook Contact |
| 3 | n8n 2.19.5 — "Respond to Webhook" mid-pipeline = comportement async natif | Testé et documenté, ça fonctionne |
| 4 | Google Sheets SPREADSHEET_ID | `1MfPCOMGtLsEuOq4AdyE93FTOb58hEthntAHULFLXeKE` (déjà configuré) |
| 5 | Slack channel encore sur #n8n-alerts ? | Vérifier → doit être `C0B263XRH6Z` (#prospects-netroia) |

---

*Généré par session site-netroia-tech — 2026-05-21*
*Référence : HANDOFFS.md#HANDOFF-001 + HANDOFF-002*
