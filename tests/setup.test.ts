import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupNextIntl } from '../src/setup';
import type { Config } from '../src/utils/config';
import { detectProject } from '../src/utils/project';
import { VirtualFS } from '../src/utils/vfs';

const config: Config = { sourceLocale: 'fr', targetLocales: ['en'], include: ['src/app', 'src/components'], ignore: [] };
const LAYOUT = `import './globals.css';
import { Header } from '../components/Header';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body><Header />{children}</body></html>;
}
`;

const CSS = `@import 'tailwindcss';
@import '../config/tailwind.css' layer(base);
@import url("../theme.css");
@source "../components";
@source not '../legacy';
@plugin "../lib/plugin.js";
body { background: url(./blog/og.png); mask: url('data:image/svg+xml;utf8,<svg/>'); }
`;

function project(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'ye-i18n-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}
const pkg = (next = '16.4.6') => JSON.stringify({ dependencies: { next, react: '19' } }, null, 2);

describe('setupNextIntl', () => {
  it('projet avec src/ : déplacement, imports relatifs, binaires, fichiers restants', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const root = project({
      'package.json': pkg(),
      'next.config.mjs': 'const nextConfig = { reactStrictMode: true };\nexport default nextConfig;\n',
      'src/app/layout.tsx': LAYOUT,
      'src/app/globals.css': CSS,
      'src/app/page.tsx': "import { x } from '../lib/x';\nimport { y } from './blog/y';\nexport default function Page() { return <p>{x}{y}</p>; }\n",
      'src/app/blog/y.ts': 'export const y = 1;',
      'src/app/blog/og.png': png,
      'src/app/favicon.ico': png,
      'src/app/api/hello/route.ts': 'export const GET = () => new Response();',
      'src/app/sitemap.ts': 'export default function sitemap() { return []; }',
      'src/components/Header.tsx': "import Link from 'next/link';\nexport const Header = () => <Link href=\"/\">x</Link>;\n",
    });
    const vfs = new VirtualFS(root);
    const result = setupNextIntl(vfs, detectProject(root), config);
    expect(result).toEqual({ needsInstall: true, warnings: [] });

    expect(vfs.list('src/app')).toEqual([
      'src/app/[locale]/blog/og.png',
      'src/app/[locale]/blog/y.ts',
      'src/app/[locale]/globals.css',
      'src/app/[locale]/layout.tsx',
      'src/app/[locale]/page.tsx',
      'src/app/api/hello/route.ts',
      'src/app/favicon.ico',
      'src/app/sitemap.ts',
    ]);
    expect(vfs.read('src/app/[locale]/globals.css')).toBe(`@import 'tailwindcss';
@import '../../config/tailwind.css' layer(base);
@import url("../../theme.css");
@source "../../components";
@source not '../../legacy';
@plugin "../../lib/plugin.js";
body { background: url(./blog/og.png); mask: url('data:image/svg+xml;utf8,<svg/>'); }
`);
    expect(vfs.read('src/app/[locale]/page.tsx')).toContain("from '../../lib/x'");
    expect(vfs.read('src/app/[locale]/page.tsx')).toContain("from './blog/y'");
    expect(vfs.read('src/app/[locale]/layout.tsx')).toBe(`import './globals.css';
import { Header } from '../../components/Header';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { routing } from '../../i18n/routing';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return <html lang={locale}><body><NextIntlClientProvider><Header />{children}</NextIntlClientProvider></body></html>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
`);
    expect(vfs.read('src/components/Header.tsx')).toContain("import { Link } from '../i18n/navigation';");
    expect(vfs.read('src/i18n/request.ts')).toContain('../../messages/${locale}.json');
    expect(vfs.read('src/i18n/routing.ts')).toContain("locales: ['fr', 'en'],");
    expect(vfs.exists('src/proxy.ts')).toBe(true);
    expect(vfs.read('next.config.mjs')).toBe(
      "import createNextIntlPlugin from 'next-intl/plugin';\n\nconst nextConfig = { reactStrictMode: true };\nconst withNextIntl = createNextIntlPlugin();\n\nexport default withNextIntl(nextConfig);\n",
    );
    vfs.commit();
    expect(execFileSync('file', [join(root, 'src/app/[locale]/blog/og.png')], { encoding: 'utf8' })).not.toContain('UTF-8');
  });

  it('ajoute le sélecteur de langue et le déplace si on change de coin', () => {
    const root = project({ 'package.json': pkg(), 'app/layout.tsx': LAYOUT, 'components/Header.tsx': '' });
    const cfg: Config = { ...config, include: ['app', 'components'], switcher: 'bottom-left' };
    const vfs = new VirtualFS(root);
    setupNextIntl(vfs, detectProject(root), cfg);
    const switcher = vfs.read('components/LocaleSwitcher.tsx')!;
    expect(switcher).toContain('aria-label="Langue"');
    expect(switcher).toContain("position: 'fixed', bottom: 16, left: 16");
    const layout = vfs.read('app/[locale]/layout.tsx')!;
    expect(layout).toContain('<NextIntlClientProvider><LocaleSwitcher /><Header />');
    expect(layout).toContain("import { LocaleSwitcher } from '../../components/LocaleSwitcher';");
    vfs.commit();

    const again = new VirtualFS(root);
    setupNextIntl(again, detectProject(root), { ...cfg, switcher: 'top-right' });
    expect(again.changedFiles()).toEqual(['components/LocaleSwitcher.tsx']);
    expect(again.read('components/LocaleSwitcher.tsx')).toContain("position: 'fixed', top: 16, right: 16");

    const none = new VirtualFS(project({ 'package.json': pkg(), 'app/layout.tsx': LAYOUT }));
    setupNextIntl(none, detectProject(none.root), { ...cfg, switcher: 'none' });
    expect(none.exists('components/LocaleSwitcher.tsx')).toBe(false);
  });

  it('signale le cache .next à supprimer après le déplacement', () => {
    const root = project({ 'package.json': pkg(), 'app/layout.tsx': LAYOUT, '.next/dev/types/validator.ts': '' });
    const warnings = setupNextIntl(new VirtualFS(root), detectProject(root), config).warnings;
    expect(warnings.some((w) => w.includes('rm -rf .next'))).toBe(true);
  });

  it('est idempotent et met à jour les locales', () => {
    const root = project({ 'package.json': pkg(), 'src/app/layout.tsx': LAYOUT, 'src/components/Header.tsx': '' });
    const first = new VirtualFS(root);
    setupNextIntl(first, detectProject(root), config);
    first.commit();
    const again = new VirtualFS(root);
    expect(setupNextIntl(again, detectProject(root), config).needsInstall).toBe(false);
    expect(again.changedFiles()).toEqual([]);
    setupNextIntl(again, detectProject(root), { ...config, targetLocales: ['en', 'de'] });
    expect(again.changedFiles()).toEqual(['src/i18n/routing.ts']);
    expect(again.read('src/i18n/routing.ts')).toContain("locales: ['fr', 'en', 'de'],");
  });

  it('Next 15, next.config CommonJS, middleware existant', () => {
    const root = project({
      'package.json': pkg('^15.2.0'),
      'next.config.js': "/** @type {import('next').NextConfig} */\nmodule.exports = { output: 'standalone' };\n",
      'middleware.ts': 'export function middleware() {}',
      'app/layout.tsx': LAYOUT.replace('../components', '../components'),
    });
    const vfs = new VirtualFS(root);
    const { warnings } = setupNextIntl(vfs, detectProject(root), { ...config, include: ['app'] });
    expect(warnings).toEqual(['middleware.ts existe déjà : ajoute-y createMiddleware(routing) de next-intl à la main.']);
    expect(vfs.read('middleware.ts')).toBe('export function middleware() {}');
    expect(vfs.exists('proxy.ts')).toBe(false);
    expect(vfs.read('i18n/request.ts')).toContain('requestLocale');
    expect(vfs.read('next.config.js')).toBe(
      "const createNextIntlPlugin = require('next-intl/plugin');\n\n/** @type {import('next').NextConfig} */\nconst withNextIntl = createNextIntlPlugin();\n\nmodule.exports = withNextIntl({ output: 'standalone' });\n",
    );
  });

  it('sans layout racine → erreur claire', () => {
    const root = project({ 'package.json': pkg(), 'app/page.tsx': 'export default function P() { return null; }' });
    expect(() => setupNextIntl(new VirtualFS(root), detectProject(root), { ...config, include: ['app'] })).toThrow(
      /Layout racine introuvable/,
    );
  });
});
