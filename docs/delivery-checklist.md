# delivery-checklist.md — Procédure de livraison client

*À suivre pour chaque livraison d'un workflow n8n à un client*

---

## Phase 1 — Préparation (chez NetroIA)

### Vérification technique
- [ ] Workflow actif sur n8n.netroia.tech, tests réussis
- [ ] Error Workflow configuré → Debbug
- [ ] Test idempotence réussi (2x même résultat, 0 doublon)
- [ ] Aucun `localhost:*` dans les nodes
- [ ] Aucun credential hardcodé (Code nodes, expressions)
- [ ] Toutes les actions critiques loguées en DataTable

### Export
- [ ] Export JSON via n8n UI (workflow → `...` → `Export`)
- [ ] Nommer : `[domaine]-[fonction]-v{X}.json`
- [ ] Versionner dans `workflows/templates/` ou `internal/`

### Documentation
- [ ] `README-[workflow].md` créé avec :
  - Description (2 lignes max)
  - Prérequis credentials (liste exacte)
  - Instructions d'import
  - Cas d'usage + exemple concret
  - Limitations connues

---

## Phase 2 — Livraison (chez le client)

### Import dans leur n8n
1. Ouvrir leur n8n (self-hosted ou cloud)
2. `+ New workflow` → `...` → `Import from File`
3. Sélectionner le JSON fourni
4. Les nodes apparaissent avec des erreurs de credentials (normal)

### Configuration credentials
Pour chaque credential requis (listés dans README) :
1. `Settings → Credentials → + Add credential`
2. Suivre les instructions du README
3. Re-tester la connexion

### Test et activation
1. Tester chaque section avec "Execute node" individuellement
2. Test end-to-end avec données réelles
3. Vérifier les logs DataTable (si applicable)
4. Configurer `Settings → Error Workflow → [leur Debbug ou Safety Net]`
5. Activer le workflow (toggle en haut à droite)

---

## Phase 3 — Suivi

### Documentation post-livraison
- [ ] Ajouter le client dans `catalog.md` (colonne statut → ✅)
- [ ] Logger dans `Documentation-Projets/netro-automations/logs.md`
- [ ] Documenter les adaptations spécifiques faites pour ce client

### Support
- Durée de support incluse : à définir par contrat
- Canal de support : email captain@netroia.com
- Logs disponibles via n8n DataTable du client

---

## Template README-[workflow].md

```markdown
# [Nom du Workflow] — v{X}

## Description
[2 lignes max]

## Prérequis credentials (à créer dans n8n avant import)

| Credential | Type n8n | Instructions |
|------------|----------|-------------|
| Gmail OAuth2 | Google OAuth2 | [lien vers guide Google OAuth] |
| OpenAI | OpenAI API Key | Créer sur platform.openai.com |
| ... | ... | ... |

## Import
1. `+ New workflow` → `Import from File` → sélectionner ce JSON
2. Reconfigurer les credentials (nodes en rouge)
3. Tester avec "Execute workflow"
4. Activer

## Cas d'usage
[Exemple concret]

## Limitations
- [Rate limits connus]
- [Quotas API]
- [Cas non couverts]
```
