import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { Node, Project, type SourceFile, SyntaxKind, ts } from "ts-morph";
import { listSourceFiles } from "../extract/files";
import {
  applyEdits,
  declaration,
  detectStyle,
  type Edit,
  importEdits,
} from "../transform";
import type { Config, Switcher } from "../utils/config";
import { UserError } from "../utils/errors";
import type { Project as NextProject } from "../utils/project";
import type { VirtualFS } from "../utils/vfs";

/** Version de next-intl dont l'API a été vérifiée (doc lue le 2026-11-17). */
export const NEXT_INTL_VERSION = "^4.15.1";

/** Fichiers et dossiers qui restent à la racine de app/ (hors [locale]). */
const STAYS_IN_APP =
  /^(\[locale\]|api|favicon\.ico|(icon|apple-icon|robots|sitemap|manifest|global-error|global-not-found)(\.\w+)?)$/;

export interface SetupResult {
  /** package.json modifié : il faut lancer l'installation après commit. */
  needsInstall: boolean;
  warnings: string[];
}

/**
 * Configure next-intl (idempotent) : app/ → app/[locale]/, layout racine, i18n/, proxy,
 * plugin dans next.config, dépendance, Link localisés. Tout passe par le VirtualFS.
 */
export function setupNextIntl(
  vfs: VirtualFS,
  project: NextProject,
  config: Config,
): SetupResult {
  const warnings: string[] = [];
  const base = project.srcDir ? `${project.srcDir}/` : "";
  const app = `${base}app`;
  const locales = [config.sourceLocale, ...config.targetLocales];

  // Les types de routes générés par next dev / next build pointent vers les anciens chemins.
  if (moveToLocale(vfs, app) && existsSync(join(vfs.root, ".next"))) {
    warnings.push(
      "Supprime le cache de Next avant de relancer (il référence les anciens chemins de app/) : rm -rf .next",
    );
  }
  const layout = ["tsx", "jsx", "js"]
    .map((e) => `${app}/[locale]/layout.${e}`)
    .find((f) => vfs.exists(f));
  if (!layout)
    throw new UserError(
      `Layout racine introuvable (${app}/layout.tsx) : structure non gérée.`,
    );
  adaptLayout(vfs, layout, `${base}i18n/routing`, warnings);
  addSwitcher(vfs, layout, base, config, warnings);

  writeRouting(
    vfs,
    `${base}i18n/routing.ts`,
    locales,
    config.sourceLocale,
    warnings,
  );
  createIfMissing(vfs, `${base}i18n/request.ts`, requestFile(project, base));
  createIfMissing(vfs, `${base}i18n/navigation.ts`, NAVIGATION);
  writeProxy(vfs, project, base, warnings);
  wrapNextConfig(vfs, warnings);
  localizeLinks(vfs, config, `${base}i18n/navigation`);
  return { needsInstall: addDependency(vfs), warnings };
}

// ---------------------------------------------------------------------------
// app/ → app/[locale]/

/** Renvoie true si des fichiers ont été déplacés. */
function moveToLocale(vfs: VirtualFS, app: string): boolean {
  const files = vfs.list(app);
  if (files.some((f) => f.startsWith(`${app}/[locale]/`))) return false; // déjà fait
  const moved = (rel: string) => !STAYS_IN_APP.test(rel.split("/")[0]);

  for (const file of files) {
    const rel = file.slice(app.length + 1);
    if (!moved(rel)) continue;
    const target = `${app}/[locale]/${rel}`;
    const fix = /\.(tsx?|jsx?|mjs|cjs)$/.test(file)
      ? fixRelativeImports
      : /\.(css|scss|sass|less)$/.test(file)
        ? fixCssPaths
        : undefined;
    if (fix) {
      const fixed = fix(vfs.read(file)!, file, target, (path) => {
        const inApp = path.startsWith(`${app}/`)
          ? path.slice(app.length + 1)
          : undefined;
        return inApp !== undefined && moved(inApp)
          ? `${app}/[locale]/${inApp}`
          : path;
      });
      vfs.move(file, target, fixed);
    } else vfs.move(file, target);
  }
  return true;
}

