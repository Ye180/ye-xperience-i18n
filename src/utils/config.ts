import { isAbsolute } from 'node:path';
import { UserError } from './errors';
import type { VirtualFS } from './vfs';

export const CONFIG_PATH = '.ye-xperience-i18n/config.json';

export interface Config {
  sourceLocale: string;
  targetLocales: string[];
  /** Dossiers analysés, relatifs à la racine du projet. */
  include: string[];
  /** Globs exclus de l'analyse. */
  ignore: string[];
  /** Sélecteur de langue flottant ajouté au layout. Absent (anciennes configs) = 'none'. */
  switcher?: Switcher;
}

export const SWITCHERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'none'] as const;
export type Switcher = (typeof SWITCHERS)[number];

/** Code BCP 47 simplifié : fr, en, pt-BR, zh-Hant… */
export const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Renvoie le problème trouvé, ou undefined si la config est valide. */
export function validateConfig(c: any): string | undefined {
  if (typeof c?.sourceLocale !== 'string' || !LOCALE_RE.test(c.sourceLocale)) {
    return 'sourceLocale doit être un code de langue (ex. "fr")';
  }
  if (!isStringArray(c.targetLocales) || !c.targetLocales.length || !c.targetLocales.every((l: string) => LOCALE_RE.test(l))) {
    return 'targetLocales doit être une liste non vide de codes de langue';
  }
  if (c.targetLocales.includes(c.sourceLocale)) return 'targetLocales ne doit pas contenir la langue source';
  if (!isStringArray(c.include) || !c.include.length) return 'include doit être une liste non vide de dossiers';
  if (c.include.some((d: string) => isAbsolute(d) || d.split(/[\\/]/).includes('..'))) {
    return 'include ne doit contenir que des dossiers internes au projet';
  }
  if (!isStringArray(c.ignore)) return 'ignore doit être une liste de globs';
  if (c.switcher !== undefined && !SWITCHERS.includes(c.switcher)) return `switcher doit valoir ${SWITCHERS.join(', ')}`;
}

export function loadConfig(vfs: VirtualFS): Config | undefined {
  const raw = vfs.read(CONFIG_PATH);
  if (raw === undefined) return undefined;
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new UserError(`${CONFIG_PATH} n’est pas du JSON valide.`);
  }
  const problem = validateConfig(config);
  if (problem) throw new UserError(`${CONFIG_PATH} invalide : ${problem}.`);
  return config;
}

export function saveConfig(vfs: VirtualFS, config: Config): void {
  vfs.write(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}
