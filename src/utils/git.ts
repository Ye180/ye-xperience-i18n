import { execFileSync } from 'node:child_process';
import { UserError } from './errors';

export type GitState = 'clean' | 'dirty' | 'no-repo';

export function gitState(cwd: string): GitState {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === '' ? 'clean' : 'dirty';
  } catch {
    return 'no-repo';
  }
}

/** Refuse de modifier un projet qu'on ne pourrait pas restaurer avec git. */
export function assertCleanGit(cwd: string, force: boolean): void {
  if (force) return;
  const state = gitState(cwd);
  if (state === 'dirty') {
    throw new UserError(
      'Le repo git contient des modifications non commitées. Commite-les avant de lancer l’outil (ou utilise --force).',
    );
  }
  if (state === 'no-repo') {
    throw new UserError(
      'Ce dossier n’est pas un repo git : les modifications ne pourraient pas être annulées. Lance `git init` puis commite (ou utilise --force).',
    );
  }
}
