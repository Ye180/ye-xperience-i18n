# ye-xperience-i18n : comment ça marche

Ce document explique **ce que fait l'outil, comment il le fait et pourquoi**. Il sert à comprendre le projet, à le présenter et à y contribuer. Pour l'utiliser, voir le [README](../README.md).

---

## 1. En 30 secondes

> `ye-i18n init` rend multilingue un site Next.js existant en une commande. L'outil trouve les textes écrits en dur dans les composants, les remplace par des appels `t('cle')`, configure next-intl (routes `/fr`, `/en`…), fait traduire les textes par une IA (Claude, OpenAI, Gemini, DeepSeek, Mistral, OpenRouter) et écrit les fichiers `messages/fr.json`, `messages/en.json`… Le résultat est du **next-intl standard** : une fois la commande passée, le site ne dépend plus de l'outil.

Ensuite, `ye-i18n sync` traduit seulement les textes ajoutés ou modifiés, grâce à un cache.

## 2. Principes

| Principe | Comment il est tenu |
| --- | --- |
| **Aucune dépendance en production** | L'outil génère du code next-intl classique. On peut le désinstaller après. |
| **Rien de cassé, rien de partiel** | Toutes les écritures sont préparées en mémoire (VirtualFS) puis écrites d'un coup à la fin. Si l'IA échoue, aucun fichier n'est touché. |
| **Toujours réversible** | L'outil refuse de travailler sur un repo git non propre (sauf `--force`) : `git checkout .` annule tout. |
| **Voir avant de faire** | `--dry-run` affiche le diff complet sans rien écrire ni appeler l'IA. |
| **Relançable** | `init` et `sync` relancés sur un projet déjà traité ne cassent rien et ne dupliquent rien (idempotence). |
| **Ton code reste ton code** | Indentation, guillemets et points-virgules sont conservés. Les fichiers générés (sélecteur de langue…) sont modifiables librement. |
| **Périmètre limité** | L'outil n'écrit jamais dans `node_modules`, `.next` ou `.git`, ni en dehors des dossiers analysés (`app/`, `components/` par défaut). |
| **Clés API protégées** | La clé n'est jamais écrite dans le projet. Elle vient d'une variable d'environnement ou de `~/.config/ye-xperience-i18n/keys.json` (lisible par l'utilisateur seul). |

## 3. Le déroulé d'une commande

Tout part de `src/run.ts`. Voici `init` étape par étape :

```
ye-i18n init
  │
  ├─ 1. Lecture des options ............................. args.ts
  ├─ 2. Détection du projet ............................. utils/project.ts
  │      Next.js présent ? app/ ou src/app/ ? quelle version de Next ?
  │      quel gestionnaire de paquets (pnpm, npm, yarn, bun) ?
  ├─ 3. Vérification git (repo propre) .................. utils/git.ts
  ├─ 4. Questions ....................................... prompts/index.ts
  │      langue source, langues cibles, dossiers, coin du sélecteur
  ├─ 5. Choix de l'IA et de la clé ...................... translate/providers.ts
  │      (question seulement si aucune clé n'est trouvée)
  ├─ 6. Installation de next-intl dans le code .......... setup/index.ts
  │      app/* → app/[locale]/*, layout, i18n/, proxy.ts, next.config,
  │      sélecteur de langue, liens
  ├─ 7. Extraction des textes ........................... extract/
  ├─ 8. Réécriture du code en t('cle') .................. transform/
  ├─ 9. messages/{source}.json .......................... run.ts
  ├─ 10. Traduction par lots + cache .................... translate/
  ├─ 11. Écriture de tout sur le disque (ou diff) ....... utils/vfs.ts
  ├─ 12. Enregistrement de la clé si demandé
  └─ 13. Installation du paquet next-intl ............... run.ts (install)
```

Pour `sync` et `translate`, les étapes 4 et 6 sont sautées : la config enregistrée par `init` est réutilisée.

Les étapes 6 à 10 n'écrivent **rien** sur le disque. Seule l'étape 11 écrit, et seulement si tout a réussi.

## 4. Les modules un par un

### 4.1 Ligne de commande (`src/cli.ts`, `src/args.ts`)

- Deux noms pour la même commande : `ye-i18n` (court) et `ye-xperience-i18n` (nom du paquet npm).
- Lecture des options avec `node:util` `parseArgs`, sans bibliothèque externe.
- Commandes : `init`, `sync`, `translate --locale <l>`.
- Options : `--dry-run`, `-y/--yes`, `--force`, `--ignore <glob>`, `--provider <nom>`, `--model <id>`.
- Les erreurs prévues (`UserError`) s'affichent en une phrase claire, sans trace technique.

### 4.2 Détection du projet (`src/utils/project.ts`)

