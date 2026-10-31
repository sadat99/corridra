import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// KI-30: every way into operator sign-in is a full page load. A Next <Link> or a router push or
// replace into sign-in is a soft navigation, and Next 16.4.3 then doubles or keeps an old `#` on
// the way back. This walks the syntax tree, so it also sees what the regex scan in
// ux-operator-urls.test.ts cannot: an href held in a variable of the same file or built with an
// operatorSignIn* helper, spread props, next/link imported under another name, a Link with an
// element in an earlier prop, and push or replace on a router from useRouter().
// It does not follow constants or helpers imported from other files or renamed on import, paths
// built in pieces, wrapper components that pass an href on to a Link, or server redirect(). The
// actual fix is that the sign-in form leaves with a full page load; this guard is a backstop.

/**
 * Links that may spread props, each with the reason it cannot reach operator sign-in. A spread
 * hides the href from this guard, so every entry needs a reviewer to read it. Empty on purpose.
 */
export const spreadAllowlist: { path: string; reason: string }[] = [];

const signInPath = '/operator/signin';
const signInHelper = /^operatorSignIn/;

/** Every .ts and .tsx file under `dir`, skipping dependencies and build output. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? ['node_modules', '.next'].includes(entry.name)
        ? []
        : sourceFiles(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );
}

/** The guard over one file: a line per soft navigation that can reach operator sign-in. */
export function signInNavigationFindings(source: string, path: string): string[] {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: string[] = [];
  const report = (node: ts.Node, what: string) =>
    findings.push(
      `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${what}`,
    );

  // Local names for next/link's default export and for useRouter from next/navigation.
  const linkNames = new Set<string>();
  const linkNamespaces = new Set<string>();
  const useRouterNames = new Set<string>();
  const navigationNamespaces = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const from = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    const bindings = clause.namedBindings;
    if (from === 'next/link') {
      if (clause.name) linkNames.add(clause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) linkNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if ((element.propertyName ?? element.name).text === 'default')
            linkNames.add(element.name.text);
    }
    if (from === 'next/navigation') {
      if (bindings && ts.isNamespaceImport(bindings)) navigationNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if ((element.propertyName ?? element.name).text === 'useRouter')
            useRouterNames.add(element.name.text);
    }
  }

  // Every variable initialiser by name, so an href or argument held in a variable is followed.
  const initialisers = new Map<string, ts.Expression[]>();
  const routers = new Set<string>();
  const routerMethods = new Set<string>();
  const isUseRouterCall = (node: ts.Node): boolean =>
    ts.isCallExpression(node) &&
    ((ts.isIdentifier(node.expression) && useRouterNames.has(node.expression.text)) ||
      (ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        navigationNamespaces.has(node.expression.expression.text) &&
        node.expression.name.text === 'useRouter'));
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        initialisers.set(node.name.text, [
          ...(initialisers.get(node.name.text) ?? []),
          node.initializer,
        ]);
        if (isUseRouterCall(node.initializer)) routers.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name) && isUseRouterCall(node.initializer)) {
        // const { push, replace: go } = useRouter()
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(property) &&
            ['push', 'replace'].includes(property.text) &&
            ts.isIdentifier(element.name)
          )
            routerMethods.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  // Whether an expression can name the sign-in page: a string holding its path, a sign-in helper,
  // or a variable whose value does, followed through the file.
  const reaches = (node: ts.Node, seen: Set<string> = new Set()): boolean => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddleOrTemplateTail(node)) &&
      node.text.includes(signInPath)
    )
      return true;
    if (ts.isIdentifier(node)) {
      if (signInHelper.test(node.text)) return true;
      if (!seen.has(node.text)) {
        seen.add(node.text);
        if ((initialisers.get(node.text) ?? []).some((value) => reaches(value, seen))) return true;
      }
    }
    return ts.forEachChild(node, (child) => reaches(child, seen) || undefined) ?? false;
  };

  const isLinkTag = (tag: ts.JsxTagNameExpression) =>
    (ts.isIdentifier(tag) && linkNames.has(tag.text)) ||
    (ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      linkNamespaces.has(tag.expression.text) &&
      tag.name.text === 'default');
  const opensNewTab = (attributes: ts.JsxAttributes) =>
    attributes.properties.some((attribute) => {
      if (!ts.isJsxAttribute(attribute) || attribute.name.getText(file) !== 'target') return false;
      const value = attribute.initializer;
      if (!value) return false;
      if (ts.isStringLiteral(value)) return value.text === '_blank';
      return (
        ts.isJsxExpression(value) &&
        !!value.expression &&
        ts.isStringLiteralLike(value.expression) &&
        value.expression.text === '_blank'
      );
    });
  const isRouterCall = (call: ts.CallExpression) => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return routerMethods.has(callee.text);
    if (!ts.isPropertyAccessExpression(callee) || !['push', 'replace'].includes(callee.name.text))
      return false;
    const target = callee.expression;
    return (ts.isIdentifier(target) && routers.has(target.text)) || isUseRouterCall(target);
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isLinkTag(node.tagName) &&
      !opensNewTab(node.attributes)
    ) {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          if (!spreadAllowlist.some((entry) => entry.path === path))
            report(attribute, 'a Link spreads props, so its href cannot be checked');
        } else if (
          attribute.name.getText(file) === 'href' &&
          attribute.initializer &&
          reaches(attribute.initializer)
        )
          report(attribute, 'a Link goes into operator sign-in; use a plain <a>');
      }
    }
    if (ts.isCallExpression(node) && isRouterCall(node) && node.arguments.some((a) => reaches(a)))
      report(node, 'a router call goes into operator sign-in; use window.location');
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/** The guard over every file under `dir`. */
export function signInNavigationFindingsIn(dir: string): string[] {
  return sourceFiles(dir).flatMap((path) =>
    signInNavigationFindings(readFileSync(resolve(path), 'utf8'), path),
  );
}
