[README.md](https://github.com/user-attachments/files/34644516/README.md)
# Tournée PAV — Albon

Page de saisie terrain pour l'observatoire des points d'apport volontaire.
Un bouton, une photo, le point identifié par GPS. Aucune installation,
aucun compte : un lien suffit.

## Publier

La page a besoin de **HTTPS** : sans lui, le navigateur refuse la
géolocalisation et le service worker. GitHub Pages et GitLab Pages le
fournissent gratuitement.

### GitHub Pages

```bash
git init -b main && git add . && git commit -m "Page de saisie des tournées PAV"
git remote add origin https://github.com/<compte>/pav-albon.git && git push -u origin main
```

Puis dans le dépôt : **Settings → Pages → Source : Deploy from a branch →
`main` / `/ (root)` → Save**. La page est en ligne une minute plus tard sur
`https://<compte>.github.io/pav-albon/`.

### GitLab Pages

GitLab a besoin d'un fichier de CI. Ajoute `.gitlab-ci.yml` à la racine :

```yaml
pages:
  stage: deploy
  script: [ "mkdir -p public && cp index.html public/" ]
  artifacts:
    paths: [ public ]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

```bash
git init -b main && git add . && git commit -m "Page de saisie des tournées PAV"
git remote add origin https://gitlab.com/<compte>/pav-albon.git && git push -u origin main
```

L'URL s'affiche dans **Deploy → Pages** une fois le pipeline passé.

## Mettre à jour

```bash
git add -A && git commit -m "<ce qui change>" && git push
```

Le déploiement est automatique. Compte une à deux minutes, et un
rafraîchissement forcé sur le téléphone (le navigateur garde la page en cache).

## Avant de la donner à un agent

Deux constantes en haut de `index.html` :

| Constante | Rôle | Tant qu'elle vaut `null` |
|---|---|---|
| `REFERENTIEL_URL` | Vue `v_referentiel` exposée par la base | Le tableau `SITES` codé dans la page sert de référentiel |
| `ENDPOINT` | Webhook n8n qui reçoit photo + position | Les photos s'empilent dans la file locale du téléphone |

Le tableau `SITES` contient les 6 îlots d'Albon avec leurs vraies
coordonnées. **Les comptages de colonnes par flux sont une hypothèse** :
corrige-les sur place, sinon le calcul de couverture sera faux.

## Installer sur le téléphone d'un agent

Ouvrir le lien, puis « Ajouter à l'écran d'accueil ». L'icône se pose comme
une application et la page s'ouvre en plein écran. Rien à installer, rien à
valider sur un store.

## Ce que la page fait sans réseau

Les saisies partent dans une file IndexedDB et sont envoyées au retour du
réseau ou à la prochaine ouverture. Un badge indique combien de photos
attendent. Sur iOS la file ne se vide pas en arrière-plan — il faut rouvrir
la page, ce qui arrive naturellement à la tournée suivante.