- Lit `package.json` : il doit contenir `next`, sinon l'outil s'arrête avec un message.
- Trouve `app/` ou `src/app/`.
- Lit la version réelle de Next dans `node_modules/next/package.json`. Elle décide de deux choses :
  - `proxy.ts` (Next ≥ 16) ou `middleware.ts` (Next < 16) ;
  - la façon de lire la langue dans `i18n/request.ts` (`next/root-params` si Next ≥ 16.3).
- Détecte le gestionnaire de paquets, dans cet ordre :
  1. le champ `packageManager` du `package.json` ;
  2. le lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `package-lock.json`), cherché aussi dans les dossiers parents jusqu'à la racine git, pour les monorepos ;
  3. l'outil qui a lancé la commande (`pnpm dlx`, `npx`…) ;
  4. npm par défaut.

### 4.3 Sécurité git (`src/utils/git.ts`)

`git status --porcelain` doit être vide. Sinon l'outil refuse, sauf avec `--force`. But : pouvoir tout annuler avec git. En `--dry-run`, git n'est pas vérifié, puisque rien n'est écrit.

### 4.4 Le système de fichiers virtuel (`src/utils/vfs.ts`)

C'est la pièce qui garantit la sécurité.

- Toute lecture et toute écriture passent par `VirtualFS`. Les écritures restent **en mémoire**.
- `diff()` produit un diff coloré : c'est ce qu'affiche `--dry-run`. Les fichiers déplacés apparaissent comme des renommages.
- `commit()` écrit tout d'un coup. Il supprime aussi les dossiers vidés par les déplacements.
- Les chemins interdits (`node_modules`, `.next`, `.git`, hors du projet) sont refusés.
- Les fichiers binaires (images dans `app/`) sont déplacés sans être abîmés.

### 4.5 Configuration et questions (`src/utils/config.ts`, `src/prompts/`)

`init` pose ses questions avec `@clack/prompts`. Les réponses sont préremplies avec la config déjà enregistrée, ou avec `<html lang>` du layout.

Les réponses sont enregistrées dans `.ye-xperience-i18n/config.json`, à commiter :

```json
{
  "sourceLocale": "fr",
  "targetLocales": ["en", "de"],
  "include": ["app", "components"],
  "ignore": [],
  "switcher": "top-right"
}
```

- `include` : dossiers analysés.
- `ignore` : globs exclus (`--ignore 'app/admin/**'`).
- `switcher` : coin du sélecteur de langue (`top-right`, `top-left`, `bottom-right`, `bottom-left` ou `none`).

`sync`, `translate` et `init --yes` réutilisent ce fichier sans poser de question.

### 4.6 Mise en place de next-intl (`src/setup/index.ts`)

Uniquement pendant `init`. Chaque opération vérifie d'abord si elle a déjà été faite.

1. **Routes par langue** : `app/*` est déplacé dans `app/[locale]/*`. Les imports relatifs sont corrigés (`../components` devient `../../components`). Certains fichiers restent à la racine de `app/` : `api/`, `favicon.ico`, `icon`, `robots`, `sitemap`, `manifest`, `global-error`…
2. **Layout racine** :
   - il devient `async` ;
   - il lit la langue (`await getLocale()`) et pose `<html lang={locale}>` ;
   - il entoure le contenu de `<NextIntlClientProvider>` ;
   - il reçoit `generateStaticParams` (une page générée par langue).
3. **Fichiers next-intl** créés s'ils manquent :
   - `i18n/routing.ts` : liste des langues et langue par défaut ;
   - `i18n/request.ts` : charge `messages/{langue}.json` ;
   - `i18n/navigation.ts` : `Link`, `useRouter`… qui gardent la langue.
4. **`proxy.ts`** (ou `middleware.ts`) : redirige `/` vers la langue du visiteur. Un fichier existant qui ne vient pas de l'outil n'est jamais écrasé ; un avertissement est affiché.
5. **`next.config`** : la config est entourée de `withNextIntl(...)`.
6. **`package.json`** : ajout de `next-intl`.
7. **Liens** : `import Link from 'next/link'` est remplacé par le `Link` de `i18n/navigation`.
8. **Sélecteur de langue** : `components/LocaleSwitcher.tsx` est créé puis ajouté au layout. C'est un `<select>` en `position: fixed` dans le coin choisi. Il affiche le nom de chaque langue dans sa propre langue (« Français », « English », via `Intl.DisplayNames`) et reste sur la même page quand on change de langue. Si on relance `init` avec un autre coin, il est déplacé, sauf si son style a été modifié à la main.
9. **Cache `.next`** : s'il existe, l'outil conseille `rm -rf .next`. Les types de routes générés avant le déplacement feraient échouer `next build`. L'outil ne touche jamais `.next` lui-même.

### 4.7 Extraction des textes (`src/extract/`)

