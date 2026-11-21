# Roadmap : publier ye-xperience-i18n (GitHub + npm, gratuit)

Objectif : n'importe qui peut lancer l'outil gratuitement avec **npm, pnpm, yarn ou bun**.

Bonne nouvelle : **une seule publication sur npm suffit**. pnpm, yarn et bun installent tous depuis le registre npm. Publier un paquet public sur npm est gratuit.

```
Phase 0 Préparer le paquet ─► Phase 1 GitHub ─► Phase 2 1re publication npm
   ─► Phase 3 Automatiser (CI + publication) ─► Phase 4 Faire connaître ─► Phase 5 Maintenir
```

---

## Phase 0 : préparer le paquet (1 h)

### 0.1 Vérifier que le nom est libre

```bash
npm view ye-xperience-i18n
```

- `404 Not Found` : le nom est libre.
- Sinon, choisis un autre nom, ou un nom « scopé » `@ton-pseudo/ye-xperience-i18n`, toujours libre.

### 0.2 Compléter `package.json`

```json
{
  "name": "ye-xperience-i18n",
  "version": "0.1.0",
  "description": "Internationalise un projet Next.js (App Router) en une commande : next-intl, extraction des textes, traduction par IA.",
  "author": "Ton Nom <ton-email-public>",
  "license": "MIT",
  "homepage": "https://github.com/<ton-compte>/ye-xperience-i18n#readme",
  "repository": { "type": "git", "url": "git+https://github.com/<ton-compte>/ye-xperience-i18n.git" },
  "bugs": { "url": "https://github.com/<ton-compte>/ye-xperience-i18n/issues" },
  "keywords": ["nextjs", "next-intl", "i18n", "translation", "cli", "ai", "claude", "openai", "gemini"]
}
```

`repository` est **obligatoire** pour la publication automatique avec provenance (Phase 3).

### 0.3 Ajouter les fichiers de base

| Fichier | Contenu |
| --- | --- |
| `LICENSE` | Texte de la licence MIT avec l'année et ton nom ([modèle](https://choosealicense.com/licenses/mit/)) |
| `CHANGELOG.md` | `## 0.1.0 — première version` + la liste des fonctionnalités |
| `.gitignore` | Déjà présent : `node_modules/`, `dist/`, `.next/`, `*.tgz` |

### 0.4 Vérifier ce qui sera publié

```bash
pnpm typecheck && pnpm test && pnpm build
pnpm pack --dry-run
```

La liste doit contenir **uniquement** `dist/cli.js`, `package.json`, `README.md` et `LICENSE`. Aucune clé, aucun test, aucune fixture.

### 0.5 Tester le paquet comme un vrai utilisateur

```bash
pnpm pack --pack-destination /tmp
npx create-next-app@latest /tmp/demo --yes
cd /tmp/demo && git add -A && git commit -m init
npx /tmp/ye-xperience-i18n-0.1.0.tgz init
```

Recommence avec `pnpm dlx`, `yarn dlx` et `bunx` si tu les as installés.

---

## Phase 1 : mettre le code sur GitHub (30 min)

### 1.1 Créer le dépôt

Sur https://github.com/new :
- nom : `ye-xperience-i18n` ;
- **Public** (nécessaire pour la provenance npm et pour être trouvé) ;
- ne coche ni README, ni licence, ni .gitignore : ils existent déjà.

### 1.2 Premier envoi

```bash
cd ~/Projects/YE/ye-xperience-i18n
git add -A
git status            # vérifie : pas de .env, pas de clé, pas de node_modules
git commit -m "feat: première version de ye-xperience-i18n"
git branch -M main
git remote add origin git@github.com:<ton-compte>/ye-xperience-i18n.git
git push -u origin main
```

### 1.3 Configurer la page du dépôt

