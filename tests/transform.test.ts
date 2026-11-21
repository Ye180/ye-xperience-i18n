import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ts } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extract } from '../src/extract';
import { transform } from '../src/transform';
import type { Config } from '../src/utils/config';
import { VirtualFS } from '../src/utils/vfs';

const config: Config = { sourceLocale: 'fr', targetLocales: ['en'], include: ['app', 'components'], ignore: [] };

function project(files: Record<string, string>): VirtualFS {
  const root = mkdtempSync(join(tmpdir(), 'ye-i18n-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return new VirtualFS(root);
}

/** Transforme un seul fichier components/X.tsx et renvoie son nouveau contenu. */
function run(source: string, messages = {}): string {
  const vfs = project({ 'components/X.tsx': source });
  transform(extract(vfs, config, messages), vfs);
  return vfs.read('components/X.tsx')!;
}

const syntaxErrors = (code: string) =>
  ts.transpileModule(code, { reportDiagnostics: true, fileName: 'x.tsx', compilerOptions: { jsx: ts.JsxEmit.Preserve } })
    .diagnostics!.length;

describe('transform sur la fixture', () => {
  const vfs = new VirtualFS(join(import.meta.dirname, 'fixtures/basic'));
  transform(extract(vfs, config), vfs);

  it('produit le code attendu', () => {
    for (const file of vfs.changedFiles()) expect(vfs.read(file)).toMatchSnapshot(file);
  });

  it('produit du code syntaxiquement valide', () => {
    for (const file of vfs.changedFiles()) expect(syntaxErrors(vfs.read(file)!), file).toBe(0);
  });

  it('est idempotent', () => {
    const again = extract(vfs, config);
    expect(again.items).toEqual([]);
    const before = vfs.changedFiles().map((f) => vfs.read(f));
    transform(again, vfs);
    expect(vfs.changedFiles().map((f) => vfs.read(f))).toEqual(before);
  });
});

describe('transform : cas particuliers', () => {
  it('composant async → await getTranslations', () => {
    expect(run(`export async function X() {\n  return <p>Salut</p>;\n}\n`)).toBe(
      `import { getTranslations } from 'next-intl/server';\n\nexport async function X() {\n  const t = await getTranslations('X');\n  return <p>{t('salut')}</p>;\n}\n`,
    );
  });

  it('`t` déjà utilisé → tI18n', () => {
    const out = run(`export function X({ t }: { t: number }) {\n  return <p title="Note">Score {'x'}</p>;\n}\n`);
    expect(out).toContain(`const tI18n = useTranslations('X');`);
    expect(out).toContain(`<p title={tI18n('note')}>{tI18n('score')}{' '}{'x'}</p>`);
  });

  it('réutilise un traducteur existant (sync) et un import existant', () => {
    const source = `import { useTranslations } from 'next-intl';

export function X() {
  const t = useTranslations('Menu');
  return <nav>{t('accueil')}<a>Nouveau</a></nav>;
}
`;
    expect(run(source, { Menu: { accueil: 'Accueil' } })).toBe(source.replace('<a>Nouveau</a>', `<a>{t('nouveau')}</a>`));
  });

  it('complète un import next-intl existant', () => {
    const out = run(`import { NextIntlClientProvider } from 'next-intl';\nexport function X() {\n  return <p>Salut</p>;\n}\n`);
    expect(out).toContain(`import { NextIntlClientProvider, useTranslations } from 'next-intl';`);
  });

  it('import après "use client" quand il n’y a aucun import', () => {
    expect(run(`'use client';\n\nexport function X() {\n  return <p>Salut</p>;\n}\n`)).toBe(
      `'use client';\n\nimport { useTranslations } from 'next-intl';\n\nexport function X() {\n  const t = useTranslations('X');\n  return <p>{t('salut')}</p>;\n}\n`,
    );
  });

  it('respecte guillemets doubles, absence de ; et tabulations', () => {
    const out = run(`import { a } from "./a"\n\nexport function X() {\n\treturn <p>Salut</p>\n}\n`);
    expect(out).toBe(
      `import { a } from "./a"\nimport { useTranslations } from "next-intl"\n\nexport function X() {\n\tconst t = useTranslations("X")\n\treturn <p>{t("salut")}</p>\n}\n`,
    );
  });

  it('corps-expression multi-ligne → bloc', () => {
    const out = run(`export const X = () => (\n  <div>\n    <p>Salut</p>\n  </div>\n);\n`);
    expect(out).toBe(
      `import { useTranslations } from 'next-intl';\n\nexport const X = () => {\n  const t = useTranslations('X');\n  return (\n  <div>\n    <p>{t('salut')}</p>\n  </div>\n);\n};\n`,
    );
    expect(syntaxErrors(out)).toBe(0);
  });

  it('garde les espaces significatifs', () => {
    expect(run(`export function X() {\n  return <p><b> Gras </b>et<i>Italique</i></p>;\n}\n`)).toContain(
      `<p><b>{' '}{t('gras')}{' '}</b>{t('et')}<i>{t('italique')}</i></p>`,
    );
  });

  it('plusieurs composants dans un fichier', () => {
    const out = run(`export function A() {\n  return <p>Un</p>;\n}\nexport function B() {\n  return <p>Deux</p>;\n}\n`);
    expect(out).toContain(`const t = useTranslations('A');`);
    expect(out).toContain(`const t = useTranslations('B');`);
    expect(out.match(/import/g)).toHaveLength(1);
  });

  it('échappe les guillemets dans les clés existantes', () => {
    expect(run(`export function X() {\n  return <p>Salut</p>;\n}\n`, { X: { "l'autre": 'Salut' } })).toContain(
      `{t('l\\'autre')}`,
    );
  });
});
