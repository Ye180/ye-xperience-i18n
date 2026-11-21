import { Node, type SourceFile, SyntaxKind } from 'ts-morph';
import { type Extracted, type ExtractResult, findTranslator, jsxTextValue } from '../extract';
import type { VirtualFS } from '../utils/vfs';

interface Translator {
  name: string;
  namespace: string;
  /** Déjà déclaré dans le composant (relance / sync) : rien à insérer. */
  existing: boolean;
}

/** Modification textuelle sur le source d'origine : remplace [start, end) par text. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Réécrit chaque texte extrait en `{t('cle')}`, déclare `t` en tête de chaque composant
 * concerné et ajoute les imports next-intl. Les fichiers modifiés sont écrits dans le VirtualFS.
 *
 * Tout est calculé comme des modifications textuelles sur l'AST d'origine, puis appliqué
 * de la fin vers le début : la mise en forme du développeur est conservée telle quelle.
 */
export function transform(result: ExtractResult, vfs: VirtualFS): void {
  const byFile = new Map<string, Extracted[]>();
  for (const item of result.items) byFile.set(item.file, [...(byFile.get(item.file) ?? []), item]);

  for (const [file, items] of byFile) {
    const sf = result.project.getSourceFileOrThrow(file);
    const style = detectStyle(sf);
    const edits: Edit[] = [];

    const translators = new Map<Node, Translator>();
    for (const item of items) {
      if (translators.has(item.component)) continue;
      const found = findTranslator(item.component);
      translators.set(
        item.component,
        found
          ? { ...found, existing: true }
          : { name: usesIdentifier(item.component, 't') ? 'tI18n' : 't', namespace: item.namespace, existing: false },
      );
    }

    for (const item of items) edits.push(replacement(item, translators.get(item.component)!.name, style));

    const imports = new Map<string, string[]>();
    for (const [fn, t] of translators) {
      if (t.existing) continue;
      const isAsync = (fn as Node & { isAsync(): boolean }).isAsync();
      const call = isAsync ? 'await getTranslations' : 'useTranslations';
      edits.push(...declaration(fn, `const ${t.name} = ${call}(${style.q(t.namespace)})${style.semi}`, style));
      const [name, module] = isAsync ? ['getTranslations', 'next-intl/server'] : ['useTranslations', 'next-intl'];
      imports.set(module, [...new Set([...(imports.get(module) ?? []), name])]);
    }
    for (const [module, names] of imports) edits.push(...importEdits(sf, module, names, style));

    const text = applyEdits(sf.getFullText(), edits);
    sf.replaceWithText(text);
    vfs.write(file, text);
  }
}

export interface Style {
  /** Une unité d'indentation ('  ', '    ' ou '\t'). */
  unit: string;
  /** Met une chaîne entre les guillemets du fichier. */
  q(s: string): string;
  semi: string;
}

/** Style du fichier : indentation, guillemets (d'après les imports), points-virgules. */
export function detectStyle(sf: SourceFile): Style {
  const text = sf.getFullText();
  const firstImport = sf.getImportDeclarations()[0];
  const quote = firstImport?.getModuleSpecifier().getText()[0] === '"' ? '"' : "'";
  const semi = firstImport && !firstImport.getText().endsWith(';') ? '' : ';';
  return {
    unit: /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ',
    q: (s) => quote + s.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`) + quote,
    semi,
  };
}

function replacement(item: Extracted, t: string, style: Style): Edit {
  const call = `{${t}(${style.q(item.key)})}`;
  if (Node.isJsxAttribute(item.node)) {
    const init = item.node.getInitializerOrThrow();
    return { start: init.getStart(), end: init.getEnd(), text: call };
  }
  // Espaces en bord de texte sans retour à la ligne : rendus par JSX, conservés en {' '}.
  // Avec retour à la ligne : ignorés par JSX, conservés tels quels pour la mise en page.
  const raw = item.node.getFullText();
  const value = jsxTextValue(raw);
  const lead = raw.match(/^\s*/)![0];
  const trail = raw.match(/\s*$/)![0];
  const space = `{${style.q(' ')}}`;
  const before = value.startsWith(' ') ? space : lead.includes('\n') ? lead : '';
  const after = value.endsWith(' ') ? space : trail.includes('\n') ? trail : '';
  return { start: item.node.getPos(), end: item.node.getEnd(), text: before + call + after };
}

/** Indentation de la ligne qui contient pos. */
function lineIndent(text: string, pos: number): string {
  return text.slice(text.lastIndexOf('\n', pos - 1) + 1).match(/^[ \t]*/)![0];
}

/** Déclaration en tête du corps ; un corps-expression `() => <x/>` devient un bloc. */
export function declaration(fn: Node, statement: string, style: Style): Edit[] {
  const text = fn.getSourceFile().getFullText();
  const body = (fn as Node & { getBody(): Node }).getBody();
  if (Node.isBlock(body)) {
    const first = body.getStatements()[0];
    const indent = first ? lineIndent(text, first.getStart()) : lineIndent(text, body.getStart()) + style.unit;
    const pos = body.getStart() + 1;
    return [{ start: pos, end: pos, text: `\n${indent}${statement}` }];
  }
  const outer = lineIndent(text, fn.getStart());
  const inner = outer + style.unit;
  return [
    { start: body.getStart(), end: body.getStart(), text: `{\n${inner}${statement}\n${inner}return ` },
    { start: body.getEnd(), end: body.getEnd(), text: `${style.semi}\n${outer}}` },
  ];
}

/** Ajoute les noms à un import existant du module, sinon un nouvel import après les imports / directives. */
export function importEdits(sf: SourceFile, module: string, names: string[], style: Style): Edit[] {
  const existing = sf.getImportDeclaration(
    (d) => d.getModuleSpecifierValue() === module && !d.isTypeOnly() && d.getNamedImports().length > 0,
  );
  if (existing) {
    const missing = names.filter((n) => !existing.getNamedImports().some((i) => i.getName() === n));
    const last = existing.getNamedImports().at(-1)!;
    return missing.length ? [{ start: last.getEnd(), end: last.getEnd(), text: `, ${missing.join(', ')}` }] : [];
  }
  const line = `import { ${names.join(', ')} } from ${style.q(module)}${style.semi}`;
  const lastImport = sf.getImportDeclarations().at(-1);
  if (lastImport) return [{ start: lastImport.getEnd(), end: lastImport.getEnd(), text: `\n${line}` }];
  let after: Node | undefined; // dernière directive de tête ('use client'…)
  for (const s of sf.getStatements()) {
    if (!Node.isExpressionStatement(s) || !Node.isStringLiteral(s.getExpression())) break;
    after = s;
  }
  if (after) return [{ start: after.getEnd(), end: after.getEnd(), text: `\n\n${line}` }];
  return [{ start: 0, end: 0, text: `${line}\n\n` }];
}

/** Applique les modifications de la fin vers le début (aucune ne se chevauche). */
export function applyEdits(text: string, edits: Edit[]): string {
  const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.start - a.start || b.i - a.i);
  for (const e of sorted) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

function usesIdentifier(fn: Node, name: string): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => id.getText() === name);
}
