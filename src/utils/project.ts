import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UserError } from './errors';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface Project {
  root: string;
  /** Dossier qui contient app/ : '' (racine) ou 'src'. i18n/ et proxy.ts y seront créés. */
  srcDir: string;
  /** Chemin absolu du dossier app/. */
  appDir: string;
  packageManager: PackageManager;
  next: { major: number; minor: number };
}

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

export function detectProject(root: string): Project {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) throw new UserError(`package.json introuvable dans ${root}.`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const range: string | undefined = pkg.dependencies?.next ?? pkg.devDependencies?.next;
  if (!range) throw new UserError('`next` absent des dépendances : ce n’est pas un projet Next.js.');

  const srcDir = existsSync(join(root, 'src', 'app')) ? 'src' : existsSync(join(root, 'app')) ? '' : null;
  if (srcDir === null) throw new UserError('Dossier app/ introuvable : seul l’App Router est supporté.');

  return {
    root,
    srcDir,
    appDir: join(root, srcDir, 'app'),
    packageManager: detectPackageManager(root, pkg),
    next: nextVersion(root, range),
  };
}

/**
 * 1. champ `packageManager` du package.json (corepack) ;
 * 2. lockfile du projet ou d'un dossier parent jusqu'à la racine du repo git (monorepo) ;
 * 3. outil qui a lancé la commande (`pnpm dlx`, `npx`…) ;
 * 4. npm.
 */
export function detectPackageManager(root: string, pkg: { packageManager?: string }): PackageManager {
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? '')?.[1];
  if (declared) return declared as PackageManager;
  for (let dir = root; ; dir = dirname(dir)) {
    const found = LOCKFILES.find(([file]) => existsSync(join(dir, file)))?.[1];
    if (found) return found;
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) break;
  }
  const agent = /^(npm|pnpm|yarn|bun)\//.exec(process.env.npm_config_user_agent ?? '')?.[1];
  return (agent as PackageManager | undefined) ?? 'npm';
}

/** Version installée si node_modules existe, sinon déduite de la plage du package.json. */
function nextVersion(root: string, range: string): Project['next'] {
  const installed = join(root, 'node_modules', 'next', 'package.json');
  const version: string = existsSync(installed) ? JSON.parse(readFileSync(installed, 'utf8')).version : range;
  const m = /(\d+)(?:\.(\d+))?/.exec(version);
  if (!m) throw new UserError(`Version de next illisible ("${range}") : installe les dépendances puis relance.`);
  return { major: Number(m[1]), minor: Number(m[2] ?? 0) };
}
