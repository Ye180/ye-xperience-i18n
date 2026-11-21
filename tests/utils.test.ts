import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseCli } from '../src/args';
import { UserError } from '../src/utils/errors';
import { assertCleanGit, gitState } from '../src/utils/git';
import { detectPackageManager, detectProject } from '../src/utils/project';
import { VirtualFS } from '../src/utils/vfs';

const FIXTURE = join(import.meta.dirname, 'fixtures/basic');
const tmp = () => mkdtempSync(join(tmpdir(), 'ye-i18n-'));

describe('parseCli', () => {
  it('lit commande et options', () => {
    const { command, options } = parseCli(['init', '--dry-run', '-y', '--ignore', 'a/**', '--ignore', 'b.tsx']);
    expect(command).toBe('init');
    expect(parseCli(['sync', '--provider', 'gemini']).options.provider).toBe('gemini');
    expect(options).toMatchObject({ dryRun: true, yes: true, force: false, ignore: ['a/**', 'b.tsx'] });
  });
  it('aide par défaut, version', () => {
    expect(parseCli([]).command).toBe('help');
    expect(parseCli(['-v']).command).toBe('version');
  });
  it('rejette les entrées invalides', () => {
    expect(() => parseCli(['deploy'])).toThrow(UserError);
    expect(() => parseCli(['init', '--nope'])).toThrow(UserError);
    expect(() => parseCli(['translate'])).toThrow(/--locale/);
    expect(parseCli(['translate', '--locale', 'en']).options.locale).toBe('en');
  });
});

describe('detectProject', () => {
  it('détecte la fixture', () => {
    expect(detectProject(FIXTURE)).toMatchObject({
      srcDir: '',
      appDir: join(FIXTURE, 'app'),
      next: { major: 16, minor: 4 },
    });
  });
  it('détecte le gestionnaire de paquets', () => {
    vi.stubEnv('npm_config_user_agent', '');
    const repo = tmp();
    const app = join(repo, 'apps/web');
    execFileSync('mkdir', ['-p', app, join(repo, '.git')]);
    expect(detectPackageManager(app, {})).toBe('npm');
    expect(detectPackageManager(app, { packageManager: 'pnpm@12.15.0' })).toBe('pnpm');
    writeFileSync(join(repo, 'pnpm-lock.yaml'), ''); // monorepo : lockfile à la racine
    expect(detectPackageManager(app, {})).toBe('pnpm');
    writeFileSync(join(app, 'yarn.lock'), '');
    expect(detectPackageManager(app, {})).toBe('yarn');
    const alone = tmp();
    vi.stubEnv('npm_config_user_agent', 'pnpm/12.15.0 npm/? node/v26.12.0 linux x64');
    expect(detectPackageManager(alone, {})).toBe('pnpm');
    vi.unstubAllEnvs();
  });
  it('refuse un dossier sans Next.js', () => {
    const dir = tmp();
    expect(() => detectProject(dir)).toThrow(/package.json/);
    writeFileSync(join(dir, 'package.json'), '{"dependencies":{"react":"19"}}');
    expect(() => detectProject(dir)).toThrow(/Next.js/);
  });
});

describe('VirtualFS', () => {
  it('garde tout en mémoire jusqu’au commit', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'avant\n');
    const vfs = new VirtualFS(dir);
    vfs.write('a.txt', 'après\n');
    vfs.write('sub/b.txt', 'nouveau\n');
    vfs.move('a.txt', 'c.txt');

    expect(vfs.read('c.txt')).toBe('après\n');
    expect(vfs.exists('a.txt')).toBe(false);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('avant\n');
    expect(vfs.changedFiles()).toEqual(['a.txt', 'c.txt', 'sub/b.txt']);
    expect(vfs.diff()).toContain('+nouveau');
    expect(vfs.diff()).toContain('--- a/a.txt\n+++ b/c.txt');
    expect(vfs.diff()).not.toContain('+++ /dev/null');

    vfs.commit();
    expect(existsSync(join(dir, 'a.txt'))).toBe(false);
    expect(readFileSync(join(dir, 'sub/b.txt'), 'utf8')).toBe('nouveau\n');
    expect(vfs.changedFiles()).toEqual([]);
  });
  it('supprime les dossiers vidés par un déplacement', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'app/contact/form'), { recursive: true });
    writeFileSync(join(dir, 'app/contact/form/page.tsx'), 'x');
    writeFileSync(join(dir, 'app/keep.txt'), 'x');
    const vfs = new VirtualFS(dir);
    vfs.move('app/contact/form/page.tsx', 'app/[locale]/contact/form/page.tsx');
    vfs.commit();
    expect(existsSync(join(dir, 'app/contact'))).toBe(false);
    expect(existsSync(join(dir, 'app/keep.txt'))).toBe(true);
  });
  it('ignore une écriture identique au disque', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'x');
    const vfs = new VirtualFS(dir);
    vfs.write('a.txt', 'x');
    expect(vfs.changedFiles()).toEqual([]);
  });
  it('refuse les chemins interdits', () => {
    const vfs = new VirtualFS(tmp());
    for (const p of ['../x', 'node_modules/a.js', '.next/b', 'app/node_modules/c']) {
      expect(() => vfs.write(p, '')).toThrow(/interdit/);
    }
  });
});

describe('git', () => {
  it('distingue no-repo, clean et dirty', () => {
    const dir = tmp();
    expect(gitState(dir)).toBe('no-repo');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
    git('init', '-q');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git('add', '.');
    git('commit', '-qm', 'init');
    expect(gitState(dir)).toBe('clean');
    expect(() => assertCleanGit(dir, false)).not.toThrow();
    writeFileSync(join(dir, 'a.txt'), 'b');
    expect(gitState(dir)).toBe('dirty');
    expect(() => assertCleanGit(dir, false)).toThrow(UserError);
    expect(() => assertCleanGit(dir, true)).not.toThrow();
  });
});
