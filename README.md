# ye-xperience-i18n

[![npm](https://img.shields.io/npm/v/ye-xperience-i18n)](https://www.npmjs.com/package/ye-xperience-i18n)
[![CI](https://github.com/Ye180/ye-xperience-i18n/actions/workflows/ci.yml/badge.svg)](https://github.com/Ye180/ye-xperience-i18n/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/ye-xperience-i18n)](LICENSE)

[Français](README.fr.md) · **English**

Internationalize an existing **Next.js (App Router)** project in one command. No manual string extraction.

```bash
npx ye-xperience-i18n init
```

The tool:

1. asks for the source language and the target languages;
2. installs and configures [next-intl](https://next-intl.dev) (routing `/en`, `/fr`…);
3. extracts the text from your JSX;
4. rewrites your code to use `t('key')`;
5. translates the texts with the AI of your choice (Claude, OpenAI, Gemini, DeepSeek, Mistral, OpenRouter…);
6. writes `messages/{locale}.json`.

The result is **plain next-intl**: your project does not depend on `ye-xperience-i18n` in production.

## Quick start

```bash
cd my-next-app
git status                               # must be clean: commit first
npx ye-xperience-i18n init --dry-run     # preview the full diff, writes nothing, no API call
npx ye-xperience-i18n init               # do it
git diff && npm run build                # review
```

Later, after adding or changing texts:

```bash
npx ye-xperience-i18n sync
```

## Install

Nothing to install: run it with your package manager.

| Package manager | Without installing | Global install (short command `ye-i18n`) |
| --- | --- | --- |
| npm | `npx ye-xperience-i18n init` | `npm i -g ye-xperience-i18n` |
| pnpm | `pnpm dlx ye-xperience-i18n init` | `pnpm add -g ye-xperience-i18n` |
| yarn | `yarn dlx ye-xperience-i18n init` (yarn 1: `npx`) | `yarn global add ye-xperience-i18n` (yarn 1) |
| bun | `bunx ye-xperience-i18n init` | `bun add -g ye-xperience-i18n` |

After a global install: `ye-i18n init`, `ye-i18n sync`…

The package manager of your project (pnpm, npm, yarn, bun) is detected automatically: `packageManager` field, lockfile of the project or of the monorepo root, otherwise the tool that launched the command.

## Requirements

- Node.js 20.12 or later
- A Next.js project using the **App Router** (`app/` or `src/app/`) with a root layout `app/layout.tsx`
- A **clean git repo** (everything committed): the tool refuses to modify a project you could not restore with git (unless `--force`)
- An API key for one AI provider. Without a key, the command asks which AI to use and your key, and offers to save it in `~/.config/ye-xperience-i18n/keys.json` (on your machine, never in the project). Environment variables work too:

  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...   # Claude
  # or OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY
  ```

## Commands

| Command | What it does |
| --- | --- |
| `init` | Full setup: languages, next-intl, extraction, rewrite, translation. Safe to run again. |
| `sync` | After adding or changing texts: extracts new ones, translates only what changed. |
| `translate --locale en` | Retranslates one language entirely (ignores the cache and manual edits). |

### Options

| Option | What it does |
| --- | --- |
| `--dry-run` | Shows the diff without writing anything or calling the API |
| `-y`, `--yes` | No questions: reuses the saved config (`init` must have run once) |
| `--force` | Allows a dirty git repo |
| `--ignore <glob>` | Excludes files (repeatable), e.g. `--ignore 'app/admin/**'` |
| `--provider <name>` | Translation AI (see below), also `YE_XPERIENCE_I18N_PROVIDER` |
| `--model <id>` | Model, defaults to the provider's (also `YE_XPERIENCE_I18N_MODEL`) |

## What changes in your code

Before:

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

After:

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

And `messages/en.json`:

```json
{
  "ContactPage": {
    "contactezNous": "Contact us",
    "votreEMail": "Your email"
  }
}
```

In detail:

- **Extracted text**: static JSX text and the `alt`, `placeholder`, `title`, `aria-label` attributes.
- **Keys**: the namespace is the component name (or the route for generic names like `Page`, `Layout`), the key is a short slug of the text. The same text in the same component reuses the same key.
- **Server and Client Components**: `useTranslations` everywhere, `await getTranslations` in `async` components. `"use client"` files work as is.
- **Routing**: `app/*` moves to `app/[locale]/*` (except `api/`, `favicon.ico`, `robots`, `sitemap`, `manifest`…), relative imports fixed (CSS included). `/` redirects to the visitor's language.
- **Root layout**: `<html lang={locale}>`, `NextIntlClientProvider` and `generateStaticParams`.
- **Created files**: `i18n/routing.ts`, `i18n/request.ts`, `i18n/navigation.ts`, `proxy.ts` (`middleware.ts` before Next 16), next-intl plugin in `next.config`.
- **Language switcher** (optional): `init` asks where to put it (any corner, or none). It creates `components/LocaleSwitcher.tsx`, a floating `<select>` that keeps the current page, and adds it to the layout. Its label is translated like the rest. It is your code: restyle it freely.
- **Links**: `import Link from 'next/link'` becomes the `Link` from `i18n/navigation`, which keeps the current language.
- Your formatting (indentation, quotes, semicolons) is preserved.

## Excluding text

A comment containing `i18n-ignore` excludes its line and the next one:

```tsx
{/* i18n-ignore */}
<p>Atelier Lumière</p>

// i18n-ignore
const brand = <b>ACME</b>;
```

To exclude whole files: `--ignore <glob>` (saved in the config).

## Translation

### Choosing the AI

| `--provider` | Key | Default model |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-5-mini` |
| `gemini` | `GEMINI_API_KEY` | `gemini-flash-latest` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-flash` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` |
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` |

Without `--provider`, the tool uses the first key found in this order. Any other OpenAI-compatible service (Groq, Ollama, LM Studio…) works through `openai`:

```bash
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
  npx ye-xperience-i18n sync --provider openai --model llama3.3
```

### How it works

- Texts are sent in batches, with the component name as context. The answer is JSON (strict schema with Claude), validated again by the tool.
- The AI keeps brand names, codes, emails and URLs, and stays short (these are buttons and labels).
- **Cache**: `.ye-xperience-i18n/cache.json` stores each translation by a hash of the source text. `sync` only pays for new or changed texts.
- **Manual edits**: if you fix a translation in `messages/en.json`, it is kept as long as the source text does not change.
- **Cost**: Claude uses `claude-opus-5-5` by default; `--model claude-sonnet-5-5` or `claude-haiku-5-5` are much cheaper. Gemini, DeepSeek and `gpt-5-mini` are cheap too.
- **On error** (missing key, network, quota) nothing is written: just run the command again.

## pnpm: blocked install scripts

pnpm 10+ blocks dependency install scripts until you approve them. next-intl brings two (`@swc/core`, `@parcel/watcher`) that it does not need to work. After installing, the tool asks you to deny them (recommended), allow them, or decide later. With `--yes` it only prints the commands:

```bash
# deny (recommended: nothing to run, everything works)
pnpm approve-builds '!@parcel/watcher' '!@swc/core'
# or allow
pnpm approve-builds @parcel/watcher @swc/core
```

The choice is saved in `pnpm-workspace.yaml` (`allowBuilds`): commit it.

## Files to commit

| File | Role |
| --- | --- |
| `.ye-xperience-i18n/config.json` | Languages, scanned folders, exclusions |
| `.ye-xperience-i18n/cache.json` | Translations already paid for (avoids retranslating) |
| `messages/*.json` | next-intl messages (edit them freely) |

## Known limits (v0.1)

- **Text with variables** (`Hello {name}`, `{count} items`): left as is and listed as a warning. ICU plurals planned.
- **Text mixed with tags** (`Promo code: <strong>X</strong>`): each fragment gets its own key, no `t.rich`.
- **Constants and arrays outside JSX** (`const items = ['Home', …]`): not extracted.
- **`metadata` / `generateMetadata`**: titles and descriptions stay in the source language.
- **Sitemap, `hreflang`**: not generated.
- Text next to any `{…}` expression is skipped to be safe.
- Unused keys are reported, never deleted.
- Several root layouts (route groups each with their own `<html>`): not supported.
- Next.js < 16.3: pages render dynamically (no `setRequestLocale`).
- An existing non next-intl `proxy.ts` / `middleware.ts` is never overwritten: add next-intl to it by hand (the tool tells you).

## Contributing

Issues and pull requests are welcome: [github.com/Ye180/ye-xperience-i18n](https://github.com/Ye180/ye-xperience-i18n/issues).

```bash
pnpm install
pnpm test          # unit tests
pnpm test:e2e      # init on the fixture with pnpm then npm: install, next build, next start (~2 min)
pnpm build         # dist/cli.js
```

Try the package on a local project without touching its `package.json`:

```bash
pnpm build && pnpm pack --pack-destination /tmp
cd ../my-site && pnpm dlx /tmp/ye-xperience-i18n-0.1.0.tgz init --dry-run
```

How it works inside: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (French).

## License

[MIT](LICENSE)