Le code est analysé avec **ts-morph**, une surcouche du compilateur TypeScript.

**Ce qui est extrait :**
- le texte JSX : `<h1>Bienvenue</h1>` ;
- les attributs `alt`, `placeholder`, `title` et `aria-label` écrits en chaîne : `placeholder="Votre e-mail"`.

**Ce qui est laissé de côté, et listé en avertissement :**
- un texte collé à une variable : `Bonjour {name}`, parce que le pluriel ou l'ordre des mots peuvent changer selon la langue (prévu en V2) ;
- du JSX hors d'un composant ;
- le contenu de `<script>` et `<style>`, et les textes sans aucune lettre (`—`, `123`).

**Exclusion manuelle :** un commentaire `// i18n-ignore` ou `{/* i18n-ignore */}` exclut sa ligne et la suivante. Pratique pour un nom de marque.

**Nommage des clés :**
- **Namespace** = nom du composant (`ContactPage`, `Header`). Pour les noms génériques (`Page`, `Layout`…), il vient du chemin du fichier : `app/contact/page.tsx` donne `ContactPage`, `app/page.tsx` donne `HomePage`.
- **Clé** = les 5 premiers mots en camelCase, sans accents : « Contactez-nous » donne `contactezNous`.
- Un même texte dans un même composant réutilise la même clé. Deux textes qui donneraient la même clé reçoivent `2`, `3`…

### 4.8 Réécriture du code (`src/transform/`)

```tsx
// avant
export default function ContactPage() {
  return <h1>Contactez-nous</h1>;
}

// après
import { useTranslations } from 'next-intl';

export default function ContactPage() {
  const t = useTranslations('ContactPage');
  return <h1>{t('contactezNous')}</h1>;
}
```

