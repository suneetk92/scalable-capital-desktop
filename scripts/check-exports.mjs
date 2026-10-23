import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

function sourceFile(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) => (ts.isBindingElement(element) ? bindingNames(element.name) : []));
  }
  return [];
}

function exportedSymbols(file) {
  const symbols = new Set();
  for (const statement of file.statements) {
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const name = statement.name?.text;
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) symbols.add("default");
      else if (name) symbols.add(name);
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const bound of bindingNames(declaration.name)) symbols.add(bound);
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) symbols.add(element.name.text);
    }
  }
  return symbols;
}

function resolveSource(importer, specifier, files) {
  const base = resolve(dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  return candidates.find((candidate) => files.has(candidate));
}

function identifierIsUsed(file, localName, excluded) {
  let used = false;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === localName && !isWithin(node, excluded)) used = true;
    if (!used) ts.forEachChild(node, visit);
  };
  visit(file);
  return used;
}

function isWithin(node, ancestor) {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

/** Finds exported names with no import or re-export reference from another source file. The exports of `apiFiles` are used outside the scanned files and are never reported. */
export function findUnusedExports(entries, apiFiles = []) {
  const files = new Map(entries.map(({ fileName, text }) => [resolve(fileName), sourceFile(resolve(fileName), text)]));
  const knownFiles = new Set(files.keys());
  const exports = new Map([...files].map(([fileName, file]) => [fileName, exportedSymbols(file)]));
  const used = new Map([...files.keys()].map((fileName) => [fileName, new Set()]));
  const markUsed = (fileName, symbol) => used.get(fileName)?.add(symbol);

  for (const [fileName, file] of files) {
    const markDynamicImports = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0];
        if (specifier && ts.isStringLiteral(specifier)) {
          const importedFile = resolveSource(fileName, specifier.text, knownFiles);
          const chained = node.parent?.parent;
          const callback = ts.isCallExpression(chained) && ts.isPropertyAccessExpression(chained.expression) && chained.expression.name.text === "then" ? chained.arguments[0] : undefined;
          const parameter = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback.parameters[0] : undefined;
          if (!importedFile || !parameter) {
            for (const name of exports.get(importedFile) ?? []) markUsed(importedFile, name);
          } else if (ts.isIdentifier(parameter.name)) {
            const findProperties = (child) => {
              if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === parameter.name.text) {
                markUsed(importedFile, child.name.text);
              } else if (
                ts.isElementAccessExpression(child) &&
                ts.isIdentifier(child.expression) &&
                child.expression.text === parameter.name.text &&
                child.argumentExpression &&
                ts.isStringLiteral(child.argumentExpression)
              ) {
                markUsed(importedFile, child.argumentExpression.text);
              }
              ts.forEachChild(child, findProperties);
            };
            findProperties(callback.body);
          } else if (ts.isObjectBindingPattern(parameter.name)) {
            for (const element of parameter.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              if (identifierIsUsed(callback.body, element.name.text, parameter)) {
                markUsed(importedFile, element.propertyName?.getText().replace(/["']/g, "") ?? element.name.text);
              }
            }
          } else {
            for (const name of exports.get(importedFile) ?? []) markUsed(importedFile, name);
          }
        }
      }
      ts.forEachChild(node, markDynamicImports);
    };
    markDynamicImports(file);
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const importedFile = resolveSource(fileName, statement.moduleSpecifier.text, knownFiles);
        const clause = statement.importClause;
        if (!importedFile || !clause) continue;
        if (clause.name && identifierIsUsed(file, clause.name.text, statement)) markUsed(importedFile, "default");
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          if (identifierIsUsed(file, clause.namedBindings.name.text, statement)) {
            for (const name of exports.get(importedFile) ?? []) markUsed(importedFile, name);
          }
        } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const local = element.name.text;
            const imported = element.propertyName?.text ?? local;
            if (identifierIsUsed(file, local, statement)) markUsed(importedFile, imported);
          }
        }
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const importedFile = resolveSource(fileName, statement.moduleSpecifier.text, knownFiles);
        if (!importedFile) continue;
        if (!statement.exportClause) {
          for (const name of exports.get(importedFile) ?? []) markUsed(importedFile, name);
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            markUsed(importedFile, element.propertyName?.text ?? element.name.text);
          }
        }
      }
    }
  }

  const api = new Set(apiFiles.map((fileName) => resolve(fileName)));
  return [...exports].filter(([fileName]) => !api.has(fileName)).flatMap(([fileName, names]) => [...names].filter((name) => !used.get(fileName)?.has(name)).map((name) => ({ fileName, name })));
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  // The bundled public extension is part of the repository and uses src/ like any other module.
  const entries = [...walk(resolve(root, "src")), ...walk(resolve(root, "extensions/trailing-stops/web"))].map((fileName) => ({
    fileName,
    text: readFileSync(fileName, "utf8"),
  }));
  // The extension API: optional extensions outside src/ import it, so its exports may have no user inside src/.
  const unused = findUnusedExports(entries, [resolve(root, "src/extensions.ts")]);
  if (unused.length) {
    console.error(unused.map(({ fileName, name }) => `- ${relative(root, fileName)}: ${name}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("No unused exports found in src/.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
