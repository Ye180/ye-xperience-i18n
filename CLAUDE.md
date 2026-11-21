# ye-xperience-i18n

CLI npm qui internationalise un projet Next.js (App Router) existant avec next-intl :
extraction des textes JSX, réécriture en `t('cle')`, traduction via une IA (Claude par défaut, ou API compatible OpenAI),
génération de `messages/{locale}.json`. Le projet cible ne dépend PAS de ce package
en production : le résultat est du next-intl standard.

## Commandes de dev

Le dépôt utilise **pnpm** (`packageManager: pnpm@12.15.0`).

- `pnpm test` : tests unitaires vitest (`tests/*.test.ts`, < 1 s)
- `pnpm test:e2e` : test d'intégration (`tests/e2e/`), une fois avec pnpm et une fois avec npm
  (`E2E_PM=pnpm` pour n'en lancer qu'un) : copie de la fixture, `init --yes` avec un faux
  traducteur, vraie installation, `next build`, `next start` (routes /, /fr, /en, /de),
  idempotence init + sync, sync d'un nouveau texte. ~2 min, réseau requis.
- `pnpm typecheck` : `tsc --noEmit`
- `pnpm build` : bundle tsup → `dist/cli.js` (ESM, shebang, exécutable)
- Essai manuel : `cd tests/fixtures/basic && node ../../../dist/cli.js init --dry-run`
- Essai du paquet : `pnpm pack --pack-destination /tmp` puis `pnpm dlx /tmp/ye-xperience-i18n-0.1.0.tgz init`
  dans le projet (ne touche pas son package.json, contrairement à `pnpm link`).
