# export-workflow.md — Instructions d'export depuis n8n

---

## Méthode 1 — Export via UI (recommandée)

1. Ouvrir https://n8n.netroia.tech
2. Ouvrir le workflow à exporter
3. Cliquer `...` (menu 3 points en haut à droite)
4. `Export` → `Download`
5. Renommer le fichier : `[domaine]-[fonction]-v{X}.json`
6. Placer dans `workflows/templates/` ou `workflows/internal/`

---

## Méthode 2 — Export via API n8n

### Obtenir la liste des workflows
```
GET https://n8n.netroia.tech/api/v1/workflows
Headers: X-N8N-API-KEY: [clé API n8n]
```

### Exporter un workflow par ID
```
GET https://n8n.netroia.tech/api/v1/workflows/{workflow_id}/export
Headers: X-N8N-API-KEY: [clé API n8n]
```

### Créer la clé API n8n
1. https://n8n.netroia.tech → Settings → API → Create API Key
2. **Ne jamais committer la clé** — stocker dans `.env` local

---

## Après l'export

1. Vérifier l'absence de credentials hardcodés :
   ```
   Grep dans le JSON : "apikey", "password", "secret", "token"
   Si trouvé → corriger dans n8n avant de re-exporter
   ```

2. Mettre à jour `catalog.md` avec la nouvelle version

3. Committer :
   ```
   git add workflows/[dossier]/[fichier]-v{X}.json
   git add catalog.md
   git commit -m "feat(workflows): export [nom] v{X}"
   ```
