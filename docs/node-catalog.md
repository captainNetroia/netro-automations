# node-catalog.md — Nodes validés et configurations types

*Source : GOD-n8n.md — patterns confirmés en production*

---

## Triggers

### Error Trigger
```
Pas de configuration requise.
Donne accès à : $execution.workflow.name, $execution.workflow.id,
$execution.id, $execution.lastNodeExecuted, $execution.error.message
```

### Gmail Trigger
```
Credentials : Gmail OAuth2
Poll : every 10 minutes (prod standard)
Filters : "is:unread" + "has:attachment" (pour AGENT IA Prospection)
```

### Form Trigger
```
Pas de credentials.
Génère une URL publique → à intégrer dans Typeform ou page HTML.
Champs disponibles via : $json.NomDuChamp
```

### Schedule Trigger
```
Mode : "Cron Expression" ou "Interval"
Intervalle minimum recommandé : 15 minutes pour appels API externes
```

---

## Transformation

### Code Node (JavaScript) — Template de base
```javascript
// Mode : "Run Once for All Items"
const items = $input.all();
const result = items.map(item => {
  const data = item.json;

  return {
    json: {
      // transformation ici
    }
  };
});
return result;
```

### Normalisation nom/email (expressions)
```
Nom (capitalize) : ={{ $json.Name.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') }}
Email (lowercase) : ={{ ($json.Email || '').toLowerCase().trim() }}
Timestamp ISO    : ={{ new Date().toISOString() }}
```

---

## AI / LangChain

### LangChain Agent — Configuration type
```
Model : OpenAI Chat Model (gpt-4o-mini — rapide + économique)
Memory : Window Buffer Memory (pour contexte multi-turn)
System Prompt : [Rôle explicite + format de sortie attendu]
```

### Structured Output Parser — Schema minimal lead
```json
{
  "type": "object",
  "properties": {
    "type_lead": { "type": "string", "enum": ["CHAUD", "TIEDE", "FROID"] },
    "score_confiance": { "type": "number", "minimum": 0, "maximum": 100 },
    "resume_besoin": { "type": "string" },
    "sujet_email": { "type": "string" },
    "corps_email_complet": { "type": "string" }
  },
  "required": ["type_lead", "score_confiance", "resume_besoin"]
}
```

---

## Stockage

### Google Sheets — Upsert pattern
```
Operation : "Append or Update"
Matching Column : email (ou tout champ unique)
→ Met à jour si existe, crée sinon
```

### Airtable — Upsert
```
Operation : "Upsert"
Fields to Match On : email (ou recordId)
```

### n8n DataTable — Opérations
```
rowExists   : Vérifie si un enregistrement existe (filtre sur empreinte_erreur)
insert      : Crée un nouvel enregistrement
update      : Met à jour un enregistrement existant (par ID ou filtre)
```

---

## HTTP Request — Patterns

### Appel API avec auth Header
```
Authentication : Predefined Credential Type → [choisir le credential]
Method : GET / POST / PUT
Content-Type : application/json (Body → JSON)
```

### OCR.space (pattern validé)
```
URL : https://api.ocr.space/parse/image
Method : POST
Authentication : Header Auth → "OCR Space API" credential
Body : multipart/form-data
  - file : {{ $binary.data }} (ou URL)
  - language : fre
  - isTable : false
```

---

## Notifications

### Slack — Alert message
```
Credentials : Slack OAuth2
Resource : Message
Channel : #n8n-alerts
Text : [Message structuré avec contexte erreur]
```

### Gmail — Email personnalisé
```
Credentials : Gmail OAuth2 (captain@netroia.com)
To : {{ $json.email }}
Subject : {{ $json.sujet_email }}
Body : HTML → {{ $json.corps_email_complet }}
```
