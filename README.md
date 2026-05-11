# netro-automations

> Bibliothèque de workflows n8n pour l'automatisation et les systèmes IA agentiques — NetroIA

## Vision

Templates réutilisables + systèmes custom clients. Chaque workflow est conçu pour être robuste, documenté, et livrable.

## Infrastructure

- **n8n** : https://n8n.netroia.tech (v2.11.2, self-hosted)
- **Error workflow** : `Debbug` — à activer sur chaque workflow
- **Référence** : `Production-NetroIA/architecture-GOD/GOD-n8n.md`

## Structure

```
workflows/
  templates/              ← Workflows vendables (paramétrables)
    error-handling/       ← Safety Net + Debbug
    lead-qualification/   ← Normaliseur de Leads
    content-factory/      ← Audio → LinkedIn
  internal/               ← Usage NetroIA uniquement
    agent-prospection-v1.json

docs/
  node-catalog.md         ← Nodes validés + configs types
  delivery-checklist.md   ← Procédure livraison client

scripts/
  export-workflow.md      ← Instructions export via API n8n
```

## Démarrer avec un workflow

### Import dans n8n
1. Ouvrir https://n8n.netroia.tech
2. `+ New workflow` → `...` → `Import from File`
3. Sélectionner le fichier `.json`
4. Reconfigurer les credentials (ils ne se transfèrent pas)
5. Tester → Activer

### Avant toute activation
- [ ] Error Workflow configuré → `Debbug`
- [ ] Credentials configurés dans n8n UI
- [ ] Test idempotence réussi (2 exécutions = même résultat)

## Catalogue

Voir [catalog.md](catalog.md) pour l'inventaire complet.

## Conventions

- Nommage JSON : `[domaine]-[fonction]-v{X}.json`
- Nommage workflow dans n8n : `[Domaine] Verbe Objet`
- Règles complètes : `Production-NetroIA/Rules/agent-n8n-workflows.md`
