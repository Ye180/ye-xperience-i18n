import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { UserError } from '../utils/errors';
import { createClaudeTranslator, SYSTEM, validated } from './claude';
import type { Entry, Translator } from './index';

export interface Provider {
  label: string;
  /** Variable d'environnement qui contient la clé API. */
  env: string;
  model: string;
  /** API compatible OpenAI (chat/completions). Absent : SDK Anthropic. */
  url?: () => string;
  /** Champs propres au fournisseur ajoutés à la requête. */
  body?: Record<string, unknown>;
  keys: string;
}

/** Fournisseurs reconnus, dans l'ordre de détection automatique (première clé trouvée). */
export const PROVIDERS: Record<string, Provider> = {
  anthropic: { label: 'Claude', env: 'ANTHROPIC_API_KEY', model: 'claude-opus-5-5', keys: 'https://platform.claude.com' },
  openai: {
    label: 'OpenAI',
    env: 'OPENAI_API_KEY',
    model: 'gpt-5-mini',
    // OPENAI_BASE_URL : n'importe quelle API compatible (Groq, Ollama, LM Studio, Azure…).
    url: () => process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    keys: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Gemini',
    env: 'GEMINI_API_KEY',
    model: 'gemini-flash-latest',
    url: () => 'https://generativelanguage.googleapis.com/v1beta/openai',
    keys: 'https://aistudio.google.com/apikey',
  },
  deepseek: {
    label: 'DeepSeek',
    env: 'DEEPSEEK_API_KEY',
    model: 'deepseek-flash',
    url: () => 'https://api.deepseek.com',
    body: { thinking: { type: 'disabled' } },
    keys: 'https://platform.deepseek.com/api_keys',
  },
  mistral: {
    label: 'Mistral',
    env: 'MISTRAL_API_KEY',
    model: 'mistral-small-latest',
    url: () => 'https://api.mistral.ai/v1',
    keys: 'https://console.mistral.ai/api-keys',
  },
  openrouter: {
    label: 'OpenRouter',
    env: 'OPENROUTER_API_KEY',
    model: 'openrouter/auto',
    url: () => 'https://openrouter.ai/api/v1',
    keys: 'https://openrouter.ai/keys',
  },
};

/**
 * Choisit le fournisseur : --provider, sinon YE_XPERIENCE_I18N_PROVIDER, sinon la première clé
 * présente dans l'environnement, sinon Claude (dont l'erreur explique comment définir une clé).
 */
export function resolveProvider(name?: string, model?: string, env = process.env): { name: string; label: string; model: string } {
  name ??= env.YE_XPERIENCE_I18N_PROVIDER || Object.keys(PROVIDERS).find((n) => env[PROVIDERS[n].env]) || 'anthropic';
  const provider = PROVIDERS[name];
  if (!provider) throw new UserError(`Fournisseur inconnu : "${name}". Choix : ${Object.keys(PROVIDERS).join(', ')}.`);
  return { name, label: provider.label, model: model ?? provider.model };
}

export const hasKey = (name: string, env = process.env): boolean =>
  Boolean(env[PROVIDERS[name].env] || (name === 'anthropic' && env.ANTHROPIC_AUTH_TOKEN));

/** Clés saisies dans le CLI : sur cette machine, jamais dans le projet. */
export const keysPath = (env = process.env): string =>
  join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ye-xperience-i18n', 'keys.json');

function readKeys(file: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Complète l'environnement avec les clés enregistrées (une variable déjà définie gagne). */
export function loadSavedKeys(env = process.env): void {
  for (const [name, key] of Object.entries(readKeys(keysPath(env)))) {
    const provider = PROVIDERS[name];
    if (provider && typeof key === 'string' && !env[provider.env]) env[provider.env] = key;
  }
}

/** Enregistre la clé, lisible par l'utilisateur seul (600). Renvoie le chemin du fichier. */
export function saveKey(name: string, key: string, env = process.env): string {
  const file = keysPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ ...readKeys(file), [name]: key }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600); // mode n'est appliqué qu'à la création
  return file;
}

export function createTranslator(name: string, model: string, fetcher: typeof fetch = fetch): Translator {
  const provider = PROVIDERS[name];
  if (!hasKey(name)) {
    throw new UserError(
      `${provider.env} n’est pas défini. Crée une clé sur ${provider.keys}, puis relance sans --yes pour la saisir, ou :\n  export ${provider.env}=...`,
    );
  }
  if (!provider.url) return createClaudeTranslator(model);
  const key = process.env[provider.env]!;
  return (entries, from, to) =>
    validated(
      () => request(provider, key, model, entries, from, to, fetcher),
      entries.map((e) => e.id),
      `${provider.label} pour un lot ${from} → ${to}`,
    );
}

async function request(
  provider: Provider,
  key: string,
  model: string,
  entries: Entry[],
  from: string,
  to: string,
  fetcher: typeof fetch,
): Promise<string> {
  const input = Object.fromEntries(entries.map((e) => [e.id, e.text]));
  const body = JSON.stringify({
    model,
    ...provider.body,
    // json_object est accepté par tous ces fournisseurs ; le contenu est revérifié par parseResult.
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Source locale: ${from}\nTarget locale: ${to}\n\n${JSON.stringify(input, null, 2)}` },
    ],
  });

  // ponytail: 3 essais à 2 s / 4 s sur 429 et 5xx ; lire Retry-After si les quotas posent souci.
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetcher(`${provider.url!().replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body,
        signal: AbortSignal.timeout(600_000),
      });
    } catch {
      throw new UserError(`Impossible de joindre l’API ${provider.label} : vérifie ta connexion.`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (!res.ok) throw explain(res.status, await res.text(), provider, model);

    const data = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new UserError(`Réponse tronquée pour un lot ${from} → ${to} : textes trop longs.`);
    if (choice?.finish_reason === 'content_filter') throw new UserError(`${provider.label} a refusé de traduire un lot ${from} → ${to}.`);
    return choice?.message?.content ?? '';
  }
}

function explain(status: number, text: string, provider: Provider, model: string): UserError {
  const detail = text.slice(0, 300);
  if (status === 401 || status === 403) return new UserError(`Clé API refusée par ${provider.label} : vérifie ${provider.env}.`);
  if (status === 404) return new UserError(`Modèle introuvable chez ${provider.label} : ${model}. Corrige --model. (${detail})`);
  if (status === 429) return new UserError(`Limite de débit ou quota ${provider.label} atteint. Attends un peu puis relance.`);
  return new UserError(`Erreur de l’API ${provider.label} (${status}) : ${detail}`);
}
