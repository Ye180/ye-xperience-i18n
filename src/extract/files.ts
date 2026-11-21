import type { Config } from '../utils/config';
import type { VirtualFS } from '../utils/vfs';

const SOURCE = /\.(tsx|jsx|js)$/;
const EXCLUDED = /(^|\/)(node_modules|\.next)\/|\.(test|spec|stories)\.[jt]sx?$/;

/**
 * Glob minimal : `**` (n'importe quel chemin), `*` (dans un segment), `?`.
 * ponytail: pas d'accolades ni de classes, passer à path.matchesGlob quand Node 22 sera le minimum.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Un fichier est ignoré si lui-même ou l'un de ses dossiers parents correspond à un glob. */
export function isIgnored(file: string, globs: RegExp[]): boolean {
  const parts = file.split('/');
  return parts.some((_, i) => globs.some((g) => g.test(parts.slice(0, i + 1).join('/'))));
}

/** Fichiers source des dossiers `include`, relatifs à la racine, triés (modifications en attente comprises). */
export function listSourceFiles(vfs: VirtualFS, config: Config): string[] {
  const globs = config.ignore.map(globToRegExp);
  const files = config.include.flatMap((dir) => vfs.list(dir));
  return [...new Set(files)].filter((f) => SOURCE.test(f) && !EXCLUDED.test(f) && !isIgnored(f, globs)).sort();
}
