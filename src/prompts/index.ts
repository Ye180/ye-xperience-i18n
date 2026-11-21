import * as p from '@clack/prompts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, Options } from '../args';
import { type Config, LOCALE_RE, loadConfig, type Switcher, validateConfig } from '../utils/config';
import { UserError } from '../utils/errors';
import { type Provider, PROVIDERS } from '../translate/providers';
import type { Project } from '../utils/project';
import type { VirtualFS } from '../utils/vfs';

export const LOCALE_LABELS: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  pl: 'Polski',
  ru: 'Русский',
  tr: 'Türkçe',
  ar: 'العربية',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
};
export const OTHER = '__other__';

/**
 * Config de la commande. `init` interactif pose les questions (préremplies avec la
 * config enregistrée) ; `--yes`, `sync` et `translate` réutilisent la config enregistrée.
 */
export async function getConfig(command: Command, project: Project, options: Options, vfs: VirtualFS): Promise<Config> {
  const saved = loadConfig(vfs);
  const ignore = [...new Set([...(saved?.ignore ?? []), ...options.ignore])];

  if (command !== 'init' || options.yes) {
    if (!saved) {
      throw new UserError(
        command === 'init'
          ? 'Aucune config enregistrée : lance `init` sans --yes la première fois.'
          : 'Aucune config enregistrée : lance d’abord `ye-xperience-i18n init`.',
      );
    }
    return { ...saved, ignore };
  }

  const sourceLocale = await askSource(saved?.sourceLocale ?? detectHtmlLang(project) ?? 'fr');
  const targetLocales = await askTargets(sourceLocale, saved?.targetLocales ?? []);
  const include = await askInclude(project, saved?.include ?? defaultInclude(project));
  const switcher = await askSwitcher(saved?.switcher ?? 'top-right');
  const config = { sourceLocale, targetLocales, include, ignore, switcher };
  const problem = validateConfig(config);
  if (problem) throw new UserError(`Config invalide : ${problem}.`);
  return config;
}

function check<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) throw new UserError('Annulé.');
  return value as Exclude<T, symbol>;
}

const splitList = (s = '') =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function localeOptions(extra: string[]) {
  const codes = [...new Set([...Object.keys(LOCALE_LABELS), ...extra])];
  return [
    ...codes.map((code) => ({ value: code, label: `${LOCALE_LABELS[code] ?? code} (${code})` })),
    { value: OTHER, label: 'Autre code…' },
  ];
}

async function askCustomLocales(message: string): Promise<string[]> {
  const value = check(
    await p.text({
      message,
      placeholder: 'pt-BR, sv',
      validate: (s) => {
        const codes = splitList(s);
        if (!codes.length) return 'Indique au moins un code.';
        const bad = codes.find((c) => !LOCALE_RE.test(c));
        if (bad) return `Code de langue invalide : ${bad}`;
      },
    }),
  );
  return splitList(value);
}

async function askSource(initial: string): Promise<string> {
  const value = check(
    await p.select({ message: 'Langue source du projet ?', options: localeOptions([initial]), initialValue: initial }),
  );
  return value === OTHER ? (await askCustomLocales('Code de la langue source ?'))[0] : value;
}

async function askTargets(source: string, initial: string[]): Promise<string[]> {
  const options = localeOptions(initial).filter((o) => o.value !== source);
  const values = check(
    await p.multiselect({
      message: 'Langues cibles ? (espace pour cocher)',
      options,
      initialValues: initial.filter((l) => l !== source),
      required: true,
    }),
  );
  const custom = values.includes(OTHER) ? await askCustomLocales('Codes des autres langues (séparés par des virgules) ?') : [];
  return [...new Set([...values.filter((v) => v !== OTHER), ...custom])].filter((l) => l !== source);
}

async function askInclude(project: Project, initial: string[]): Promise<string[]> {
  const value = check(
    await p.text({
      message: 'Dossiers à analyser (séparés par des virgules) ?',
      initialValue: initial.join(', '),
      validate: (s) => {
        const dirs = splitList(s);
        if (!dirs.length) return 'Indique au moins un dossier.';
        const missing = dirs.find((d) => !existsSync(join(project.root, d)));
        if (missing) return `Dossier introuvable : ${missing}`;
      },
    }),
  );
  return splitList(value);
}

/** Aucune clé trouvée : choix de l'IA (si --provider absent) et saisie de la clé. */
export async function askProvider(): Promise<string> {
  return check(
    await p.select({
      message: 'Quelle IA pour traduire ?',
      options: Object.entries(PROVIDERS).map(([value, pr]) => ({ value, label: pr.label, hint: pr.model })),
    }),
  );
}

export async function askApiKey(provider: Provider): Promise<string> {
  const key = check(
    await p.password({
      message: `Clé API ${provider.label} ? (à créer sur ${provider.keys})`,
      validate: (s) => (s?.trim() ? undefined : 'Colle ta clé API.'),
    }),
  );
  return key.trim();
}

export async function askSaveKey(file: string): Promise<boolean> {
  return check(
    await p.confirm({ message: `Enregistrer la clé sur cet ordinateur (${file}, hors du projet) ?`, initialValue: true }),
  );
}

async function askSwitcher(initial: Switcher): Promise<Switcher> {
  return check(
    await p.select({
      message: 'Sélecteur de langue flottant ?',
      options: [
        { value: 'top-right', label: 'En haut à droite' },
        { value: 'top-left', label: 'En haut à gauche' },
        { value: 'bottom-right', label: 'En bas à droite' },
        { value: 'bottom-left', label: 'En bas à gauche' },
        { value: 'none', label: 'Aucun (je le place moi-même)' },
      ],
      initialValue: initial,
    }),
  );
}

/** app/ et components/ (préfixés par src/ si besoin), components/ seulement s'il existe. */
export function defaultInclude(project: Project): string[] {
  return ['app', 'components']
    .map((d) => [project.srcDir, d].filter(Boolean).join('/'))
    .filter((d, i) => i === 0 || existsSync(join(project.root, d)));
}

/** Lit `<html lang="…">` dans le layout racine pour proposer la langue source. */
export function detectHtmlLang(project: Project): string | undefined {
  for (const ext of ['tsx', 'jsx', 'js']) {
    const file = join(project.appDir, `layout.${ext}`);
    if (existsSync(file)) {
      const lang = /<html[^>]*\blang=["']([^"']+)["']/.exec(readFileSync(file, 'utf8'))?.[1];
      return lang && LOCALE_RE.test(lang) ? lang : undefined;
    }
  }
}
