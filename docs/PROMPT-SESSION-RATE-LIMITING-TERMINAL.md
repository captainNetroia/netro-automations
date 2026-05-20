# Briefing Session Automation — Rate Limiting Terminal Agent (n8n)

> **Projet source** : site-netroia-tech (session 2026-05-20)
> **Contexte** : Protection complémentaire côté serveur — OPTIONNEL
> **Priorité** : BASSE — le localStorage 24h côté client est déjà en place
> **Prérequis** : Workflow `Icz9Mh20mWcZHHQy` actif

---

## Contexte — Ce qui existe déjà

**Côté site (localStorage)** :
- 5 échanges max par navigateur
- Reset automatique après 24h
- Déployé sur netroia.tech — commit `e25faf4`

**Limite** : contournable en navigation privée ou en effaçant le localStorage.

**Ce que ce briefing ajoute** : rate-limiting par IP côté n8n comme filet de sécurité supplémentaire.

---

## Architecture cible

```
POST /webhook/terminal-agent
  { user_input, session_id }
        │
        ▼
  [Valider Input]          ← existant (longueur, sanitize)
        │
        ▼
  [Rate Limit IP]          ← NOUVEAU — à ajouter ici
        │
    ┌───┴───┐
  bloqué  autorisé
    │         │
  HTTP 429  [Agent IA Terminal] → ...suite normale
```

---

## Implémentation — Nœud Code "Rate Limit IP"

### Principe
Utiliser une **Map module-level** dans le Code node n8n (persiste entre executions, repart à zéro au restart n8n).

