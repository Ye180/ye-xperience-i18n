# Changelog

## 0.1.0 — first release

- `init`: sets up next-intl (`app/[locale]`, routing, proxy/middleware, `next.config` plugin), extracts JSX text, rewrites it to `t('key')`, translates with AI and writes `messages/{locale}.json`.
- `sync`: only new or changed texts are translated (hash cache, manual edits kept).
- `translate --locale <l>`: retranslates one language.
- AI providers: Claude (default), OpenAI, Gemini, DeepSeek, Mistral, OpenRouter, any OpenAI-compatible API.
- Optional floating language switcher.
- `--dry-run`, `--yes`, `--force`, `--ignore`, `--provider`, `--model`.