/**
 * Chemins relatifs d'une feuille de style déplacée : @import, @use, @forward,
 * directives Tailwind v4 (@source, @config, @plugin, @reference) et url().
 */
function fixCssPaths(
  text: string,
  from: string,
  to: string,
  newPath: (path: string) => string,
): string {
  return text.replace(
    /(@(?:import|use|forward|source(?:\s+not)?|config|plugin|reference)\s+(?:url\(\s*)?|url\(\s*)(["']?)(\.\.?\/[^"')\s]*)\2/g,
    (_, prefix: string, quote: string, value: string) => {
      const rel = relativeImport(to, newPath(posix.join(posix.dirname(from), value)));
      return prefix + quote + rel + quote;
    },
  );
}

/** Recalcule les imports relatifs d'un fichier déplacé de `from` vers `to`. */
function fixRelativeImports(
  text: string,
  from: string,
  to: string,
  newPath: (path: string) => string,
): string {
  const sf = parse(from, text);
  const edits: Edit[] = [];
  for (const decl of [
    ...sf.getImportDeclarations(),
    ...sf.getExportDeclarations(),
  ]) {
    const spec = decl.getModuleSpecifier();
    const value = spec?.getLiteralText();
    if (!spec || !value?.startsWith(".")) continue;
    const target = newPath(posix.join(posix.dirname(from), value));
    const rel = relativeImport(to, target);
    if (rel !== value) {
      const quote = spec.getText()[0];
      edits.push({
        start: spec.getStart(),
        end: spec.getEnd(),
        text: quote + rel + quote,
      });
    }
  }
  return applyEdits(text, edits);
}

function relativeImport(fromFile: string, target: string): string {
  const rel = posix.relative(posix.dirname(fromFile), target);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

// ---------------------------------------------------------------------------
// Layout racine : async, locale via getLocale(), <html lang>, NextIntlClientProvider, generateStaticParams.

function adaptLayout(
  vfs: VirtualFS,
  file: string,
  routing: string,
  warnings: string[],
): void {
  const text = vfs.read(file)!;
  if (text.includes("NextIntlClientProvider")) return;
  const sf = parse(file, text);
  const style = detectStyle(sf);
  const fn = defaultExportedFunction(sf);
  if (!fn) {
    warnings.push(
      `${file} : export par défaut introuvable, ajoute NextIntlClientProvider à la main.`,
    );
    return;
  }

  const edits: Edit[] = [];
  if (!fn.isAsync()) {
    const at = Node.isFunctionDeclaration(fn)
      ? fn.getFirstChildByKindOrThrow(SyntaxKind.FunctionKeyword)
      : fn;
    edits.push({ start: at.getStart(), end: at.getStart(), text: "async " });
  }
  edits.push(
    ...declaration(fn, `const locale = await getLocale()${style.semi}`, style),
  );

  const html = fn
    .getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
    .find((e) => e.getTagNameNode().getText() === "html");
  const lang = html?.getAttribute("lang");
  if (Node.isJsxAttribute(lang) && lang.getInitializer()) {
    const init = lang.getInitializerOrThrow();
    edits.push({
      start: init.getStart(),
      end: init.getEnd(),
      text: "{locale}",
    });
  } else if (html) {
    const tag = html.getTagNameNode();
    edits.push({
      start: tag.getEnd(),
      end: tag.getEnd(),
      text: " lang={locale}",
    });
  }

  const body = fn
    .getDescendantsOfKind(SyntaxKind.JsxElement)
    .find((e) => e.getOpeningElement().getTagNameNode().getText() === "body");
  if (body) {
    const open = body.getOpeningElement().getEnd();
    const close = body.getClosingElement().getStart();
    edits.push({ start: open, end: open, text: "<NextIntlClientProvider>" });
    edits.push({ start: close, end: close, text: "</NextIntlClientProvider>" });
  } else {
    warnings.push(
      `${file} : <body> introuvable, entoure le contenu de <NextIntlClientProvider> à la main.`,
    );
  }

  if (
    !sf.getFunction("generateStaticParams") &&
    !sf.getVariableDeclaration("generateStaticParams")
  ) {
    const end = text.length;
    const sep = text.endsWith("\n") ? "\n" : "\n\n";
    edits.push({
      start: end,
      end,
      text: `${sep}export function generateStaticParams() {\n${style.unit}return routing.locales.map((locale) => ({ locale }))${style.semi}\n}\n`,
    });
  }

  edits.push(
    ...importEdits(sf, "next-intl", ["NextIntlClientProvider"], style),
  );
  edits.push(...importEdits(sf, "next-intl/server", ["getLocale"], style));
  edits.push(
    ...importEdits(sf, relativeImport(file, routing), ["routing"], style),
  );
  vfs.write(file, applyEdits(text, edits));
}

type FunctionLike = Node & { getBody(): Node | undefined; isAsync(): boolean };

/** `export default function X` ou `export default X` (fonction ou arrow déclarée plus haut). */
function defaultExportedFunction(sf: SourceFile): FunctionLike | undefined {
  const declared = sf.getFunctions().find((f) => f.isDefaultExport());
  if (declared) return declared;
  const expr = sf
    .getExportAssignment((e) => !e.isExportEquals())
    ?.getExpression();
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))
    return expr;
  if (!Node.isIdentifier(expr)) return;
  const name = expr.getText();
  const fn = sf.getFunction(name);
  if (fn) return fn;
  const init = sf.getVariableDeclaration(name)?.getInitializer();
  if (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
    return init;
}

// ---------------------------------------------------------------------------
// i18n/, proxy, next.config, package.json

function writeRouting(
  vfs: VirtualFS,
  file: string,
  locales: string[],
  defaultLocale: string,
  warnings: string[],
): void {
  const list = `[${locales.map((l) => `'${l}'`).join(", ")}]`;
  const current = vfs.read(file);
  if (current === undefined) {
    vfs.write(
      file,
      `import { defineRouting } from 'next-intl/routing';\n\nexport const routing = defineRouting({\n  locales: ${list},\n  defaultLocale: '${defaultLocale}',\n});\n`,
    );
    return;
  }
  if (
    !/locales:\s*\[[^\]]*\]/.test(current) ||
    !/defaultLocale:\s*['"][^'"]*['"]/.test(current)
  ) {
    warnings.push(
      `${file} : locales introuvables, mets-les à jour à la main (${list}).`,
    );
    return;
  }
  vfs.write(
    file,
    current
      .replace(/locales:\s*\[[^\]]*\]/, `locales: ${list}`)
      .replace(
        /defaultLocale:\s*['"][^'"]*['"]/,
        `defaultLocale: '${defaultLocale}'`,
      ),
  );
}

/**
 * Next ≥ 16.3 : locale via next/root-params (rendu statique sans setRequestLocale).
 * Avant : requestLocale, avec repli sur la langue par défaut.
 * ponytail: avant 16.3 les pages sont rendues dynamiquement (pas de setRequestLocale par page).
 */
function requestFile(project: NextProject, base: string): string {
  const messages = `${base ? "../../" : "../"}messages/\${locale}.json`;
  const rootParams =
    project.next.major > 16 ||
    (project.next.major === 16 && project.next.minor >= 3);
  if (rootParams) {
    return `import * as rootParams from 'next/root-params';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ locale }) => {
  if (!locale) {
    const param = await rootParams.locale();
    if (hasLocale(routing.locales, param)) locale = param;
    else notFound();
  }
  return {
    locale,
    messages: (await import(\`${messages}\`)).default,
  };
});
`;
  }
  return `import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(\`${messages}\`)).default,
  };
});
`;
}

const NAVIGATION = `import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
`;

// ---------------------------------------------------------------------------
// Sélecteur de langue

/** « Langue » dans la langue source : le libellé est ensuite extrait et traduit comme le reste. */
const LANGUAGE_WORD: Record<string, string> = {
  fr: "Langue",
  en: "Language",
  es: "Idioma",
  de: "Sprache",
  it: "Lingua",
  pt: "Idioma",
  nl: "Taal",
  pl: "Język",
  ru: "Язык",
  tr: "Dil",
  ar: "اللغة",
  zh: "语言",
  ja: "言語",
  ko: "언어",
};

const CORNERS: Record<Exclude<Switcher, "none">, string> = {
  "top-right": "top: 16, right: 16",
  "top-left": "top: 16, left: 16",
  "bottom-right": "bottom: 16, right: 16",
  "bottom-left": "bottom: 16, left: 16",
};
const POSITION_RE = /position: 'fixed', \w+: 16, \w+: 16/;

const switcherFile = (label: string, corner: string) => `'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '../i18n/navigation';
import { routing } from '../i18n/routing';

type Locale = (typeof routing.locales)[number];

/** Sélecteur de langue ajouté par ye-xperience-i18n : position et style modifiables librement. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      aria-label="${label}"
      value={locale}
      onChange={(e) => router.replace(pathname, { locale: e.target.value as Locale })}
      style={{ position: 'fixed', ${corner}, zIndex: 50 }}
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {languageName(l)}
        </option>
      ))}
    </select>
  );
}

/** Nom de la langue dans cette langue : Français, English… */
function languageName(locale: string): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
`;

/**
 * Crée components/LocaleSwitcher.tsx et l'affiche dans le layout. Relancé avec un autre coin :
 * déplace le sélecteur, sauf si le style a été modifié à la main.
 */
function addSwitcher(
  vfs: VirtualFS,
  layout: string,
  base: string,
  config: Config,
  warnings: string[],
): void {
  if (!config.switcher || config.switcher === "none") return;
  const file = `${base}components/LocaleSwitcher.tsx`;
  const corner = CORNERS[config.switcher];
  const existing = vfs.read(file);
  if (existing === undefined) {
    const label =
      LANGUAGE_WORD[config.sourceLocale.split("-")[0]] ?? "Language";
    vfs.write(file, switcherFile(label, corner));
  } else {
    vfs.write(
      file,
      existing.replace(POSITION_RE, `position: 'fixed', ${corner}`),
    );
  }

  const text = vfs.read(layout)!;
  if (text.includes("LocaleSwitcher")) return;
  const anchor =
    /<NextIntlClientProvider\b[^>]*>/.exec(text) ?? /<body\b[^>]*>/.exec(text);
  if (!anchor) {
    warnings.push(
      `${layout} : ajoute <LocaleSwitcher /> à la main (depuis ${file}).`,
    );
    return;
  }
  const sf = parse(layout, text);
  const at = anchor.index + anchor[0].length;
  vfs.write(
    layout,
    applyEdits(text, [
      { start: at, end: at, text: "<LocaleSwitcher />" },
      ...importEdits(
        sf,
        relativeImport(layout, `${base}components/LocaleSwitcher`),
        ["LocaleSwitcher"],
        detectStyle(sf),
      ),
    ]),
  );
}

function createIfMissing(vfs: VirtualFS, file: string, content: string): void {
  if (!vfs.exists(file)) vfs.write(file, content);
}

/** proxy.ts (Next ≥ 16) ou middleware.ts ; un fichier existant n'est jamais écrasé. */
function writeProxy(
  vfs: VirtualFS,
  project: NextProject,
  base: string,
  warnings: string[],
): void {
  const existing = ["proxy", "middleware"]
    .flatMap((n) => ["ts", "js"].map((e) => `${base}${n}.${e}`))
    .find((f) => vfs.exists(f));
  if (existing) {
    if (!vfs.read(existing)!.includes("next-intl/middleware")) {
      warnings.push(
        `${existing} existe déjà : ajoute-y createMiddleware(routing) de next-intl à la main.`,
      );
    }
    return;
  }
  vfs.write(
    `${base}${project.next.major >= 16 ? "proxy" : "middleware"}.ts`,
    `import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Toutes les routes sauf api, trpc, _next, _vercel et les fichiers (avec un point).
  matcher: '/((?!api|trpc|_next|_vercel|.*\\\\..*).*)',
};
`,
  );
}

function wrapNextConfig(vfs: VirtualFS, warnings: string[]): void {
  const file = ["ts", "mts", "mjs", "js", "cjs"]
    .map((e) => `next.config.${e}`)
    .find((f) => vfs.exists(f));
  if (!file) {
    vfs.write(
      "next.config.mjs",
      `import createNextIntlPlugin from 'next-intl/plugin';\n\nconst withNextIntl = createNextIntlPlugin();\n\nexport default withNextIntl({});\n`,
    );
    return;
  }
  const text = vfs.read(file)!;
  if (text.includes("next-intl/plugin")) return;
  const sf = parse(file, text);
  const style = detectStyle(sf);
  const edits: Edit[] = [];

  const exported = sf.getExportAssignment((e) => !e.isExportEquals());
  const cjs = sf
    .getStatements()
    .find(
      (s) =>
        Node.isExpressionStatement(s) &&
        /^module\.exports\s*=/.test(s.getText()),
    )
    ?.getFirstDescendantByKind(SyntaxKind.BinaryExpression);
  const statement = exported ?? cjs?.getParent();
  const value = exported?.getExpression() ?? cjs?.getRight();
  if (!statement || !value) {
    warnings.push(
      `${file} : export introuvable, entoure ta config de createNextIntlPlugin() à la main.`,
    );
    return;
  }

  edits.push({
    start: value.getStart(),
    end: value.getEnd(),
    text: `withNextIntl(${value.getText()})`,
  });
  edits.push({
    start: statement.getStart(),
    end: statement.getStart(),
    text: `const withNextIntl = createNextIntlPlugin()${style.semi}\n\n`,
  });
  const line = exported
    ? `import createNextIntlPlugin from ${style.q("next-intl/plugin")}${style.semi}`
    : `const createNextIntlPlugin = require(${style.q("next-intl/plugin")})${style.semi}`;
  const lastImport = sf.getImportDeclarations().at(-1);
  if (lastImport)
    edits.push({
      start: lastImport.getEnd(),
      end: lastImport.getEnd(),
      text: `\n${line}`,
    });
  else edits.push({ start: 0, end: 0, text: `${line}\n\n` });
  vfs.write(file, applyEdits(text, edits));
}

function addDependency(vfs: VirtualFS): boolean {
  const raw = vfs.read("package.json")!;
  const pkg = JSON.parse(raw);
  if (pkg.dependencies?.["next-intl"] || pkg.devDependencies?.["next-intl"])
    return false;
  const deps = { ...pkg.dependencies, "next-intl": NEXT_INTL_VERSION };
  pkg.dependencies = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)),
  );
  const indent = /^([ \t]+)"/m.exec(raw)?.[1] ?? "  ";
  vfs.write("package.json", JSON.stringify(pkg, null, indent) + "\n");
  return true;
}

// ---------------------------------------------------------------------------
// next/link → Link de i18n/navigation (garde la locale courante dans les liens)

function localizeLinks(
  vfs: VirtualFS,
  config: Config,
  navigation: string,
): void {
  for (const file of listSourceFiles(vfs, config)) {
    const text = vfs.read(file)!;
    if (!text.includes("next/link")) continue;
    const sf = parse(file, text);
    const style = detectStyle(sf);
    const edits: Edit[] = [];
    for (const imp of sf.getImportDeclarations()) {
      const name = imp.getDefaultImport()?.getText();
      if (
        imp.getModuleSpecifierValue() !== "next/link" ||
        !name ||
        imp.getNamedImports().length ||
        imp.getNamespaceImport() ||
        imp.isTypeOnly()
      )
        continue;
      const binding = name === "Link" ? "Link" : `Link as ${name}`;
      edits.push({
        start: imp.getStart(),
        end: imp.getEnd(),
        text: `import { ${binding} } from ${style.q(relativeImport(file, navigation))}${style.semi}`,
      });
    }
    vfs.write(file, applyEdits(text, edits));
  }
}

function parse(file: string, text: string): SourceFile {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
  }).createSourceFile(file, text);
}