- Limite : **10 requêtes par IP par heure** (2x la limite client — marge pour l'usage légitime)
- Fenêtre glissante : 1h
- IP extraite des headers du webhook

### Code du nœud

```javascript
// Rate Limit IP — fenetre glissante 1h, max 10 req/IP
// Note : en memoire uniquement, reset au redemarrage n8n

const MAX_REQ   = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1h

// Map persistant entre executions (module-level)
if (!globalThis._terminalRateMap) {
  globalThis._terminalRateMap = new Map();
}
const rateMap = globalThis._terminalRateMap;

// Extraire l'IP depuis les headers du webhook
const headers = $input.item.json.headers || {};
const ip = (
  headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  headers['x-real-ip'] ||
  headers['cf-connecting-ip'] ||   // si Cloudflare un jour
  'unknown'
);

const now = Date.now();

// Nettoyer les entrées expirées (eviter fuite memoire)
for (const [key, entry] of rateMap.entries()) {
  if (now - entry.windowStart > WINDOW_MS * 2) rateMap.delete(key);
}

// Lire ou créer l'entrée pour cette IP
let entry = rateMap.get(ip);
if (!entry || (now - entry.windowStart > WINDOW_MS)) {
  entry = { count: 0, windowStart: now };
}

entry.count++;
rateMap.set(ip, entry);

const remaining = Math.max(0, MAX_REQ - entry.count);
const resetIn   = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 60000); // minutes

if (entry.count > MAX_REQ) {
  return [{
    json: {
      __rate_limited: true,
      ip,
      count: entry.count,
      remaining: 0,
      reset_in_minutes: resetIn,
    }
  }];
}

// Passer les données originales + métadonnées rate limit
const body = $input.item.json.body || $input.item.json;
return [{
  json: {
    ...body,
    __rate_limited: false,
    __ip: ip,
    __remaining: remaining,
  }
}];
```

### Configuration du nœud dans n8n

- **Type** : Code
- **Mode** : Run Once for All Items
- **Nom** : `Rate Limit IP`
- **Position** : Après "Valider Input", avant "Agent IA Terminal"

---

## Nœud IF — Bifurcation bloqué / autorisé

Ajouter un nœud **IF** après "Rate Limit IP" :

```
Condition : {{ $json.__rate_limited }} est true
  → true  : Nœud "Répondre 429"
  → false : Nœud "Agent IA Terminal" (suite normale)
```

---

## Nœud "Répondre 429" — Respond to Webhook

```json
{
  "respondWith": "json",
  "responseBody": "={{ JSON.stringify({ error: 'Trop de requêtes. Réessayez dans ' + $json.reset_in_minutes + ' minutes.', retry_after_minutes: $json.reset_in_minutes }) }}",
  "options": {
    "responseCode": 429,
    "responseHeaders": {
      "entries": [
        { "name": "Access-Control-Allow-Origin", "value": "https://netroia.tech" },
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Retry-After", "value": "={{ ($json.reset_in_minutes * 60).toString() }}" }
      ]
    }
  }
}
```

---

## Mise à jour du code site — Gérer le 429

> ⚠️ Le code site doit gérer la réponse 429 proprement.
> Actuellement il fait `if (!res.ok) throw new Error()` → le catch affiche le message fallback.
> C'est déjà correct — le visiteur voit "Service momentanément indisponible."
> Aucune modification côté site requise.

---

## Connexions à mettre à jour dans le workflow

Flux actuel :
```
Valider Input → Agent IA Terminal
```

Flux après modification :
```
Valider Input → Rate Limit IP → IF rate_limited
                                    ├── true  → Répondre 429
                                    └── false → Agent IA Terminal
```

---

## Test de validation

**Test normal (doit passer)** :
```powershell
Invoke-RestMethod -Uri "https://n8n.netroia.tech/webhook/terminal-agent" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"user_input":"test rate limit normal","session_id":"rl-test-001"}'
# Attendu : { response: "...", session_id: "rl-test-001" }
```

**Test dépassement (envoyer 11 fois en boucle)** :
```powershell
1..11 | ForEach-Object {
  $r = Invoke-RestMethod -Uri "https://n8n.netroia.tech/webhook/terminal-agent" `
    -Method POST -ContentType "application/json" `
    -Body "{`"user_input`":`"test $_ `",`"session_id`":`"rl-test-loop`"}" `
    -StatusCodeVariable sc -SkipHttpErrorCheck
  Write-Host "Req $_ : HTTP $sc — $($r | ConvertTo-Json -Compress)"
}
# Req 1-10 : HTTP 200 avec réponse IA
# Req 11   : HTTP 429 avec message retry
```

---

## Export après modification

Après validation :
```
n8n → Workflow "NetroIA - Agent formulaire contact Terminal IA"
    → Menu "..." → Download → Sauvegarder en :
    C:\Netroia\netro-automations\workflows\internal\agent-formulaire-contact-terminal-v1.json
```

```powershell
cd C:\Netroia\netro-automations
git add workflows\internal\agent-formulaire-contact-terminal-v1.json
git commit -m "feat: rate limiting IP 10req/h sur terminal agent"
```

---

## Points d'attention (ANGLE MORT)

| # | Risque | Mitigation |
|---|--------|-----------|
| 1 | Map perdue au restart n8n | Acceptable — restart rare sur VPS stable |
| 2 | IP `unknown` si headers absents | Tous les navigateurs envoient x-forwarded-for via Nginx |
| 3 | Plusieurs utilisateurs derrière même IP NAT | Limite à 10/h largement suffisante pour un bureau |
| 4 | Fuite mémoire Map | Nettoyage des entrées > 2h dans le code |
| 5 | `globalThis` non disponible | Testé n8n 2.x — disponible. Fallback : `global._terminalRateMap` |

---

## Verdict — Quand implémenter

| Situation | Action |
|-----------|--------|
| Site normal, peu de trafic | ⏸️ Reporter — localStorage suffisant |
| Pic de trafic détecté (campagne, presse) | ✅ Implémenter avant |
| Coût OpenAI > 5€/jour sans explication | 🚨 Implémenter immédiatement |
| Bot détecté dans les logs n8n | 🚨 Implémenter immédiatement |

---

*Généré par session site-netroia-tech — 2026-05-20*
*Complément de : PROMPT-SESSION-TERMINAL-AGENT-ACTIVATION.md*
