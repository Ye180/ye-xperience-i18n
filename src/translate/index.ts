import { createHash } from 'node:crypto';
import type { Messages } from '../extract';

export const CACHE_PATH = '.ye-xperience-i18n/cache.json';

/** hash du texte source → locale → traduction. À commiter : il évite de repayer les traductions. */
export type Cache = Record<string, Record<string, string>>;

export interface Entry {
  /** "Namespace.cle" : sert d'identifiant et de contexte pour la traduction. */
  id: string;
  text: string;
}

/** Traduit un lot ; renvoie id → traduction pour exactement les ids reçus. */
export type Translator = (entries: Entry[], from: string, to: string) => Promise<Record<string, string>>;

export interface TranslateInput {
  /** messages/{source}.json */
  source: Messages;
  sourceLocale: string;
  targetLocales: string[];
  /** messages/{cible}.json actuels (retouches manuelles à préserver). */
  existing: Record<string, Messages>;
  cache: Cache;
  /** Absent en dry-run : aucun appel, les textes à traduire gardent le texte source. */
  translator?: Translator;
  /** Locales à retraduire entièrement (commande translate). */
  force?: string[];
  batchSize?: number;
  onBatch?: (locale: string, done: number, total: number) => void;
}

export interface TranslateOutput {
  messages: Record<string, Messages>;
  cache: Cache;
  /** Nombre de textes (dédoublonnés) envoyés, ou à envoyer en dry-run, par locale. */
  sent: Record<string, number>;
}

const hash = (locale: string, text: string) =>
  createHash('sha256').update(`${locale}\0${text}`).digest('hex').slice(0, 16);

/**
 * Construit messages/{cible}.json pour chaque locale cible.
 * - texte source déjà traduit (cache) : on garde la valeur actuelle du fichier cible, donc les retouches manuelles ;
 * - texte nouveau ou modifié (hash inconnu) : envoyé au traducteur, par lots ;
 * - clés disparues de la source : retirées des cibles et du cache.
 * ponytail: un texte modifié dont le nouveau hash existe déjà (texte identique ailleurs) garde
 * l'ancienne valeur cible de sa clé ; `translate --locale` corrige si besoin.
 */
export async function translateAll(input: TranslateInput): Promise<TranslateOutput> {
  const entries = flatten(input.source);
  const hashes = new Map([...entries].map(([id, text]) => [id, hash(input.sourceLocale, text)]));
  const cache: Cache = {};
  for (const h of hashes.values()) cache[h] = { ...input.cache[h] };
  const messages: Record<string, Messages> = {};
  const sent: Record<string, number> = {};

  await Promise.all(
    input.targetLocales.map(async (locale) => {
      const force = input.force?.includes(locale);
      const existing = flatten(input.existing[locale] ?? {});
      const todo = new Map<string, Entry>(); // hash → entrée, dédoublonnée
      for (const [id, text] of entries) {
        const h = hashes.get(id)!;
        if (!force && cache[h][locale] !== undefined) {
          const current = existing.get(id);
          if (current !== undefined) cache[h][locale] = current;
        } else if (!todo.has(h)) todo.set(h, { id, text });
      }

      sent[locale] = todo.size;
      const batches = chunk([...todo], input.batchSize ?? 40);
      if (input.translator) {
        for (const [i, batch] of batches.entries()) {
          const result = await input.translator(
            batch.map(([, e]) => e),
            input.sourceLocale,
            locale,
          );
          for (const [h, e] of batch) {
            if (typeof result[e.id] !== 'string') throw new Error(`Traduction manquante pour ${e.id} (${locale})`);
            cache[h][locale] = result[e.id];
          }
          input.onBatch?.(locale, i + 1, batches.length);
        }
      }

      messages[locale] = unflatten([...entries].map(([id, text]) => [id, cache[hashes.get(id)!][locale] ?? text]));
    }),
  );

  for (const h of Object.keys(cache)) if (!Object.keys(cache[h]).length) delete cache[h];
  return { messages, cache, sent };
}

/** { A: { b: 'x' } } → Map { 'A.b' => 'x' } (seules les chaînes sont traduites). */
export function flatten(obj: Record<string, unknown>, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const id = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(id, v);
    else if (v && typeof v === 'object') flatten(v as Record<string, unknown>, id, out);
  }
  return out;
}

export function unflatten(pairs: [string, string][]): Messages {
  const root: Record<string, any> = {};
  for (const [id, value] of pairs) {
    const parts = id.split('.');
    let node = root;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    node[parts.at(-1)!] = value;
  }
  return root;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
