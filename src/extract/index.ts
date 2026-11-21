import { Node, Project, type SourceFile, SyntaxKind, ts } from 'ts-morph';
import type { Config } from '../utils/config';
import type { VirtualFS } from '../utils/vfs';
import { listSourceFiles } from './files';
import { assignKeys, type Messages, namespaceFromFile } from './keys';

export type { Messages } from './keys';

export interface Extracted {
  file: string;
  line: number;
  kind: 'text' | 'attribute';
  attribute?: string;
  /** Texte tel qu'affiché (espaces JSX normalisés, entités décodées, sans espaces aux bords). */
  text: string;
  namespace: string;
  key: string;
  /** JsxText ou JsxAttribute à réécrire. */
  node: Node;
  /** Fonction du composant qui contient le texte. */
  component: Node;
}

export interface Skipped {
  file: string;
  line: number;
  text: string;
  /** variable : texte à côté d'une expression {x} (V2) ; hors-composant : JSX hors d'un composant (V2). */
  reason: 'variable' | 'hors-composant';
}

export interface ExtractResult {
  project: Project;
  sourceFiles: SourceFile[];
  items: Extracted[];
  skipped: Skipped[];
  /** Messages source existants + nouveaux textes. */
  messages: Messages;
}

const ATTRIBUTES = new Set(['alt', 'placeholder', 'title', 'aria-label']);
const HAS_LETTER = /\p{L}/u;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
/** Noms trop génériques pour servir de namespace : on prend le chemin du fichier. */
const GENERIC = new Set(['Page', 'Layout', 'Template', 'Loading', 'Error', 'GlobalError', 'NotFound', 'Default']);
const TRANSLATOR = /^t(I18n)?$/;

export function extract(vfs: VirtualFS, config: Config, existing: Messages = {}): ExtractResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
  });
  const sourceFiles: SourceFile[] = [];
  const items: Extracted[] = [];
  const skipped: Skipped[] = [];

  for (const file of listSourceFiles(vfs, config)) {
    const sf = project.createSourceFile(file, vfs.read(file) ?? '', { overwrite: true });
    sourceFiles.push(sf);
    const ignored = ignoredLines(sf.getFullText());

    sf.forEachDescendant((node) => {
      let text: string;
      let attribute: string | undefined;
      let pos: number;

      if (Node.isJsxText(node)) {
        const raw = node.getFullText();
        text = jsxTextValue(raw).replace(/^ +| +$/g, '');
        pos = node.getPos() + raw.search(/\S/);
        if (!HAS_LETTER.test(text) || isInsideTag(node, ['script', 'style'])) return;
      } else if (Node.isJsxAttribute(node)) {
        attribute = node.getNameNode().getText();
        const value = attributeValue(node);
        if (!ATTRIBUTES.has(attribute) || value === undefined || !HAS_LETTER.test(value)) return;
        text = value.trim();
        pos = node.getStart();
      } else return;

      const line = sf.getLineAndColumnAtPos(pos).line;
      if (ignored.has(line)) return;
      if (Node.isJsxText(node) && hasDynamicSibling(node)) {
        return void skipped.push({ file, line, text, reason: 'variable' });
      }
      const component = findComponent(node);
      if (!component) return void skipped.push({ file, line, text, reason: 'hors-composant' });

      items.push({
        file,
        line,
        kind: attribute ? 'attribute' : 'text',
        attribute,
        text,
        namespace:
          findTranslator(component.fn)?.namespace ??
          (component.name && !GENERIC.has(component.name) ? component.name : namespaceFromFile(file)),
        key: '',
        node,
        component: component.fn,
      });
    });
  }

  const messages = assignKeys(items, existing);
  return { project, sourceFiles, items, skipped, messages };
}

/** Texte rendu par un JsxText, selon les règles JSX (cf. Babel cleanJSXElementLiteralChild). */
export function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept: string[] = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, ' ');
    if (i !== 0) l = l.replace(/^ +/, '');
    if (i !== lines.length - 1) l = l.replace(/ +$/, '');
    if (l) kept.push(l);
  });
  return decodeEntities(kept.join(' '));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** Lignes (1-based) exclues : celle d'un commentaire `i18n-ignore` et la suivante. */