- Les modifications sont calculées sur l'arbre syntaxique, puis appliquées **comme du texte**, de la fin du fichier vers le début. Ainsi, la mise en forme d'origine n'est jamais réindentée.
- Le style du fichier est détecté et repris : indentation, guillemets simples ou doubles, points-virgules.
- Composant `async` (Server Component) : `const t = await getTranslations('X')`. Sinon : `useTranslations('X')`. Les fichiers `'use client'` marchent tels quels.
- Si une variable `t` existe déjà dans le composant, le traducteur s'appelle `tI18n`.
- Un `t` déjà déclaré (lors d'un `sync`) est réutilisé, pas redéclaré.
- Les espaces significatifs en bord de texte deviennent `{' '}`.
- Les imports sont ajoutés après les imports existants (ou après `'use client'`), ou fusionnés dans un import `next-intl` existant.

### 4.9 Traduction (`src/translate/`)

**Le flux :**
1. Les textes source sont aplatis (`ContactPage.contactezNous` → « Contactez-nous »).
2. Pour chaque langue cible, on cherche dans le **cache** ce qui est déjà traduit.
3. Le reste part vers l'IA **par lots de 40**, avec le nom du composant comme contexte.
4. La réponse doit être un JSON avec **exactement** les mêmes identifiants, chaque valeur non vide. Sinon, un nouvel essai ; au deuxième échec, l'outil s'arrête sans rien écrire.

**Consignes données à l'IA :** garder les noms de marque, codes, e-mails, URL et nombres ; écrire un texte naturel et court (ce sont des boutons et des libellés) ; garder un même registre (tu ou vous) ; respecter la typographie de la langue cible.

**Le cache (`.ye-xperience-i18n/cache.json`, à commiter) :**
- clé = empreinte sha256 de (langue source + texte), puis langue cible, puis traduction ;
- un texte déjà connu n'est pas renvoyé à l'IA, donc `sync` ne paie que le nouveau ;
- une traduction **corrigée à la main** dans `messages/en.json` est conservée tant que le texte source ne change pas ;
- `translate --locale en` ignore le cache et retraduit toute la langue.

**Les IA prises en charge (`providers.ts`) :**

| Fournisseur | Variable | Modèle par défaut | Appel |
| --- | --- | --- | --- |
| Claude | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | SDK Anthropic, schéma JSON strict |
| OpenAI | `OPENAI_API_KEY` | `gpt-5-mini` | `fetch` vers `/chat/completions` |
| Gemini | `GEMINI_API_KEY` | `gemini-flash-latest` | idem (endpoint compatible OpenAI) |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-flash` | idem |
| Mistral | `MISTRAL_API_KEY` | `mistral-small-latest` | idem |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter/auto` | idem |

- Les fournisseurs autres que Claude passent par le même format d'API (« compatible OpenAI ») avec `fetch` : aucune dépendance en plus.
- `OPENAI_BASE_URL` ouvre l'outil à toute autre API compatible : Groq, Ollama en local, LM Studio…
- Choix du fournisseur : `--provider`, sinon `YE_XPERIENCE_I18N_PROVIDER`, sinon la première clé trouvée.
- Aucune clé et terminal interactif : l'outil demande l'IA, puis la clé (saisie masquée), et propose de l'enregistrer dans `~/.config/ye-xperience-i18n/keys.json` (permissions 600). L'enregistrement n'a lieu qu'après une traduction réussie, donc une clé fausse n'est jamais gardée.
- Les erreurs d'API (clé refusée, modèle introuvable, quota, réseau) deviennent des messages clairs. Les erreurs 429 et 5xx sont réessayées.

### 4.10 `sync` et les clés orphelines

`sync` refait extraction, réécriture et traduction, sans la mise en place de next-intl. Les textes déjà transformés (`{t('…')}`) ne sont plus du texte, donc seuls les nouveaux sont extraits.

Après la réécriture, l'outil liste les clés de `messages/{source}.json` que plus aucun `t('…')` n'utilise. Il les **signale sans les supprimer** : c'est au développeur de décider.

### 4.11 Installation du paquet (`install` dans `run.ts`)

Après l'écriture des fichiers, l'outil lance `<gestionnaire> install` pour installer next-intl.

Avec pnpm (≥ 10), deux dépendances de next-intl (`@swc/core`, `@parcel/watcher`) ont des scripts d'installation que pnpm bloque par sécurité :
- l'outil installe avec `--config.strict-dep-builds=false`, pour éviter une erreur rouge sans toucher à la config du projet ;
- il demande ensuite : refuser (conseillé, next-intl n'en a pas besoin), autoriser, ou choisir plus tard ;
- le choix est enregistré par pnpm dans `pnpm-workspace.yaml`.

## 5. Ce que l'outil ajoute au projet

```
mon-site/
├── .ye-xperience-i18n/
│   ├── config.json          langues, dossiers, sélecteur (à commiter)
│   └── cache.json           traductions déjà payées (à commiter)
├── app/
│   └── [locale]/            toutes les pages, déplacées ici
│       └── layout.tsx       async, lang={locale}, NextIntlClientProvider, <LocaleSwitcher />
├── components/
│   └── LocaleSwitcher.tsx   sélecteur de langue (modifiable)
├── i18n/
│   ├── routing.ts           langues
│   ├── request.ts           chargement des messages
│   └── navigation.ts        Link / useRouter qui gardent la langue
├── messages/
│   ├── fr.json              textes source
│   └── en.json              traductions (modifiables à la main)
├── proxy.ts                 redirection / → /fr ou /en
└── next.config.ts           withNextIntl(...)
```

## 6. Organisation du code

```
src/
  cli.ts            point d'entrée
  run.ts            déroulé d'une commande, choix de l'IA, installation
  args.ts           options et aide
  prompts/          questions interactives
  setup/            mise en place de next-intl
  extract/          extraction des textes, clés, fichiers analysés
  transform/        réécriture du code
  translate/
    index.ts        cache, lots, retouches manuelles
    claude.ts       appel à Claude, validation des réponses
    providers.ts    autres IA, choix du fournisseur, clés enregistrées
  utils/            config, git, détection du projet, VirtualFS, erreurs
tests/
  *.test.ts         tests unitaires (70, < 1 s)
  e2e/              test complet : init sur un vrai site, install, next build, next start
  fixtures/basic/   mini site Next.js en français avec les cas limites
```

Dépendances : `ts-morph` (analyse du code), `@clack/prompts` (questions), `@anthropic-ai/sdk` (Claude), `diff` (affichage du dry-run). Le reste vient de Node.js.

## 7. Tests

| Commande | Ce qui est vérifié |
| --- | --- |
| `pnpm test` | 70 tests unitaires : options, détection, VirtualFS, extraction, réécriture (snapshots + code valide), traduction et cache, IA (requêtes simulées), mise en place next-intl, sélecteur, clés enregistrées |
| `pnpm test:e2e` | Copie du site de test, `init --yes` avec un faux traducteur, vraie installation (pnpm et npm), `next build`, `next start`, puis vérification des pages `/`, `/fr`, `/en`, `/de`, de l'idempotence et de `sync` |
| `pnpm typecheck` | TypeScript strict |

## 8. Limites connues (V1) et pistes V2

- Textes avec variables (`Bonjour {name}`) et pluriels : pas encore extraits. V2 : messages ICU.
- Texte mêlé de balises (`Code <strong>X</strong>`) : un morceau par clé. V2 : `t.rich`.
- Constantes hors JSX (`const menu = ['Accueil', …]`) : non extraites.
- `metadata` / `generateMetadata` (titre de l'onglet, SEO) : non traduits. V2.
- Sitemap et balises `hreflang` : non générés. V2.
- Un seul layout racine pris en charge.
- Next.js < 16.3 : pages rendues dynamiquement.
