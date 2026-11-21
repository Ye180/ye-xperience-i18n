import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../../src/run';
import type { Entry, Translator } from '../../src/translate';

const PMS = (process.env.E2E_PM ?? 'pnpm,npm').split(',');
const VERSIONS: Record<string, string> = {
  pnpm: execFileSync('pnpm', ['-v'], { encoding: 'utf8' }).trim(),
  npm: execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim(),
};

describe.each(PMS)('init sur la fixture (%s)', (pm) => {
const dir = mkdtempSync(join(tmpdir(), `ye-i18n-e2e-${pm}-`));
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
const commit = () => {
  git('add', '-A');
  git('commit', '-qm', 'wip', '--allow-empty');
};
const readJson = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
/** `npm exec` lit lui-même les options (-p…) sans `--`. */
const exec = (...args: string[]) => (pm === 'npm' ? ['exec', '--', ...args] : ['exec', ...args]);

let calls: Entry[][] = [];
const translator: Translator = async (entries, _from, to) => {
  calls.push(entries);
  return Object.fromEntries(entries.map((e) => [e.id, `[${to}] ${e.text}`]));
};

let server: ReturnType<typeof spawn> | undefined;
afterAll(() => server?.kill());

  it('prépare le projet', () => {
    cpSync(join(import.meta.dirname, '../fixtures/basic'), dir, { recursive: true });
    const pkg = readJson('package.json');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkg, packageManager: `${pm}@${VERSIONS[pm]}` }, null, 2));
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.next/\nnext-env.d.ts\n');
    mkdirSync(join(dir, '.ye-xperience-i18n'));
    writeFileSync(
      join(dir, '.ye-xperience-i18n/config.json'),
      JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en', 'de'], include: ['app', 'components'], ignore: [], switcher: 'top-right' }),
    );
    git('init', '-q');
    commit();
  });

  it('init --yes : réécrit, traduit, installe', async () => {
    await run(['init', '--yes'], dir, { translator });
    expect(readJson('messages/en.json').HomePage.bienvenueChezAtelierLumiere).toBe('[en] Bienvenue chez Atelier Lumière');
    expect(readJson('package.json').dependencies['next-intl']).toBeDefined();
    expect(existsSync(join(dir, 'node_modules/next-intl/package.json'))).toBe(true);
    expect(calls.flat()).toHaveLength(50); // 25 textes uniques (dont « Langue » du sélecteur) × 2 langues
  });

  it('next build passe', () => {
    const build = spawnSync(pm, exec('next', 'build'), { cwd: dir, encoding: 'utf8' });
    if (build.status !== 0) console.log(build.stdout, build.stderr);
    expect(build.status).toBe(0);
  });

  it('les routes /fr, /en et la redirection de / fonctionnent', async () => {
    const port = 3000 + Math.floor(Math.random() * 1000);
    server = spawn(pm, exec('next', 'start', '-p', String(port)), { cwd: dir, stdio: 'ignore' });
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(url, { redirect: 'manual' });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const root = await fetch(url, { redirect: 'manual' });
    expect(root.status).toBeGreaterThanOrEqual(300);
    expect(root.headers.get('location')).toMatch(/\/fr$/);

    const en = await (await fetch(`${url}/en`)).text();
    expect(en).toContain('lang="en"');
    expect(en).toContain('[en] Bienvenue chez Atelier Lumière');
    expect(en).toContain('href="/en/contact"');
    expect(en).toContain('Ne pas traduire cette ligne.');
    expect(en).toContain('aria-label="[en] Langue"'); // sélecteur de langue, libellé traduit
    expect(en).toContain('>Deutsch</option>');

    const fr = await (await fetch(`${url}/fr/contact`)).text();
    expect(fr).toContain('lang="fr"');
    expect(fr).toContain('placeholder="Écrivez votre message ici"');

    const client = await (await fetch(`${url}/de`)).text();
    expect(client).toContain('[de] Cliquer ici'); // composant client
    server.kill();
  });

  it('relancer init puis sync ne change rien et n’appelle pas Claude', async () => {
    commit();
    calls = [];
    await run(['init', '--yes'], dir, { translator });
    await run(['sync'], dir, { translator });
    expect(git('status', '--porcelain')).toBe('');
    expect(calls).toEqual([]);
  });

  it('sync ne traduit que le nouveau texte', async () => {
    const page = join(dir, 'app/[locale]/contact/page.tsx');
    writeFileSync(page, readFileSync(page, 'utf8').replace('<h1>', '<p>Réponse sous 48 heures</p>\n      <h1>'));
    commit();
    await run(['sync'], dir, { translator });
    expect(calls.flat().map((e) => e.text)).toEqual(['Réponse sous 48 heures', 'Réponse sous 48 heures']);
    expect(readJson('messages/de.json').ContactPage.reponseSous48Heures).toBe('[de] Réponse sous 48 heures');
  });
});
