# catalog.md — Inventaire des workflows netro-automations

*Mis à jour : 2026-04-27 — Workflow unifié Agent formulaire contact Terminal IA créé*

---

## Templates (vendables)

| Workflow | Version | Fichier | Trigger | Credentials requis | Statut |
|----------|---------|---------|---------|-------------------|--------|
| Error Safety Net | v1 | `templates/error-handling/safety-net-v1.json` | Error Trigger | Gmail OAuth2, Slack OAuth2, n8n DataTable | ✅ Actif VPS |
| Error Debbug | v1 | `templates/error-handling/debbug-v1.json` | Error Trigger | Gmail OAuth2, Slack OAuth2, n8n DataTable | ⚠️ À activer |
| Lead Qualifier AI | v1 | `templates/lead-qualification/normaliseur-leads-v1.json` | Form Trigger | OpenAI, Google Sheets, Gmail OAuth2 | 🔧 À paramétrer |
| Content Factory Audio→LinkedIn | v1 | `templates/content-factory/audio-to-linkedin-v1.json` | Manual | Google Drive, OpenAI (Whisper + GPT), Google Docs, LinkedIn | 🔧 À paramétrer |

---

## Internal (usage NetroIA uniquement)

| Workflow | Version | Fichier | Trigger | Credentials requis | Statut |
|----------|---------|---------|---------|-------------------|--------|
| **Agent formulaire contact Terminal IA** | **v1** | `internal/agent-formulaire-contact-terminal-v1.json` | Webhook POST /terminal-agent + /contact-netroia | OpenAI (gpt-4o + gpt-4.1-mini + gpt-4.1), Gmail captain, Slack, Google Sheets | ⚠️ Déployé — **à activer** (ID: `Icz9Mh20mWcZHHQy`) |
| ~~CRM Formulaire Contact~~ | ~~v2~~ | `internal/crm-formulaire-contact-v2.json` | — | — | 📦 **Supprimé** — fusionné dans workflow ci-dessus |
| ~~Agent Terminal IA~~ | ~~v1~~ | `internal/terminal-agent-v1.json` | — | — | 📦 **Supprimé** — fusionné dans workflow ci-dessus |
| Mail Perso NetroIA | v2 | `internal/mail-perso-netroia-v2.json` | Gmail Trigger (5 min) | Gmail Captain, OpenAI, Slack | ⚠️ À activer (ID: kEWsfjG2pHRSkZq0) |
| Agent IA Prospection | v1 | `internal/agent-prospection-v1.json` | Gmail Trigger | Gmail OAuth2, OpenAI, Google Drive, Google Docs, Airtable, OCR.space | ⚠️ En développement (ERR-003) |

---

## Référence

| Workflow | Version | Fichier | Usage |
|----------|---------|---------|-------|
| Palais | v1 | `internal/palais-v1.json` | Archive éducative — patterns n8n |

---

## Légende statuts

| Statut | Signification |
|--------|---------------|
| ✅ Actif VPS | Déployé et actif sur n8n.netroia.tech |
| ⚠️ À activer | Déployé mais inactif — action requise |
| 🔧 À paramétrer | Template prêt — credentials à reconfigurer avant activation |
| 🚧 En développement | En cours — non livrable |
| 📦 Archive | Conservé à titre de référence |

---

## Roadmap templates à créer

| Template | Description | Priorité |
|----------|-------------|----------|
| Webhook → Airtable | Réception webhook + création lead structuré Airtable | Haute |
| Email Scraper → Leads | Extraction leads depuis boîte email + scoring IA | Haute |
| Schedule Report | Rapport hebdomadaire automatique (Sheets → Email) | Moyenne |
| LinkedIn Prospection | Trigger → enrichissement → message personnalisé | Moyenne |
| Onboarding Client | Form → Welcome email + création CRM + onboarding tasks | Haute |
