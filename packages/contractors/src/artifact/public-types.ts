import ts from "typescript";

function isTypeStatement(statement: ts.Statement): boolean {
  return ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement);
}

function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) &&
    ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function declarationName(statement: ts.Statement): string | undefined {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
    return statement.name?.text;
  }
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
    return statement.name.text;
  }
  return undefined;
}

function localTypeExport(
  statement: ts.ExportDeclaration,
  declarations: ReadonlyMap<string, ts.Statement>,
): ts.ExportDeclaration | undefined {
  if (statement.moduleSpecifier || !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)) return statement;
  const elements = statement.exportClause.elements.filter((element) => {
    if (element.isTypeOnly) return true;
    const localName = element.propertyName?.text ?? element.name.text;
    const declaration = declarations.get(localName);
    return declaration !== undefined && isTypeStatement(declaration);
  });
  if (elements.length === 0) return undefined;
  return ts.factory.updateExportDeclaration(
    statement,
    statement.modifiers,
    true,
    ts.factory.updateNamedExports(statement.exportClause, elements),
    statement.moduleSpecifier,
    statement.attributes,
  );
}

function publicTypeStatements(source: ts.SourceFile): readonly ts.Statement[] {
  const declarations = new Map<string, ts.Statement>();
  for (const statement of source.statements) {
    const name = declarationName(statement);
    if (name) declarations.set(name, statement);
  }

  const selected = new Set<ts.Statement>();
  const pending: ts.Statement[] = [];
  for (const statement of source.statements) {
    if ((isTypeStatement(statement) && isExported(statement)) || ts.isExportDeclaration(statement)) {
      selected.add(statement);
      pending.push(statement);
    }
  }
  while (pending.length > 0) {
    const statement = pending.pop()!;
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const dependency = declarations.get(node.text);
        if (dependency && !selected.has(dependency)) {
          selected.add(dependency);
          pending.push(dependency);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }

  const result: ts.Statement[] = [];
  for (const statement of source.statements) {
    if (selected.has(statement)) {
      if (ts.isExportDeclaration(statement)) {
        const filtered = localTypeExport(statement, declarations);
        if (filtered) result.push(filtered);
      } else {
        result.push(statement);
      }
    } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text !== "contract:source" &&
        statement.moduleSpecifier.text !== "@gadgets/contractors/authoring") {
      result.push(statement);
    }
  }
  return result;
}

function assertConsumerImport(specifier: string): void {
  if (specifier !== "cloudflare:workers") {
    throw new TypeError(
      `Public Contract types must be self-contained; external import ${specifier} is not allowed.`,
    );
  }
}

/** Source declarations that may be needed by an intentionally Source-bearing public API. */
export interface PublicSourceTypes {
  readonly declarations: string;
  readonly rootType: string;
}

/** Declaration modules emitted for a multi-file Contract, keyed by relative `.d.ts` path. */
export interface PublicTypeModules {
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, string>>;
}

function usedSourceImports(source: ts.SourceFile, statements: readonly ts.Statement[]): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "contract:source") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
  const used = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const imported = imports.get(node.text);
      if (imported) used.set(node.text, imported);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of statements) visit(statement);
  return used;
}

/** Removes executable declarations and includes Source types only when the public API uses them. */
export function extractPublicTypes(
  declarationText: string,
  sourceTypes?: PublicSourceTypes,
): string {
  const source = ts.createSourceFile("contract.d.ts", declarationText, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const statements = publicTypeStatements(source);
  const result = statements.map((statement) =>
    printer.printNode(ts.EmitHint.Unspecified, statement, source));
  for (const statement of statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      assertConsumerImport(statement.moduleSpecifier.text);
    }
  }
  const used = usedSourceImports(source, statements);
  if (used.size > 0) {
    if (!sourceTypes) throw new TypeError("Public types use Source declarations that were not supplied.");
    result.push(sourceTypes.declarations.trim());
    for (const [local, imported] of used) {
      if (imported === "Source") {
        result.push(`export type ${local} = ${sourceTypes.rootType};`);
      } else if (local !== imported) {
        result.push(`export type ${local} = ${imported};`);
      }
    }
  }
  return result.join("\n\n");
}

function resolveRelativeDeclaration(
  fromModule: string,
  specifier: string,
  modules: Readonly<Record<string, string>>,
): string | undefined {
  const parts = fromModule.split("/").slice(0, -1);
  for (const part of specifier.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = parts.join("/");
  const withoutRuntimeExtension = normalized.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/, "");
  return [
    normalized,
    `${normalized}.d.ts`,
    `${withoutRuntimeExtension}.d.ts`,
    `${normalized}/index.d.ts`,
    `${withoutRuntimeExtension}/index.d.ts`,
  ].find((candidate) => modules[candidate] !== undefined);
}

/** Flattens relative declaration dependencies into one complete Consumer-facing type surface. */
export function extractPublicTypesFromModules(
  input: PublicTypeModules,
  sourceTypes?: PublicSourceTypes,
): string {
  const printer = ts.createPrinter({newLine: ts.NewLineKind.LineFeed});
  const visited = new Set<string>();
  const imports = new Set<string>();
  const bodies = new Set<string>();
  const aliases = new Set<string>();
  const sourceAliases = new Map<string, string>();

  const visitModule = (moduleName: string) => {
    if (visited.has(moduleName)) return;
    const declarationText = input.modules[moduleName];
    if (declarationText === undefined) {
      throw new TypeError(`Missing public declaration module: ${moduleName}`);
    }
    visited.add(moduleName);
    const source = ts.createSourceFile(moduleName, declarationText, ts.ScriptTarget.Latest, true);
    const statements = publicTypeStatements(source);

    for (const [local, imported] of usedSourceImports(source, statements)) {
      sourceAliases.set(local, imported);
    }

    for (const statement of statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        if (!specifier.startsWith(".")) {
          assertConsumerImport(specifier);
          imports.add(printer.printNode(ts.EmitHint.Unspecified, statement, source));
          continue;
        }
        const dependency = resolveRelativeDeclaration(moduleName, specifier, input.modules);
        if (!dependency) throw new TypeError(`Missing public declaration for ${specifier}.`);
        visitModule(dependency);
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          throw new TypeError(
            `Namespace import ${bindings.name.text} cannot be flattened in public Contract types.`,
          );
        }
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text;
            if (imported !== element.name.text) {
              aliases.add(`export type ${element.name.text} = ${imported};`);
            }
          }
        }
        continue;
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.startsWith(".")) {
        const dependency = resolveRelativeDeclaration(
          moduleName, statement.moduleSpecifier.text, input.modules,
        );
        if (!dependency) {
          throw new TypeError(`Missing public declaration for ${statement.moduleSpecifier.text}.`);
        }
        visitModule(dependency);
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const imported = element.propertyName?.text ?? element.name.text;
            if (imported !== element.name.text) {
              aliases.add(`export type ${element.name.text} = ${imported};`);
            }
          }
        }
        continue;
      }
      bodies.add(printer.printNode(ts.EmitHint.Unspecified, statement, source));
    }
  };

  visitModule(input.mainModule);
  if (sourceAliases.size > 0) {
    if (!sourceTypes) throw new TypeError("Public types use Source declarations that were not supplied.");
    bodies.add(sourceTypes.declarations.trim());
    for (const [local, imported] of sourceAliases) {
      if (imported === "Source") aliases.add(`export type ${local} = ${sourceTypes.rootType};`);
      else if (local !== imported) aliases.add(`export type ${local} = ${imported};`);
    }
  }
  return [...imports, ...bodies, ...aliases].join("\n\n");
}
