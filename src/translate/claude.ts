import Anthropic from '@anthropic-ai/sdk';
import { UserError } from '../utils/errors';
import type { Entry, Translator } from './index';

/** Modèles qui acceptent le repli serveur `fallbacks: "default"` en cas de refus. */
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
/** Génération 5 : accepte output_config.effort. */
const EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable|mythos)-5/;

export const SYSTEM = `You are a professional localizer translating the user interface of a website built with Next.js.

The user sends a source locale, a target locale (BCP 47 codes) and a JSON object whose keys are "<Component>.<key>" identifiers and whose values are the texts to translate.

Rules:
- Return a JSON object with exactly the same keys, each mapped to the translation of its value. Never translate or change the keys: the component name is context only.
- Keep brand names, product names, people's names, email addresses, URLs, codes (such as promo codes) and numbers unchanged.
- Write natural, idiomatic UI copy for native speakers rather than a word-for-word rendering. Keep each text about as short as its source: these strings appear in buttons, labels, menus, placeholders and headings.
- Keep one consistent register (formal or informal address) and consistent terminology across all texts.
- Follow the target language's typography (for example, no space before ":" in English). Keep the source's final punctuation unless the target language requires otherwise.`;

type Client = Pick<Anthropic, 'beta'>;

/** Traducteur basé sur l'API Claude. Le client est injectable pour les tests. */
export function createClaudeTranslator(model: string, client: Client = new Anthropic()): Translator {
  return (entries, from, to) =>
    validated(() => request(client, model, entries, from, to), entries.map((e) => e.id), `Claude pour un lot ${from} → ${to}`);
}

/** Appelle request jusqu'à obtenir une réponse valide (2 essais). Partagé par tous les fournisseurs. */
export async function validated(request: () => Promise<string>, ids: string[], what: string): Promise<Record<string, string>> {
  for (let attempt = 1; ; attempt++) {
    const result = parseResult(await request(), ids);
    if (result) return result;
    if (attempt === 2) throw new UserError(`Réponse invalide de ${what} (après 2 essais). Relance la commande.`);
  }
}

async function request(client: Client, model: string, entries: Entry[], from: string, to: string): Promise<string> {
  const ids = entries.map((e) => e.id);
  const input = Object.fromEntries(entries.map((e) => [e.id, e.text]));
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      output_config: {
        ...(EFFORT_MODELS.test(model) ? { effort: 'medium' as const } : {}),
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: Object.fromEntries(ids.map((id) => [id, { type: 'string' }])),
            required: ids,
            additionalProperties: false,
          },
        },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Source locale: ${from}\nTarget locale: ${to}\n\n${JSON.stringify(input, null, 2)}`,
        },
      ],
    });
  } catch (err) {
    throw explain(err, model);
  }

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category;
    throw new UserError(`Claude a refusé de traduire un lot ${from} → ${to}${category ? ` (${category})` : ''}.`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new UserError(`Réponse tronquée pour un lot ${from} → ${to} : textes trop longs.`);
  }
  return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

/** Valide la réponse : un objet avec exactement les ids demandés, chacun une chaîne non vide. */
export function parseResult(text: string, ids: string[]): Record<string, string> | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== ids.length || !ids.every((id) => typeof record[id] === 'string' && (record[id] as string).trim())) return;
  return record as Record<string, string>;
}

/** Erreurs de l'API → messages compréhensibles. Les 429/5xx sont déjà retentés par le SDK. */
function explain(err: unknown, model: string): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new UserError('Clé API refusée : vérifie ANTHROPIC_API_KEY.');
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new UserError(`Accès refusé au modèle ${model} avec cette clé API.`);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new UserError(`Modèle introuvable : ${model}. Corrige --model ou YE_XPERIENCE_I18N_MODEL.`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new UserError('Limite de débit de l’API atteinte. Attends un peu puis relance (le travail déjà fait n’est pas écrit).');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new UserError(`Requête refusée par l’API (${model}) : ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new UserError('Impossible de joindre l’API Anthropic : vérifie ta connexion.');
  }
  if (err instanceof Anthropic.APIError) {
    return new UserError(`Erreur de l’API Anthropic (${err.status ?? '?'}) : ${err.message}`);
  }
  // Le SDK lève une Error simple quand il ne trouve aucun identifiant.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return new UserError(
      'ANTHROPIC_API_KEY n’est pas défini. Crée une clé sur https://platform.claude.com puis :\n  export ANTHROPIC_API_KEY=sk-ant-...',
    );
  }
  return err as Error;
}