- **About** (roue dentée à droite) : description courte et topics `nextjs`, `i18n`, `next-intl`, `translation`, `cli`, `ai`.
- **Settings → Branches** : protège `main` (pull request + CI verte obligatoires).
- **Settings → Security** : active Dependabot alerts et secret scanning.
- **Issues** : ajoute deux modèles, « Bug » (commande lancée, message d'erreur, versions de Next et Node, gestionnaire de paquets) et « Idée ».

---

## Phase 2 : première publication sur npm (30 min)

### 2.1 Créer le compte

1. Inscris-toi sur https://www.npmjs.com/signup.
2. Active la **double authentification** (2FA). npm l'exige pour publier.

### 2.2 Publier

```bash
npm login
pnpm typecheck && pnpm test && pnpm build
npm publish --access public
```

`--access public` n'est obligatoire que pour un nom scopé (`@toi/...`), mais il ne gêne pas.

`prepublishOnly` relance déjà typecheck, tests et build avant chaque publication.

### 2.3 Vérifier

```bash
npm view ye-xperience-i18n
cd /tmp/demo2 && npx ye-xperience-i18n@latest --version
```

Le paquet est visible sur `https://www.npmjs.com/package/ye-xperience-i18n`.

### 2.4 Comment les gens l'utiliseront

| Gestionnaire | Sans installation (conseillé) | Installation globale |
| --- | --- | --- |
| npm | `npx ye-xperience-i18n init` | `npm i -g ye-xperience-i18n` puis `ye-i18n init` |
| pnpm | `pnpm dlx ye-xperience-i18n init` | `pnpm add -g ye-xperience-i18n` puis `ye-i18n init` |
| yarn (v2+) | `yarn dlx ye-xperience-i18n init` | pas de global : utiliser `yarn dlx` |
| yarn (v1) | `npx ye-xperience-i18n init` | `yarn global add ye-xperience-i18n` |
| bun | `bunx ye-xperience-i18n init` | `bun add -g ye-xperience-i18n` puis `ye-i18n init` |

L'outil détecte ensuite tout seul le gestionnaire du projet pour installer next-intl.

---

## Phase 3 : automatiser (1 h)

### 3.1 Intégration continue : tests à chaque push

`.github/workflows/ci.yml` :

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:e2e
```

### 3.2 Publication automatique et sécurisée

Le principe : tu crées une **release GitHub**, et GitHub Actions publie sur npm. Aucun mot de passe ni jeton npm n'est stocké : c'est le « trusted publishing ». npm affiche alors un badge de **provenance**, qui prouve que le paquet vient bien de ton dépôt.

1. Sur npmjs.com, ouvre ton paquet, puis **Settings → Trusted Publisher**, puis **GitHub Actions** :
   - Organization or user : ton compte GitHub ;
   - Repository : `ye-xperience-i18n` ;
   - Workflow filename : `publish.yml`.
2. Crée `.github/workflows/publish.yml` :

```yaml
name: Publish
on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write   # nécessaire au trusted publishing

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      - run: npm install -g npm@latest   # trusted publishing : npm ≥ 11.5
      - run: pnpm install --frozen-lockfile
      - run: npm publish --access public
```

### 3.3 Sortir une nouvelle version

```bash
npm version patch     # 0.1.0 → 0.1.1 (correctif)
npm version minor     # 0.1.0 → 0.2.0 (nouvelle fonctionnalité)
git push --follow-tags
```

Puis, sur GitHub : **Releases → Draft a new release**, choisis le tag (`v0.1.1`), écris les nouveautés et clique **Publish**. Le workflow publie sur npm.

**Règle des versions (semver) :**
- `0.x.y` tant que l'outil évolue beaucoup ;
- `1.0.0` quand la V1 est stable et documentée ;
- ensuite, `2.0.0` pour tout changement qui casse l'usage (option renommée, format de config modifié…).

---

## Phase 4 : faire connaître (en continu)

1. **README en anglais** : le public npm est mondial. Garde la version française dans `README.fr.md`, avec un lien en haut de chaque fichier.
2. **Démo animée** : un GIF du terminal pendant `init`, placé en haut du README (outil : [vhs](https://github.com/charmbracelet/vhs) ou asciinema).
3. **Dépôt d'exemple** `ye-xperience-i18n-example` : une branche `before` (site en français) et une branche `after` (résultat de `init`), avec un déploiement Vercel pour voir `/fr` et `/en` en vrai.
4. **Badges** en haut du README : version npm, téléchargements, CI, licence.
5. **Annonces** : discussions GitHub de next-intl, Reddit r/nextjs, X / Bluesky, dev.to (article « J'ai internationalisé mon site Next.js en une commande »), Product Hunt quand la V1 est stable.

---

## Phase 5 : maintenir

| Quand | Quoi |
| --- | --- |
| Chaque PR | La CI doit être verte |
| Chaque mois | Mettre à jour les dépendances (Dependabot), relancer `pnpm test:e2e` |
| Nouvelle version de Next.js ou next-intl | Relancer le test e2e, adapter `setup/` si besoin |
| Modèles d'IA retirés | Mettre à jour les modèles par défaut dans `src/translate/providers.ts` |
| Chaque version | Mettre à jour `CHANGELOG.md` |

---

## Checklist finale avant la 1re publication

- [ ] Nom libre sur npm
- [ ] `author`, `repository`, `homepage`, `bugs` dans `package.json`, version `0.1.0`
- [ ] `LICENSE` et `CHANGELOG.md`
- [ ] `pnpm pack --dry-run` : uniquement `dist/`, `README.md`, `LICENSE`, `package.json`
- [ ] Testé sur un projet `create-next-app` neuf avec npm et pnpm (et yarn, bun si possible)
- [ ] Testé avec une vraie clé d'au moins une IA
- [ ] Dépôt GitHub public, CI verte
- [ ] Compte npm avec 2FA
- [ ] `npm publish --access public`
- [ ] Trusted publisher configuré pour les versions suivantes