function ignoredLines(source: string): Set<number> {
  const lines = new Set<number>();
  source.split('\n').forEach((l, i) => {
    if (/(\/\/|\/\*).*i18n-ignore/.test(l)) lines.add(i + 1).add(i + 2);
  });
  return lines;
}

function attributeValue(attr: Node): string | undefined {
  if (!Node.isJsxAttribute(attr)) return;
  let init: Node | undefined = attr.getInitializer();
  if (Node.isJsxExpression(init)) init = init.getExpression();
  if (Node.isStringLiteral(init)) return decodeEntities(init.getLiteralText());
  if (Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralText();
}

function isInsideTag(node: Node, tags: string[]): boolean {
  const parent = node.getParent();
  return Node.isJsxElement(parent) && tags.includes(parent.getOpeningElement().getTagNameNode().getText());
}

/** Un frère `{expr}` dynamique (pas une chaîne, pas un appel à t) : le texte dépend d'une variable. */
function hasDynamicSibling(node: Node): boolean {
  const parent = node.getParent();
  if (!Node.isJsxElement(parent) && !Node.isJsxFragment(parent)) return false;
  return parent.getJsxChildren().some((child) => {
    if (!Node.isJsxExpression(child)) return false;
    const e = child.getExpression();
    if (!e || Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) return false;
    return !(Node.isCallExpression(e) && TRANSLATOR.test(e.getExpression().getText()));
  });
}

type FunctionNode = Node & { getBody(): Node | undefined };

/** Fonction composant la plus proche : nom en PascalCase, ou export par défaut anonyme. */
function findComponent(node: Node): { fn: FunctionNode; name?: string } | undefined {
  for (const fn of node.getAncestors()) {
    if (!Node.isFunctionDeclaration(fn) && !Node.isFunctionExpression(fn) && !Node.isArrowFunction(fn)) continue;
    const name = functionName(fn);
    if (name && PASCAL.test(name)) return { fn, name };
    if (!name && (Node.isFunctionDeclaration(fn) ? fn.isDefaultExport() : Node.isExportAssignment(fn.getParent()))) {
      return { fn };
    }
  }
}

function functionName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn)) return fn.getName();
  let parent = fn.getParent();
  if (Node.isCallExpression(parent)) parent = parent.getParent(); // memo(() => …), forwardRef(…)
  if (Node.isVariableDeclaration(parent)) return parent.getName();
  if (Node.isFunctionExpression(fn)) return fn.getName();
}

/** `const t = useTranslations('X')` / `await getTranslations('X')` déjà présent dans le composant (sync). */
export function findTranslator(fn: Node): { name: string; namespace: string } | undefined {
  const body = (fn as FunctionNode).getBody();
  if (!Node.isBlock(body)) return;
  for (const decl of body.getVariableStatements().flatMap((s) => s.getDeclarations())) {
    if (!TRANSLATOR.test(decl.getName())) continue;
    let init = decl.getInitializer();
    if (Node.isAwaitExpression(init)) init = init.getExpression();
    if (!Node.isCallExpression(init)) continue;
    const arg = init.getArguments()[0];
    if (Node.isStringLiteral(arg)) return { name: decl.getName(), namespace: arg.getLiteralValue() };
  }
}

/**
 * Clés "Namespace.cle" utilisées par les appels `t('cle')` (et t.rich/markup/raw/has) des composants
 * qui déclarent un traducteur. Un appel avec une clé non littérale rend son namespace "dynamique" :
 * on ne peut pas savoir quelles clés il utilise.
 */
export function usedKeys(sourceFiles: SourceFile[]): { used: Set<string>; dynamic: Set<string> } {
  const used = new Set<string>();
  const dynamic = new Set<string>();
  for (const sf of sourceFiles) {
    sf.forEachDescendant((fn) => {
      if (!Node.isFunctionDeclaration(fn) && !Node.isFunctionExpression(fn) && !Node.isArrowFunction(fn)) return;
      const translator = findTranslator(fn);
      if (!translator) return;
      const callee = new RegExp(`^${translator.name}(\\.(rich|markup|raw|has))?$`);
      for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (!callee.test(call.getExpression().getText())) continue;
        const arg = call.getArguments()[0];
        if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
          used.add(`${translator.namespace}.${arg.getLiteralText()}`);
        } else dynamic.add(translator.namespace);
      }
    });
  }
  return { used, dynamic };
}
