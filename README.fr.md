# ye-xperience-i18n

[![npm](https://img.shields.io/npm/v/ye-xperience-i18n)](https://www.npmjs.com/package/ye-xperience-i18n)
[![CI](https://github.com/Ye180/ye-xperience-i18n/actions/workflows/ci.yml/badge.svg)](https://github.com/Ye180/ye-xperience-i18n/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/ye-xperience-i18n)](LICENSE)

**Français** · [English](README.md)

Internationalise un projet **Next.js (App Router)** existant en une commande, sans extraire les textes à la main.

```bash
npx ye-xperience-i18n init
```

## Installation

Rien à installer : lance-le directement avec ton gestionnaire de paquets.

| Gestionnaire | Sans installation | Installation globale (commande courte `ye-i18n`) |
| --- | --- | --- |
| npm | `npx ye-xperience-i18n init` | `npm i -g ye-xperience-i18n` |
| pnpm | `pnpm dlx ye-xperience-i18n init` | `pnpm add -g ye-xperience-i18n` |
| yarn | `yarn dlx ye-xperience-i18n init` (yarn 1 : `npx`) | `yarn global add ye-xperience-i18n` (yarn 1) |
| bun | `bunx ye-xperience-i18n init` | `bun add -g ye-xperience-i18n` |

Après une installation globale : `ye-i18n init`, `ye-i18n sync`…

L'outil :

1. te demande la langue source et les langues cibles ;
2. installe et configure [next-intl](https://next-intl.dev) (routage `/fr`, `/en`…) ;
3. extrait les textes de ton JSX ;
4. réécrit le code pour utiliser `t('cle')` ;
5. traduit les textes avec l'IA de ton choix (Claude, OpenAI, Gemini, DeepSeek, Mistral, OpenRouter…) ;
6. génère `messages/{langue}.json`.

Le résultat est du **next-intl standard** : ton projet ne dépend pas de `ye-xperience-i18n` en production.

## Prérequis

- Node.js 20.12 ou plus récent
- Un projet Next.js qui utilise l'**App Router** (`app/` ou `src/app/`) et un layout racine `app/layout.tsx`
- Un repo **git propre** (tout est commité) : l'outil refuse de modifier un projet qu'on ne pourrait pas restaurer avec git (sauf `--force`)
- Une clé API d'une IA pour la traduction (une seule suffit). Sans clé, la commande te demande quelle IA utiliser puis ta clé, et propose de l'enregistrer dans `~/.config/ye-xperience-i18n/keys.json` (sur ton ordinateur, jamais dans le projet). Tu peux aussi passer par une variable d'environnement :

  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...   # Claude
  # ou OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY
  ```

Une fois installé globalement (`pnpm add -g ye-xperience-i18n`), la commande courte est `ye-i18n` : `ye-i18n init`, `ye-i18n sync`…

## Utilisation

Commence toujours par regarder ce qui serait fait :

```bash
pnpm dlx ye-xperience-i18n init --dry-run
```

Le dry-run affiche le diff complet, n'écrit rien et n'appelle pas l'API : les textes à traduire y apparaissent dans la langue source.

Puis lance pour de bon et relis le résultat :

```bash
pnpm dlx ye-xperience-i18n init
git diff
pnpm build
```

Le gestionnaire de paquets (pnpm, npm, yarn, bun) est détecté automatiquement : champ `packageManager` du `package.json`, lockfile du projet ou de la racine du monorepo, sinon l'outil qui a lancé la commande.

### Commandes

| Commande | Rôle |
| --- | --- |
| `init` | Setup complet : langues, next-intl, extraction, réécriture, traduction. Relançable sans risque. |
| `sync` | Après avoir ajouté ou modifié des textes : extrait les nouveaux, ne traduit que ce qui a changé. |
| `translate --locale en` | Retraduit entièrement une langue (ignore le cache et les retouches). |

### Options

| Option | Rôle |
| --- | --- |
| `--dry-run` | Affiche le diff sans rien écrire ni appeler l'API |
| `-y`, `--yes` | Aucune question : réutilise la config enregistrée (`init` doit avoir été lancé une fois) |
| `--force` | Autorise un repo git non propre |
| `--ignore <glob>` | Exclut des fichiers (répétable), ex. `--ignore 'app/admin/**'` |
| `--provider <nom>` | IA de traduction (voir plus bas), aussi via `YE_XPERIENCE_I18N_PROVIDER` |
| `--model <id>` | Modèle, par défaut celui du fournisseur (aussi via `YE_XPERIENCE_I18N_MODEL`) |

## Ce qui est modifié

Avant :

```tsx
export default function ContactPage() {
  return (
    <form>
      <h1>Contactez-nous</h1>
      <input placeholder="Votre e-mail" />
    </form>
  );
}
```

Après :

```tsx
import { useTranslations } from 'next-intl';

export default function ContactPage() {
  const t = useTranslations('ContactPage');
  return (
    <form>
      <h1>{t('contactezNous')}</h1>
      <input placeholder={t('votreEMail')} />
    </form>
  );
}
```

Et `messages/en.json` :

```json
{
  "ContactPage": {
    "contactezNous": "Contact us",
    "votreEMail": "Your email"
  }
}
```

En détail :

- **Textes extraits** : le texte JSX statique et les attributs `alt`, `placeholder`, `title`, `aria-label`.
- **Clés** : le namespace est le nom du composant (ou le chemin de la page pour `Page`, `Layout`…), la clé est un résumé du texte. Un même texte dans un même composant réutilise la même clé.
- **Server et Client Components** : `useTranslations` partout, `await getTranslations` dans les composants `async`. Les fichiers `"use client"` fonctionnent tels quels.
- **Routage** : `app/*` est déplacé dans `app/[locale]/*` (sauf `api/`, `favicon.ico`, `robots`, `sitemap`, `manifest`…), avec les imports relatifs corrigés. `/` redirige vers la langue du visiteur.
- **Layout racine** : `<html lang={locale}>`, `NextIntlClientProvider` et `generateStaticParams`.
- **Fichiers créés** : `i18n/routing.ts`, `i18n/request.ts`, `i18n/navigation.ts`, `proxy.ts` (`middleware.ts` avant Next 16), plugin next-intl dans `next.config`.
- **Sélecteur de langue** : `init` demande où le placer (en haut ou en bas, à droite ou à gauche, ou aucun). Il crée `components/LocaleSwitcher.tsx`, un `<select>` flottant qui garde la page courante, et l'ajoute au layout. Son libellé est traduit comme le reste. C'est ton code : modifie librement son style. Relancer `init` avec un autre coin le déplace (sauf si tu as changé son style).
- **Liens** : `import Link from 'next/link'` devient le `Link` de `i18n/navigation`, qui garde la langue courante.
- Ta mise en forme (indentation, guillemets, points-virgules) est conservée.

## Exclure un texte

Un commentaire contenant `i18n-ignore` exclut sa ligne et la suivante :

```tsx
{/* i18n-ignore */}
<p>Atelier Lumière</p>

// i18n-ignore
const brand = <b>ACME</b>;
```

Pour exclure des fichiers entiers : `--ignore <glob>` (enregistré dans la config).

## Traduction

### Choisir l'IA

| `--provider` | Clé | Modèle par défaut |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-5-mini` |
| `gemini` | `GEMINI_API_KEY` | `gemini-flash-latest` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-flash` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` |
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` |

Sans `--provider`, l'outil prend la première clé trouvée dans cet ordre. Tout autre service compatible OpenAI (Groq, Ollama, LM Studio…) passe par `openai` :

```bash
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
  pnpm dlx ye-xperience-i18n sync --provider openai --model llama3.3
```

### Fonctionnement

- Les textes partent par lots vers l'IA, avec le nom du composant comme contexte. La réponse est un JSON (schéma imposé avec Claude), revérifié par l'outil.
- L'IA a pour consigne de garder les noms de marque, codes, e-mails et URL, et de rester court (ce sont des boutons et des libellés).
- **Cache** : `.ye-xperience-i18n/cache.json` retient chaque traduction par empreinte du texte source. `sync` ne paie que les textes nouveaux ou modifiés.
- **Retouches manuelles** : si tu corriges une traduction dans `messages/en.json`, elle est conservée tant que le texte source ne change pas.
- **Coût** : avec Claude, `claude-opus-5-5` par défaut ; `--model claude-sonnet-5-5` ou `claude-haiku-5-5` coûtent nettement moins cher. Gemini, DeepSeek et `gpt-5-mini` sont aussi bon marché.
- **En cas d'erreur** (clé absente, réseau, quota), rien n'est écrit : relance simplement la commande.

## pnpm : scripts d'installation bloqués

pnpm (10 et plus) bloque les scripts d'installation des dépendances tant que tu ne les as pas approuvés. next-intl en apporte deux (`@swc/core`, `@parcel/watcher`) dont il n'a pas besoin pour fonctionner. Après l'installation, l'outil te demande de les refuser (conseillé), de les autoriser ou de choisir plus tard. Avec `--yes`, il affiche seulement les commandes ; `pnpm install` reste en erreur tant que tu n'as pas choisi :

```bash
# refuser (conseillé : rien à exécuter, tout fonctionne)
pnpm approve-builds '!@parcel/watcher' '!@swc/core'
# ou autoriser
pnpm approve-builds @parcel/watcher @swc/core
```

Le choix est enregistré dans `pnpm-workspace.yaml` (`allowBuilds`), à commiter.

## Fichiers à commiter

| Fichier | Rôle |
| --- | --- |
| `.ye-xperience-i18n/config.json` | Langues, dossiers analysés, exclusions |
| `.ye-xperience-i18n/cache.json` | Traductions déjà payées (évite de retraduire) |
| `messages/*.json` | Les messages next-intl (tu peux les éditer) |

## Limites connues (V1)

- **Textes avec variables** (`Bonjour {name}`, `{count} articles`) : laissés tels quels et listés en avertissement. Pluriels ICU prévus en V2.
- **Texte mêlé de balises** (`Code promo : <strong>X</strong>`) : chaque morceau devient une clé séparée, sans `t.rich`.
- **Constantes et tableaux hors JSX** (`const items = ['Accueil', …]`) : non extraits.
- **`metadata` / `generateMetadata`** : titres et descriptions restent dans la langue source.
- **Sitemap, `hreflang`** : non générés.
- Un texte à côté de n'importe quelle expression `{…}` est laissé de côté par prudence.
- Les clés qui ne sont plus utilisées sont signalées, pas supprimées.
- Structures à plusieurs layouts racines (route groups avec chacun leur `<html>`) : non gérées.
- Next.js < 16.3 : les pages sont rendues dynamiquement (pas de `setRequestLocale`).
- Un `proxy.ts` / `middleware.ts` existant n'est jamais écrasé : il faut y ajouter next-intl à la main (l'outil le signale).

## Développement

```bash
pnpm install
pnpm test          # tests unitaires
pnpm test:e2e      # init sur la fixture avec pnpm puis npm : install, next build, next start (~2 min)
pnpm build         # dist/cli.js
```

`E2E_PM=pnpm pnpm test:e2e` limite le test d'intégration à un gestionnaire.

Essai local sur un projet, sans modifier son `package.json` :

```bash
pnpm build && pnpm pack --pack-destination /tmp
cd ../mon-site && pnpm dlx /tmp/ye-xperience-i18n-0.1.0.tgz init --dry-run
```

## Documentation

- [Comment ça marche](docs/ARCHITECTURE.md) : fonctionnement détaillé de chaque étape
- [Roadmap de la documentation](docs/ROADMAP-DOCUMENTATION.md)
- [Roadmap de publication](docs/ROADMAP-PUBLICATION.md) : GitHub, npm, versions

## Licence

[MIT](LICENSE)
