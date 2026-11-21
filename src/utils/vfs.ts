import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { UserError } from './errors';

const FORBIDDEN = /(^|[\\/])(node_modules|\.next|\.git)([\\/]|$)/;
const toPosix = (p: string) => p.split(sep).join('/');

/**
 * Système de fichiers virtuel : toutes les modifications restent en mémoire
 * jusqu'à commit(). Sert à --dry-run (diff()) et garantit qu'une erreur en cours
 * de route (ex. API de traduction) n'écrit rien de partiel.
 * Les fichiers déplacés gardent leurs octets (Buffer) : les binaires survivent à un move.
 */
export class VirtualFS {
  /** chemin absolu → nouveau contenu (null = supprimé) */
  private changes = new Map<string, string | Buffer | null>();
  /** destination absolue → source absolue, pour afficher les déplacements dans le diff */
  private moves = new Map<string, string>();

  constructor(readonly root: string) {}

  private abs(path: string): string {
    const abs = resolve(this.root, path);
    const rel = relative(this.root, abs);
    if (rel.startsWith('..') || FORBIDDEN.test(rel)) throw new Error(`Chemin interdit : ${path}`);
    return abs;
  }

  private raw(abs: string): string | Buffer | undefined {
    if (this.changes.has(abs)) return this.changes.get(abs) ?? undefined;
    return existsSync(abs) ? readFileSync(abs) : undefined;
  }

  read(path: string): string | undefined {
    return this.raw(this.abs(path))?.toString();
  }

  /** JSON du fichier, ou fallback s'il n'existe pas. JSON invalide → UserError. */
  readJson<T>(path: string, fallback: T): T {
    const raw = this.read(path);
    if (raw === undefined) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      throw new UserError(`${path} n’est pas du JSON valide : corrige-le ou supprime-le, puis relance.`);
    }
  }

  exists(path: string): boolean {
    return this.raw(this.abs(path)) !== undefined;
  }

  write(path: string, content: string | Buffer): void {
    const abs = this.abs(path);
    const onDisk = existsSync(abs) ? readFileSync(abs) : undefined;
    if (onDisk?.equals(Buffer.from(content))) this.changes.delete(abs);
    else this.changes.set(abs, content);
  }

  remove(path: string): void {
    const abs = this.abs(path);
    if (existsSync(abs)) this.changes.set(abs, null);
    else this.changes.delete(abs);
  }

  /** Déplace un fichier, éventuellement avec un nouveau contenu. */
  move(from: string, to: string, content?: string | Buffer): void {
    const source = content ?? this.raw(this.abs(from));
    if (source === undefined) throw new Error(`move : ${from} introuvable`);
    this.remove(from);
    this.write(to, source);
    this.moves.set(this.abs(to), this.abs(from));
  }

  /** Fichiers sous dir (relatifs à root, triés), modifications en attente comprises. */
  list(dir: string): string[] {
    const absDir = this.abs(dir);
    const files = new Set<string>();
    if (existsSync(absDir)) {
      for (const entry of readdirSync(absDir, { recursive: true, encoding: 'utf8' })) {
        const abs = join(absDir, entry);
        if (!FORBIDDEN.test(entry) && statSync(abs).isFile()) files.add(abs);
      }
    }
    for (const [abs, content] of this.changes) {
      if (!abs.startsWith(absDir + sep)) continue;
      if (content === null) files.delete(abs);
      else files.add(abs);
    }
    return [...files].map((abs) => toPosix(relative(this.root, abs))).sort();
  }

  /** Fichiers modifiés, relatifs à root, triés. */
  changedFiles(): string[] {
    return [...this.changes.keys()].map((abs) => toPosix(relative(this.root, abs))).sort();
  }

  /** Diff unifié de toutes les modifications en attente. */
  diff(): string {
    const movedFrom = new Set(this.moves.values());
    return this.changedFiles()
      .filter((rel) => !(movedFrom.has(this.abs(rel)) && this.changes.get(this.abs(rel)) === null))
      .map((rel) => {
        const abs = this.abs(rel);
        const origin = this.moves.get(abs) ?? abs;
        const before = existsSync(origin) ? readFileSync(origin) : undefined;
        const after = this.changes.get(abs);
        const from = before === undefined ? '/dev/null' : `a/${toPosix(relative(this.root, origin))}`;
        const to = after === null ? '/dev/null' : `b/${rel}`;
        if (isBinary(before) || isBinary(after)) return `--- ${from}\n+++ ${to}\nFichier binaire\n`;
        return createTwoFilesPatch(from, to, before?.toString() ?? '', after?.toString() ?? '');
      })
      .join('\n');
  }

  commit(): void {
    for (const [abs, content] of this.changes) {
      if (content === null) {
        rmSync(abs, { force: true });
        // Dossiers vidés (ex. app/contact après le déplacement vers app/[locale]) : supprimés aussi.
        for (let dir = dirname(abs); dir !== this.root && existsSync(dir) && !readdirSync(dir).length; dir = dirname(dir)) {
          rmdirSync(dir);
        }
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    }
    this.changes.clear();
    this.moves.clear();
  }
}

const isBinary = (c: string | Buffer | null | undefined) => Buffer.isBuffer(c) && c.includes(0);
