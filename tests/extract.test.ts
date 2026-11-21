import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extract, jsxTextValue } from '../src/extract';
import { globToRegExp, isIgnored, listSourceFiles } from '../src/extract/files';
import { assignKeys, namespaceFromFile, slugify } from '../src/extract/keys';
import type { Config } from '../src/utils/config';
import { VirtualFS } from '../src/utils/vfs';

const FIXTURE = join(import.meta.dirname, 'fixtures/basic');
const config = (o: Partial<Config> = {}): Config => ({
  sourceLocale: 'fr',
  targetLocales: ['en'],
  include: ['app', 'components'],
  ignore: [],
  ...o,
});

/** Projet temporaire à partir de { chemin: contenu }. */
function project(files: Record<string, string>): VirtualFS {
  const root = mkdtempSync(join(tmpdir(), 'ye-i18n-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return new VirtualFS(root);
}
const summary = (vfs: VirtualFS) =>
  extract(vfs, config()).items.map((i) => `${i.namespace}.${i.key}${i.attribute ? `[${i.attribute}]` : ''}=${i.text}`);

describe('extract sur la fixture', () => {
  const result = extract(new VirtualFS(FIXTURE), config());
  const keys = result.items.map((i) => `${i.file}:${i.line} ${i.namespace}.${i.key}`);

  it('collecte textes et attributs avec des clés lisibles', () => {
    expect(keys).toEqual([
      'app/a-propos/page.tsx:9 AboutPage.aPropos',
      'app/a-propos/page.tsx:10 AboutPage.unePetiteEquipePassionneePar',
      'app/contact/page.tsx:6 ContactPage.contactezNous',
      'app/contact/page.tsx:7 ContactPage.votreNom',
      'app/contact/page.tsx:8 ContactPage.jeanDupont',
      'app/contact/page.tsx:9 ContactPage.votreEMail',
      'app/contact/page.tsx:10 ContactPage.vousExempleFr',
      'app/contact/page.tsx:10 ContactPage.adresseEMailValide',
      'app/contact/page.tsx:11 ContactPage.ecrivezVotreMessageIci',
      'app/contact/page.tsx:12 ContactPage.envoyer',
      'app/layout.tsx:16 RootLayout.tousDroitsReserves',
      'app/page.tsx:8 HomePage.bienvenueChezAtelierLumiere',
      'app/page.tsx:10 HomePage.nousFabriquonsDesLampesUniques',
      'app/page.tsx:11 HomePage.logoDeLAtelier',
      'app/page.tsx:12 HomePage.ajouterAuxFavoris',
      'app/page.tsx:16 HomePage.ajouterAuxFavoris',
      'app/page.tsx:21 HomePage.codePromo',
      'app/page.tsx:21 HomePage.lumiere10',
      'app/page.tsx:23 HomePage.nousContacter',
      'components/Badge.tsx:1 Badge.nouveau',
      'components/Counter.tsx:10 Counter.cliquerIci',
      'components/Header.tsx:6 Header.retourALAccueil',
      'components/Header.tsx:7 Header.atelierLumiere',
      'components/Header.tsx:10 Header.accueil',
      'components/Header.tsx:11 Header.aPropos',
      'components/Header.tsx:12 Header.contact',
    ]);
  });

  it('respecte i18n-ignore et met de côté les textes avec variables', () => {
    expect(result.items.some((i) => i.text.includes('Ne pas traduire'))).toBe(false);
    expect(result.skipped.map((s) => `${s.file}:${s.line} ${s.reason} ${s.text}`)).toEqual([
      "app/a-propos/page.tsx:11 variable ans d'expérience",
      'components/Counter.tsx:9 variable Vous avez cliqué',
      'components/Counter.tsx:9 variable fois',
    ]);
  });

  it('renvoie les messages source', () => {
    expect(result.messages.Header).toEqual({
      retourALAccueil: "Retour à l'accueil",
      atelierLumiere: 'Atelier Lumière',
      accueil: 'Accueil',
      aPropos: 'À propos',
      contact: 'Contact',
    });
  });
});

describe('extract : cas particuliers', () => {
  it('composants memo, export par défaut anonyme, noms génériques', () => {
    const vfs = project({
      'app/blog/page.tsx': 'export default function Page() { return <h1>Le blog</h1>; }',
      'app/faq/page.tsx': 'export default () => <h1>Questions</h1>;',
      'components/Card.tsx': "import { memo } from 'react';\nexport const Card = memo(() => <p>Carte</p>);",
    });
    expect(summary(vfs)).toEqual(['BlogPage.leBlog=Le blog', 'FaqPage.questions=Questions', 'Card.carte=Carte']);
  });

  it('réutilise le namespace déjà présent (sync)', () => {
    const vfs = project({
      'components/Nav.tsx': `import { useTranslations } from 'next-intl';
export function Nav() {
  const t = useTranslations('Menu');
  return <nav>{t('accueil')} Nouveau lien</nav>;
}`,
    });
    expect(summary(vfs)).toEqual(['Menu.nouveauLien=Nouveau lien']);
  });

  it('ignore script, nombres, attributs non traduisibles ; décode les entités', () => {
    const vfs = project({
      'app/page.tsx': `export default function Home() {
  return (
    <div className="Texte" id="Titre">
      <script>{'console.log(1)'}</script>
      <style>body {'{}'}</style>
      <p>2024</p>
      <p>L&apos;atelier &amp; co</p>
      <img alt={'Une photo'} />
      <input placeholder={\`Rechercher\`} />
    </div>
  );
}`,
    });
    expect(summary(vfs)).toEqual([
      "Home.lAtelierCo=L'atelier & co",
      'Home.unePhoto[alt]=Une photo',
      'Home.rechercher[placeholder]=Rechercher',
    ]);
  });

  it('JSX hors composant → mis de côté', () => {
    const vfs = project({ 'components/items.tsx': 'export const ITEMS = [<li key="a">Premier</li>];' });
    const result = extract(vfs, config());
    expect(result.items).toEqual([]);
    expect(result.skipped).toMatchObject([{ reason: 'hors-composant', text: 'Premier' }]);
  });

  it('// i18n-ignore exclut la ligne suivante', () => {
    const vfs = project({
      'app/page.tsx': `export default function Home() {
  // i18n-ignore
  const brand = <b>Marque</b>;
  return <p>{brand}<span>Visible</span></p>;
}`,
    });
    expect(summary(vfs)).toEqual(['Home.visible=Visible']);
  });
});

describe('jsxTextValue', () => {
  it('suit les règles d’espaces JSX', () => {
    expect(jsxTextValue('\n      Bonjour\n      le monde\n    ')).toBe('Bonjour le monde');
    expect(jsxTextValue('Code promo : ')).toBe('Code promo : ');
    expect(jsxTextValue('  a\tb  ')).toBe('  a b  ');
    expect(jsxTextValue('\n   \n')).toBe('');
    expect(jsxTextValue('&#233;t&#xE9; &nbsp;&inconnu;')).toBe('été  &inconnu;');
  });
});

describe('clés', () => {
  it('slugify', () => {
    expect(slugify('Écrivez votre message ici')).toBe('ecrivezVotreMessageIci');
    expect(slugify('Un deux trois quatre cinq six')).toBe('unDeuxTroisQuatreCinq');
    expect(slugify('日本語')).toBe('text');
  });
  it('namespaceFromFile', () => {
    expect(namespaceFromFile('app/page.tsx')).toBe('HomePage');
    expect(namespaceFromFile('app/layout.tsx')).toBe('RootLayout');
    expect(namespaceFromFile('src/app/[locale]/(shop)/produits/[slug]/page.tsx')).toBe('ProduitsSlugPage');
    expect(namespaceFromFile('app/à-propos/page.tsx')).toBe('AProposPage');
  });
  it('assignKeys : réutilisation, collisions, messages existants', () => {
    const items = [
      { namespace: 'A', text: 'Bonjour', key: '' },
      { namespace: 'A', text: 'Bonjour !', key: '' },
      { namespace: 'A', text: 'Bonjour', key: '' },
      { namespace: 'A', text: 'Déjà là', key: '' },
    ];
    const existing = { A: { bonjour2: 'Autre', dejaLa: 'Déjà là' } };
    expect(assignKeys(items, existing)).toEqual({
      A: { bonjour2: 'Autre', dejaLa: 'Déjà là', bonjour: 'Bonjour', bonjour3: 'Bonjour !' },
    });
    expect(items.map((i) => i.key)).toEqual(['bonjour', 'bonjour3', 'bonjour', 'dejaLa']);
    expect(existing.A).not.toHaveProperty('bonjour'); // pas de mutation
  });
});

describe('fichiers', () => {
  it('globs', () => {
    expect(globToRegExp('app/**/x.tsx').test('app/x.tsx')).toBe(true);
    expect(globToRegExp('app/**/x.tsx').test('app/a/b/x.tsx')).toBe(true);
    expect(globToRegExp('*.tsx').test('a/b.tsx')).toBe(false);
    expect(isIgnored('app/legacy/old/page.tsx', [globToRegExp('app/legacy')])).toBe(true);
    expect(isIgnored('app/page.tsx', [globToRegExp('app/legacy/**')])).toBe(false);
  });
  it('liste les sources en excluant tests, stories, node_modules et --ignore', () => {
    const vfs = project({
      'app/page.tsx': '',
      'app/page.test.tsx': '',
      'app/legacy/page.tsx': '',
      'app/node_modules/x.js': '',
      'app/style.css': '',
      'components/Button.stories.tsx': '',
      'components/Button.jsx': '',
    });
    expect(listSourceFiles(vfs, config({ ignore: ['app/legacy'] }))).toEqual([
      'app/page.tsx',
      'components/Button.jsx',
    ]);
  });
});

describe('usedKeys', () => {
  it('collecte les clés littérales et repère les namespaces dynamiques', async () => {
    const { usedKeys } = await import('../src/extract');
    const vfs = project({
      'components/A.tsx': `import { useTranslations } from 'next-intl';
export function A({ k }: { k: string }) {
  const t = useTranslations('A');
  return <p>{t('un')}{t.rich('deux', {})}{t(k)}</p>;
}
export async function B() {
  const tI18n = await getTranslations('B');
  return <p title={tI18n('trois')}>{other('x')}</p>;
}`,
    });
    const { used, dynamic } = usedKeys(extract(vfs, config()).sourceFiles);
    expect([...used]).toEqual(['A.un', 'A.deux', 'B.trois']);
    expect([...dynamic]).toEqual(['A']);
  });
});