- `pnpm-workspace.yaml` : `allowBuilds: esbuild: false` (script d'esbuild inutile, refusé).

## Commandes du CLI

- `init` : setup complet (langues, next-intl, extraction, traduction)
- `sync` : nouveaux textes et textes modifiés seulement (cache par hash)
- `translate --locale <l>` : retraduit une langue
- Options : `--dry-run`, `-y/--yes`, `--force`, `--ignore <glob>` (répétable), `--provider <nom>`, `--model <id>`
- Env : `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `MISTRAL_API_KEY` /
  `OPENROUTER_API_KEY`, `OPENAI_BASE_URL`, `YE_XPERIENCE_I18N_PROVIDER`, `YE_XPERIENCE_I18N_MODEL`

## Structure

```
src/
  cli.ts          point d'entrée : appelle run(), affiche les UserError
  run.ts          flux complet d'une commande (injectable : Deps.translator pour les tests)
  args.ts         parsing (node:util parseArgs) + texte d'aide
  prompts/        getConfig : questions @clack/prompts ou config enregistrée
  setup/          setupNextIntl : app/[locale], layout, i18n/, proxy, next.config, dépendance, Link
  extract/
    index.ts      extract() : Project ts-morph en mémoire, items, skipped, messages ; usedKeys() (clés orphelines)
    files.ts      listSourceFiles (.tsx/.jsx/.js, hors tests/stories/node_modules), globs --ignore
    keys.ts       slugify, namespaceFromFile, assignKeys
  transform/      transform() : textes → {t('cle')}, déclaration de t, imports next-intl
  translate/
    index.ts      translateAll : cache par hash, lots, retouches manuelles, flatten/unflatten
    claude.ts     createClaudeTranslator : appel API, schéma JSON strict ; SYSTEM, parseResult, validated (partagés)
    providers.ts  PROVIDERS, resolveProvider, createTranslator : APIs compatibles OpenAI via fetch
  utils/
    config.ts     Config, load/save/validate de .ye-xperience-i18n/config.json
    errors.ts     UserError : erreur attendue, affichée sans stack trace
    git.ts        gitState / assertCleanGit (--force pour passer outre)
    project.ts    detectProject : srcDir ('' | 'src'), detectPackageManager, version de Next
    vfs.ts        VirtualFS : écritures en mémoire, list, move (renommages dans le diff), readJson, diff, commit
tests/
  fixtures/basic/ mini site Next.js en français (cas limites inclus)
  e2e/            test d'intégration (E2E=1)
docs/
  ARCHITECTURE.md            fonctionnement détaillé (à tenir à jour avec le code)
  ROADMAP-DOCUMENTATION.md   plan de la doc utilisateur
  ROADMAP-PUBLICATION.md     GitHub, npm (trusted publishing), versions
.github/workflows/
  ci.yml         typecheck + tests (Node 22, 24) + e2e à chaque push/PR
  publish.yml    release GitHub publiée → npm publish (trusted publishing, sans jeton)
```

## Décisions

- **VirtualFS** : toute écriture passe par `VirtualFS`. Rien n'est écrit avant `commit()`.
  `--dry-run` = afficher `diff()` sans commit. Erreur API = pas de commit, donc rien de partiel.
  Refuse les chemins hors racine et les chemins dans `node_modules`, `.next` ou `.git`.
  `list(dir)` voit les fichiers en attente (l'extraction passe par là). `move` garde les octets
  (binaires OK) et s'affiche comme un renommage dans le diff.
- **Config** : `.ye-xperience-i18n/config.json` (sourceLocale, targetLocales, include, ignore, switcher),
  à commiter avec le projet. `init` interactif repose les questions, préremplies avec la config
  enregistrée (sinon avec `<html lang>` du layout et `app`/`components`). `init --yes`, `sync` et
  `translate` exigent une config enregistrée. `--ignore` s'ajoute aux globs enregistrés.
  Le modèle n'est pas enregistré (`--model` ou variable d'env).
- **Flux du CLI** (`run.ts`) : détection → git → config → [init : setupNextIntl] → extraction →
  transformation → traduction → `finish()` (diff coloré en dry-run, sinon commit) → `<pm> install`
  si next-intl a été ajouté (échec → message, les fichiers restent écrits).
- **Gestionnaire de paquets du projet cible** : champ `packageManager` → lockfile du projet ou d'un
  parent jusqu'au dossier qui contient `.git` (monorepo) → `npm_config_user_agent` (pnpm dlx, npx) → npm.
- **pnpm et scripts bloqués** : pnpm ≥ 10 sort en erreur (`ERR_PNPM_IGNORED_BUILDS`) pour
  `@swc/core` et `@parcel/watcher` (dépendances de next-intl) alors que tout est installé. L'outil
  installe avec `--config.strict-dep-builds=false` (pas d'erreur, config du projet intacte), lit
  `pnpm ignored-builds`, puis demande (TTY, sans --yes) refuser / autoriser / plus tard et lance
  `pnpm approve-builds '!x'` ou `pnpm approve-builds x`. Sinon affiche ces commandes. La config pnpm
  n'est modifiée que sur choix explicite du développeur.
  Le setup passe AVANT l'extraction : le layout devient async et reçoit donc getTranslations.
- **Git** : refus si repo sale ou absent, sauf `--force`. `--dry-run` ne vérifie pas git.
- **Parsing** : `node:util` parseArgs, pas de lib CLI.
- **next-intl** (doc lue le 2026-11-17, v4.15) : `proxy.ts` si Next ≥ 16 (sinon `middleware.ts`) ;
  `next/root-params` dans `i18n/request.ts` si Next ≥ 16.3 (sinon `requestLocale`) ;
  `localePrefix: 'always'` ; `i18n/` et `proxy.ts` dans `src/` si le projet en a un.
- **Setup next-intl** (`init` uniquement, idempotent) :
  - `app/*` → `app/[locale]/*` sauf `api/`, favicon.ico, icon, apple-icon, robots, sitemap, manifest,
    global-error, global-not-found. Déjà un `app/[locale]/` → rien. Imports relatifs des fichiers
    déplacés recalculés (`../components` → `../../components`). Dossiers vidés supprimés au commit.
    `.next` présent → avertissement `rm -rf .next` (types de routes périmés dans `.next/dev/types`
    cassent `next build` ; l'outil ne touche jamais `.next`).
  - Layout racine : `async`, `const locale = await getLocale()`, `<html lang={locale}>`,
    `<NextIntlClientProvider>` dans `<body>` (sans props : v4 hérite messages/locale),
    `generateStaticParams` depuis `routing.locales`. Pas de layout racine → UserError.
  - `i18n/routing.ts` créé, ou locales/defaultLocale mis à jour par regex s'il existe.
    `i18n/request.ts`, `i18n/navigation.ts` créés s'ils manquent. Messages : `messages/` à la racine.
  - proxy/middleware existant non next-intl → jamais écrasé, avertissement.
  - next.config (ts/mts/mjs/js/cjs) : `export default X` ou `module.exports = X` → `withNextIntl(X)`.
    Absent → `next.config.mjs` créé.
  - `next-intl@^4.15.1` ajouté à package.json (dépendances triées), installé après commit.
  - `import Link from 'next/link'` → `import { Link } from '<relatif>/i18n/navigation'`
    (liens qui gardent la locale courante).
  - Sélecteur de langue (`config.switcher` : top-right | top-left | bottom-right | bottom-left | none ;
    absent = none pour les anciennes configs) : `components/LocaleSwitcher.tsx` créé (select en
    `position: fixed`, `router.replace(pathname, { locale })`, noms via `Intl.DisplayNames`),
    `aria-label` = « Langue » dans la langue source → extrait et traduit par le flux normal.
    `<LocaleSwitcher />` inséré après `<NextIntlClientProvider>` (sinon `<body>`). Relance avec un
    autre coin → regex sur `position: 'fixed', x: 16, y: 16` (style modifié à la main = inchangé).
  - Metadata non traduite (V2).
- **Traductions dans les composants** : `getTranslations` dans les composants `async`,
  `useTranslations` partout ailleurs (y compris les Server Components synchrones).
- **Clés** : namespace = nom du composant (sinon nom du fichier), clé = slug camelCase
  des premiers mots ; même texte dans le même namespace = même clé ; collision = suffixe 2, 3…
- **Namespace** : `useTranslations('X')`/`getTranslations('X')` déjà présent dans le composant (sync),
  sinon nom du composant, sinon chemin du fichier si le nom est générique (Page, Layout…) ou anonyme :
  app/contact/page.tsx → ContactPage, app/page.tsx → HomePage, app/layout.tsx → RootLayout.
  Deux composants de même nom partagent le namespace (les clés restent uniques).
- **Extraction** : JsxText (règles d'espaces JSX, entités décodées, au moins une lettre, hors
  script/style) + attributs alt/placeholder/title/aria-label en chaîne littérale.
  Texte voisin d'un `{expr}` dynamique → `skipped` (variable, V2). JSX hors composant →
  `skipped` (hors-composant, V2). Les `skipped` sont affichés en avertissement.
  Texte mêlé de balises (`Code promo : <strong>X</strong>`) → une clé par fragment.
- **Transformation** : modifications textuelles calculées sur l'AST d'origine et appliquées de la
  fin vers le début (pas de `replaceWithText` ts-morph, qui réindente). Style du fichier conservé
  (indentation, guillemets d'après le 1er import, points-virgules). Espaces JSX significatifs en
  bord de texte → `{' '}`. `t` déjà utilisé dans le composant → `tI18n`. Traducteur déjà déclaré
  (sync) → réutilisé. Corps-expression `() => <x/>` → bloc. Import ajouté après les imports ou
  la directive `'use client'`, ou fusionné dans un import next-intl existant.
- **Traduction** : modèle par défaut `claude-opus-5-5` (`--model` / `YE_XPERIENCE_I18N_MODEL`),
  `client.beta.messages.create` + `output_config.format` (schéma json_schema : exactement les ids
  du lot, `additionalProperties: false`), effort `medium` sur les modèles de génération 5,
  `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) sur les modèles qui le gèrent.
  Lots de 40, ids `Namespace.cle` (servent de contexte). Réponse revalidée côté client ; 1 nouvel
  essai si invalide. `stop_reason` refusal / max_tokens → UserError. Erreurs SDK → UserError
  lisibles ; sans identifiants → message `ANTHROPIC_API_KEY n’est pas défini`.
- **Fournisseurs** (`providers.ts`, modèles vérifiés le 2026-11-21) : openai `gpt-5-mini`, gemini
  `gemini-flash-latest`, deepseek `deepseek-flash` (+ `thinking: disabled`), mistral `mistral-small-latest`,
  openrouter `openrouter/auto`. Tous via `POST {url}/chat/completions` (fetch, aucune dépendance),
  `response_format: json_object` puis même validation (`parseResult`, 2 essais) que Claude.
  429/5xx → 3 essais. `OPENAI_BASE_URL` → toute API compatible. Choix : `--provider` →
  `YE_XPERIENCE_I18N_PROVIDER` → première clé présente (ordre de PROVIDERS) → anthropic.
  Le fournisseur n'est pas enregistré dans la config (dépend de la machine).
- **Saisie de la clé** (`run.ts` getAi, après getConfig) : clés enregistrées chargées
  (`~/.config/ye-xperience-i18n/keys.json` ou `$XDG_CONFIG_HOME`, mode 600, une variable d'env gagne).
  Aucune clé + TTY + sans --yes → choix de l'IA (si pas de --provider), `p.password`, proposition
  d'enregistrer ; l'enregistrement a lieu après une traduction réussie. Pas de clé demandée en dry-run.
- **Binaires** : `ye-xperience-i18n` et `ye-i18n` (même dist/cli.js).
- **Cache** : `.ye-xperience-i18n/cache.json` = sha256(locale source + texte)[:16] → locale → traduction,
  à commiter. Hash connu → valeur actuelle du fichier cible gardée (retouches manuelles préservées).
  Hash inconnu → traduit. Entrées inutilisées élaguées. `translate --locale` ignore cache et cible.
- **Dry-run** : aucun appel API ; les textes à traduire gardent le texte source dans le diff.
- **Atomicité** : toute erreur de traduction remonte avant `finish()`, donc rien n'est écrit.
- **Clés orphelines** : après transformation, `usedKeys` collecte les `t('…')` littéraux (et
  t.rich/markup/raw/has) des composants avec traducteur. Les clés source non utilisées sont
  signalées en avertissement, jamais supprimées. Namespace avec un `t(variable)` → ignoré.
- **Publication** : `files: ["dist"]` (+ README, package.json) ; `prepublishOnly` = typecheck + test + build.
- **Exclusions** : commentaire contenant `i18n-ignore` → ignore sa ligne et la suivante.
  Globs `ignore` : `**`, `*`, `?` (maison, Node 20) ; un dossier ignoré ignore son contenu.
- **Hors MVP** (V2) : variables/ICU, `t.rich` (texte mêlé de balises), constantes, metadata, sitemap.
- **npm audit** : 9 alertes « high » dues à un ReDoS dans picomatch ≤ 4.0.7 (dépendance de tsup,
  vitest et ts-morph), sans version corrigée. Seul exposé : les globs passés en local. On ignore
  jusqu'à la sortie d'un correctif.

## À faire

- Tester un vrai appel API pour chaque fournisseur (aucune clé dans l'environnement de dev).
- Next < 16.3 : variante requestLocale sans setRequestLocale → pages dynamiques (non testé avec next build).

## Avancement

1. [x] Setup du package (utils, CLI squelette, fixture)
2. [x] Prompts + config
3. [x] Extraction
4. [x] Transformation (+ écriture de messages/{source}.json)
5. [x] Traduction
6. [x] Setup next-intl (+ test d'intégration next build)
7. [x] sync / translate (clés orphelines), README
