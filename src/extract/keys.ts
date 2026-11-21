import { UserError } from '../utils/errors';

/** messages/{locale}.json : namespace → clé → texte. */
export type Messages = Record<string, Record<string, unknown>>;

/** Clé lisible : 5 premiers mots en camelCase, sans accents. */
export function slugify(text: string): string {
  const words = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 5);
  const slug = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('');
  return slug.slice(0, 40) || 'text';
}

/** PascalCase d'un segment : "a-propos" → "APropos", "[slug]" → "Slug". */
const pascal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');

/** Namespace déduit du chemin : app/contact/page.tsx → ContactPage, app/page.tsx → HomePage. */
export function namespaceFromFile(file: string): string {
  const parts = file
    .replace(/\.[jt]sx?$/, '')
    .split('/')
    .filter((p, i) => !(i === 0 && p === 'src') && !['app', 'components', '[locale]'].includes(p) && !/^\(.*\)$/.test(p));
  if (parts.length === 1) return parts[0] === 'page' ? 'HomePage' : `Root${pascal(parts[0])}`;
  return parts.map(pascal).join('');
}

/**
 * Attribue une clé à chaque texte et renvoie les messages source fusionnés.
 * Même texte dans le même namespace → même clé ; collision → suffixe 2, 3…
 */
export function assignKeys(items: { namespace: string; text: string; key: string }[], existing: Messages): Messages {
  const messages: Messages = structuredClone(existing);
  for (const item of items) {
    if (messages[item.namespace] !== undefined && typeof messages[item.namespace] !== 'object') {
      throw new UserError(`Le namespace "${item.namespace}" existe déjà dans les messages et n’est pas un objet.`);
    }
    const ns = (messages[item.namespace] ??= {});
    const found = Object.keys(ns).find((k) => ns[k] === item.text);
    if (found) {
      item.key = found;
      continue;
    }
    const base = slugify(item.text);
    let key = base;
    for (let n = 2; key in ns; n++) key = `${base}${n}`;
    ns[key] = item.text;
    item.key = key;
  }
  return messages;
}
