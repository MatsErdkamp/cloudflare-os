import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

import { build, type Plugin } from "esbuild";
import ts from "typescript";

import type {
  ContractArtifactHashInput,
  ContractBuildCandidate,
  ContractBuildInputs,
} from "./contract-artifact.js";
import { freezeContractBuildCandidate } from "./contract-artifact.js";
import { DependencyPolicyError, type DependencyPolicy, validateDependencyPolicy } from "./dependency-policy.js";
import { canonicalContractJson, hashArtifact, hashSourceTypes } from "./hash-artifact.js";
import { extractPublicTypesFromModules } from "./public-types.js";
import { CONTRACT_AUTHORING_ABI } from "../authoring/abi.js";
import { ContractCompilationError } from "../runtime/errors.js";
import {createContractRuntimeProfile} from "./current-runtime-profile.js";
import {
  isContractPackageName,
  isExactContractDependencyVersion,
  isWorkerCompatibilityDate,
} from "./validation.js";

/** Complete source and governance input needed to compile one immutable Contract artifact. */
export interface CompileContractInput {
  readonly modules: Readonly<Record<string, string>>;
  readonly mainModule: string;
  readonly sourceTypes: string;
  readonly sourceRootType: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly organizationPolicy?: DependencyPolicy;
}

const AUTHORING_RUNTIME = `export const defineContract = (factory) => factory;`;
const WORKERS_TYPES_PATH = path.join(
  fileURLToPath(import.meta.resolve("@cloudflare/workers-types/experimental")),
  "index.d.ts",
);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRequire = createRequire(path.join(PACKAGE_ROOT, "package.json"));

function dependencyPackageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function installedDependencyRoot(name: string): string | undefined {
  for (const searchPath of packageRequire.resolve.paths(name) ?? []) {
    const packageRoot = path.join(searchPath, ...name.split("/"));
    try {
      const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as
        {name?: unknown};
      if (manifest.name === name) return packageRoot;
    } catch {
      // Continue through Node's package search paths.
    }
  }
  return undefined;
}

function installedDependencyVersion(name: string): string | undefined {
  const packageRoot = installedDependencyRoot(name);
  if (packageRoot) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as
        {version?: unknown};
      return typeof manifest.version === "string" ? manifest.version : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const manifest = packageRequire(`${name}/package.json`) as {version?: unknown};
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

function installedDependencyIntegrity(name: string): string {
  const packageRoot = installedDependencyRoot(name);
  if (!packageRoot) {
    throw new ContractCompilationError(
      "BUNDLE_FAILED",
      `Cannot compute integrity for dependency ${name}; its package manifest is unavailable.`,
    );
  }
  const hash = createHash("sha256");
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, {withFileTypes: true})
      .toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "node_modules") continue;
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(absolute, relative);
      } else if (entry.isFile()) {
        hash.update(`file\0${relative}\0`);
        hash.update(readFileSync(absolute));
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`link\0${relative}\0${readlinkSync(absolute)}\0`);
      }
    }
  };
  visit(packageRoot, "");
  return `sha256-${hash.digest("base64")}`;
}

function normalizeModuleName(name: string): string {
  const normalized = path.posix.normalize(name.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new ContractCompilationError("INVALID_INPUT", `Invalid Contract module path: ${name}`);
  }
  return normalized;
}

function sourceModuleDeclaration(input: CompileContractInput): string {
  return `declare module "contract:source" {\n${input.sourceTypes}\n` +
    `export type Source = ${input.sourceRootType};\n}`;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function createCompilerHost(
  modules: Readonly<Record<string, string>>,
  declarationOutputs: Map<string, string>,
  authoringSpecifier: string,
): ts.CompilerHost {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    allowJs: true,
    checkJs: true,
    skipLibCheck: true,
    declaration: true,
    emitDeclarationOnly: true,
    isolatedModules: false,
  };
  const base = ts.createCompilerHost(options);
  const virtualRoot = path.resolve("/contract");
  const virtualFiles = new Map(Object.entries(modules).map(([name, source]) => [
    path.join(virtualRoot, normalizeModuleName(name)),
    source,
  ]));
  const ambientPath = path.join(virtualRoot, "contract-ambient.d.ts");

  function virtualModule(moduleName: string, containingFile: string): ts.ResolvedModuleFull | undefined {
    if (!moduleName.startsWith(".")) return undefined;
    const candidate = path.resolve(path.dirname(containingFile), moduleName);
    const variants = [
      candidate,
      `${candidate}.ts`,
      `${candidate}.tsx`,
      `${candidate}.js`,
      `${candidate}.d.ts`,
      path.join(candidate, "index.ts"),
      path.join(candidate, "index.tsx"),
      path.join(candidate, "index.js"),
      path.join(candidate, "index.d.ts"),
    ];
    const resolvedFileName = variants.find(fileName => virtualFiles.has(path.resolve(fileName)));
    if (!resolvedFileName) return undefined;
    const extension = resolvedFileName.endsWith(".d.ts") ? ts.Extension.Dts :
      resolvedFileName.endsWith(".tsx") ? ts.Extension.Tsx :
      resolvedFileName.endsWith(".js") ? ts.Extension.Js : ts.Extension.Ts;
    return {resolvedFileName, extension, isExternalLibraryImport: false};
  }

  return {
    ...base,
    fileExists: (fileName) => virtualFiles.has(path.resolve(fileName)) || base.fileExists(fileName),
    readFile: (fileName) => virtualFiles.get(path.resolve(fileName)) ?? base.readFile(fileName),
    getSourceFile: (fileName, languageVersion) => {
      const source = virtualFiles.get(path.resolve(fileName));
      return source === undefined
        ? base.getSourceFile(fileName, languageVersion)
        : ts.createSourceFile(fileName, source, languageVersion, true);
    },
    writeFile: (fileName, text) => declarationOutputs.set(path.resolve(fileName), text),
    getCurrentDirectory: () => virtualRoot,
    resolveModuleNames: (moduleNames, containingFile) => moduleNames.map((moduleName) => {
      if (moduleName === "contract:source" || moduleName === authoringSpecifier) {
        return { resolvedFileName: ambientPath, extension: ts.Extension.Dts };
      }
      const virtual = virtualModule(moduleName, containingFile);
      if (virtual) return virtual;
      return ts.resolveModuleName(
        moduleName,
        path.join(PACKAGE_ROOT, path.basename(containingFile)),
        options,
        base,
      ).resolvedModule;
    }),
  };
}

function compilerProgram(
  input: CompileContractInput,
  authoringDeclaration: string,
  authoringSpecifier: string,
): {
  program: ts.Program;
  mainPath: string;
  declarationOutputs: Map<string, string>;
} {
  const normalizedModules = Object.fromEntries(Object.entries(input.modules).map(([name, source]) =>
    [normalizeModuleName(name), source]));
  const mainModule = normalizeModuleName(input.mainModule);
  if (!(mainModule in normalizedModules)) {
    throw new ContractCompilationError("INVALID_INPUT", `Main module ${mainModule} was not provided.`);
  }

  const ambientName = "contract-ambient.d.ts";
  const allModules = {
    ...normalizedModules,
    [ambientName]: `${authoringDeclaration}\n${sourceModuleDeclaration(input)}`,
  };
  const declarationOutputs = new Map<string, string>();
  const host = createCompilerHost(allModules, declarationOutputs, authoringSpecifier);
  const mainPath = path.resolve("/contract", mainModule);
  const rootNames = [
    ...Object.keys(allModules).map((name) => path.resolve("/contract", name)),
    WORKERS_TYPES_PATH,
  ];
  const program = ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      allowJs: true,
      checkJs: true,
      skipLibCheck: true,
      declaration: true,
      emitDeclarationOnly: true,
    },
    host,
  });
  return { program, mainPath, declarationOutputs };
}

function verifyRequiredExports(program: ts.Program, mainPath: string): void {
  const source = program.getSourceFile(mainPath);
  if (!source) {
    throw new ContractCompilationError("INVALID_INPUT", "Contract main module could not be loaded.");
  }
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(source);
  const exports = symbol ? checker.getExportsOfModule(symbol) : [];
  const defaultExport = exports.find((item) => item.escapedName === "default");
  if (!defaultExport) {
    throw new ContractCompilationError("MISSING_DEFAULT_EXPORT", "Contract module must have a default factory export.");
  }
  const factorySignatures = checker.getTypeOfSymbolAtLocation(defaultExport, source).getCallSignatures();
  if (factorySignatures.length === 0) {
    throw new ContractCompilationError(
      "TYPE_CHECK_FAILED",
      "Contract default export must be a callable factory.",
    );
  }
  const bindingExport = exports.find((item) => item.escapedName === "ContractBinding");
  if (!bindingExport) {
    throw new ContractCompilationError(
      "MISSING_CONTRACT_BINDING",
      "Contract module must export a public type named ContractBinding.",
    );
  }

  const workersModule = checker.getAmbientModules()
    .find((item) => item.name === '"cloudflare:workers"');
  const rpcTargetExport = workersModule && checker.getExportsOfModule(workersModule)
    .find((item) => item.escapedName === "RpcTarget");
  if (!rpcTargetExport) {
    throw new ContractCompilationError(
      "TYPE_CHECK_FAILED",
      "Compiler could not resolve cloudflare:workers RpcTarget.",
    );
  }
  const bindingSymbol = bindingExport.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(bindingExport) : bindingExport;
  const rpcTargetSymbol = rpcTargetExport.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(rpcTargetExport) : rpcTargetExport;
  const bindingType = checker.getDeclaredTypeOfSymbol(bindingSymbol);
  const rpcTargetType = checker.getDeclaredTypeOfSymbol(rpcTargetSymbol);
  if (!checker.isTypeAssignableTo(bindingType, rpcTargetType)) {
    throw new ContractCompilationError(
      "TYPE_CHECK_FAILED",
      "Exported ContractBinding must extend cloudflare:workers RpcTarget.",
    );
  }
  if (!factorySignatures.every((signature) => {
    const returnType = checker.getReturnTypeOfSignature(signature);
    const binding = checker.getAwaitedType(returnType) ?? returnType;
    return checker.isTypeAssignableTo(binding, bindingType);
  })) {
    throw new ContractCompilationError(
      "TYPE_CHECK_FAILED",
      "Contract default factory must return the exported ContractBinding type.",
    );
  }
}

function inMemoryPlugin(
  modules: Readonly<Record<string, string>>,
  mainModule: string,
  dependencies: Readonly<Record<string, string>>,
  authoringSpecifier: string,
): Plugin {
  const normalized = new Map(Object.entries(modules).map(([name, source]) =>
    [normalizeModuleName(name), source]));
  return {
    name: "contract-modules",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@gadgets\/contractors(?:\/authoring)?$/ }, (args) =>
        args.path === authoringSpecifier ? {
          path: "authoring-runtime",
          namespace: "contract-authoring",
        } : {
          errors: [{text: `Contract must import its exact authoring ABI from ${authoringSpecifier}.`}],
        });
      buildApi.onLoad({ filter: /.*/, namespace: "contract-authoring" }, () => ({
        contents: AUTHORING_RUNTIME,
        loader: "js",
      }));
      buildApi.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point") {
          return { path: normalizeModuleName(mainModule), namespace: "contract-source" };
        }
        if (args.namespace === "contract-source" && (args.path.startsWith(".") || args.path.startsWith("/"))) {
          const candidate = normalizeModuleName(path.posix.join(path.posix.dirname(args.importer), args.path));
          const variants = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`];
          const resolved = variants.find((variant) => normalized.has(variant));
          return resolved ? { path: resolved, namespace: "contract-source" } : undefined;
        }
        if (args.namespace === "contract-source") {
          if (args.path === "cloudflare:workers") {
            return {path: args.path, external: true};
          }
          const packageName = dependencyPackageName(args.path);
          const declaredVersion = dependencies[packageName];
          if (declaredVersion === undefined) {
            return {errors: [{text: `Dependency ${packageName} must be declared with an exact version.`}]};
          }
          const installedVersion = installedDependencyVersion(packageName);
          if (installedVersion !== declaredVersion) {
            return {errors: [{text: installedVersion
              ? `Dependency ${packageName}@${installedVersion} does not match declared version ${declaredVersion}.`
              : `Dependency ${packageName}@${declaredVersion} is not installed in the compiler environment.`}]};
          }
          return buildApi.resolve(args.path, {kind: args.kind, resolveDir: PACKAGE_ROOT});
        }
        return undefined;
      });
      buildApi.onLoad({ filter: /.*/, namespace: "contract-source" }, (args) => {
        const contents = normalized.get(args.path);
        if (contents === undefined) return undefined;
        const extension = path.posix.extname(args.path);
        const loader = extension === ".tsx" ? "tsx" : extension === ".js" ? "js" : "ts";
        return { contents, loader };
      });
    },
  };
}

interface CompiledContractExecutable {
  readonly mainModule: "contract.js";
  readonly modules: Readonly<Record<string, string>>;
  readonly publicTypes: string;
  readonly publicRootType: "ContractBinding";
  readonly sourceTypeHash: string;
  readonly sourceRootType: string;
  readonly dependencies: ReadonlyArray<{
    readonly name: string;
    readonly version: string;
    readonly integrity?: string;
  }>;
}

async function compileContractExecutable(
  input: CompileContractInput,
  authoringDeclaration: string,
  authoringSpecifier: string,
): Promise<CompiledContractExecutable> {
  if (!isWorkerCompatibilityDate(input.compatibilityDate)) {
    throw new ContractCompilationError(
      "INVALID_INPUT",
      `Invalid Workers compatibility date: ${input.compatibilityDate}`,
    );
  }
  for (const [name, version] of Object.entries(input.dependencies)) {
    if (!isContractPackageName(name) || !isExactContractDependencyVersion(version)) {
      throw new ContractCompilationError(
        "INVALID_INPUT",
        `Dependency ${name}@${version} must use an exact npm package name and version.`,
      );
    }
  }
  const maxBundleBytes = input.organizationPolicy?.maxBundleBytes;
  if (maxBundleBytes !== undefined &&
      (!Number.isSafeInteger(maxBundleBytes) || maxBundleBytes < 0)) {
    throw new ContractCompilationError(
      "INVALID_INPUT",
      "Contract bundle byte limit must be a non-negative safe integer.",
    );
  }
  try {
    validateDependencyPolicy(input.dependencies, input.organizationPolicy);
  } catch (error) {
    if (error instanceof DependencyPolicyError) {
      throw new ContractCompilationError(error.code, error.message);
    }
    throw error;
  }

  const { program, mainPath, declarationOutputs } = compilerProgram(
    input,
    authoringDeclaration,
    authoringSpecifier,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    const formatted = diagnostics.map(formatDiagnostic);
    throw new ContractCompilationError("TYPE_CHECK_FAILED", formatted.join("\n"), formatted);
  }
  verifyRequiredExports(program, mainPath);
  program.emit();

  const declarationModules = Object.fromEntries(Array.from(declarationOutputs.entries()).map(
    ([fileName, declaration]) => [
      path.relative("/contract", fileName).replaceAll("\\", "/"), declaration,
    ],
  ));
  const mainDeclarationName = normalizeModuleName(input.mainModule)
    .replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/, ".d.ts");
  if (declarationModules[mainDeclarationName] === undefined) {
    throw new ContractCompilationError("TYPE_CHECK_FAILED", "TypeScript did not emit a public declaration.");
  }
  let publicTypes: string;
  try {
    publicTypes = extractPublicTypesFromModules({
      mainModule: mainDeclarationName,
      modules: declarationModules,
    }, {
      declarations: input.sourceTypes,
      rootType: input.sourceRootType,
    });
  } catch (error) {
    throw new ContractCompilationError(
      "TYPE_CHECK_FAILED",
      error instanceof Error ? error.message : "Could not generate public Contract declarations.",
    );
  }

  let bundled: string;
  try {
    const result = await build({
      stdin: undefined,
      entryPoints: [input.mainModule],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["cloudflare:workers"],
      plugins: [inMemoryPlugin(
        input.modules,
        input.mainModule,
        input.dependencies,
        authoringSpecifier,
      )],
    });
    bundled = result.outputFiles[0]?.text ?? "";
  } catch (error) {
    throw new ContractCompilationError("BUNDLE_FAILED", error instanceof Error ? error.message : String(error));
  }

  const bundleBytes = new TextEncoder().encode(bundled).byteLength;
  if (input.organizationPolicy?.maxBundleBytes !== undefined &&
      bundleBytes > input.organizationPolicy.maxBundleBytes) {
    throw new ContractCompilationError(
      "BUNDLE_TOO_LARGE",
      `Contract bundle is ${bundleBytes} bytes; limit is ${input.organizationPolicy.maxBundleBytes}.`,
    );
  }

  const dependencies = Object.entries(input.dependencies)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => ({
      name,
      version,
      integrity: installedDependencyIntegrity(name),
    }));
  const sourceTypeHash = await hashSourceTypes(input.sourceTypes);
  return {
    mainModule: "contract.js",
    modules: { "contract.js": bundled },
    publicTypes,
    publicRootType: "ContractBinding" as const,
    sourceTypeHash,
    sourceRootType: input.sourceRootType,
    dependencies,
  };
}

function normalizedCompatibilityFlags(flags: readonly string[] | undefined): readonly string[] {
  const normalized = [...(flags ?? [])].toSorted();
  if (normalized.some((flag) => !/^[a-z][a-z0-9_]*$/.test(flag))) {
    throw new ContractCompilationError(
      "INVALID_INPUT",
      "Workers compatibility flags must use lower-case identifier syntax.",
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new ContractCompilationError("INVALID_INPUT", "Workers compatibility flags must be unique.");
  }
  return Object.freeze(normalized);
}

async function textIdentityHash(value: string): Promise<string> {
  return `sha256:${await hashSourceTypes(value)}`;
}

async function valueIdentityHash(value: unknown): Promise<string> {
  return textIdentityHash(canonicalContractJson(value));
}

/** Builds one candidate with exact inputs and trace but no review or approval claim. */
export async function compileContract(
  input: CompileContractInput,
): Promise<ContractBuildCandidate> {
  const compatibilityFlags = normalizedCompatibilityFlags(input.compatibilityFlags);
  const exactInputs: ContractBuildInputs = {
    modules: Object.freeze({ ...input.modules }),
    mainModule: input.mainModule,
    sourceTypes: input.sourceTypes,
    sourceRootType: input.sourceRootType,
    dependencies: Object.freeze({ ...input.dependencies }),
    compatibilityDate: input.compatibilityDate,
    compatibilityFlags,
    ...(input.organizationPolicy === undefined
      ? {}
      : { organizationPolicy: {
        ...input.organizationPolicy,
        ...(input.organizationPolicy.allowedPackages === undefined
          ? {}
          : { allowedPackages: [...input.organizationPolicy.allowedPackages] }),
        ...(input.organizationPolicy.deniedPackages === undefined
          ? {}
          : { deniedPackages: [...input.organizationPolicy.deniedPackages] }),
      } }),
  };
  const executable = await compileContractExecutable(
    input,
    CONTRACT_AUTHORING_ABI,
    "@gadgets/contractors/authoring",
  );
  const runtimeProfile = await createContractRuntimeProfile(
    input.compatibilityDate,
    compatibilityFlags,
  );
  const authoringAbi = runtimeProfile.authoringAbi;
  const runtimeProfileHash = await valueIdentityHash(runtimeProfile);
  const artifactWithoutHash: ContractArtifactHashInput = {
    mainModule: "contract.js",
    modules: executable.modules,
    publicTypes: executable.publicTypes,
    publicRootType: "ContractBinding",
    sourceTypeHash: executable.sourceTypeHash,
    sourceRootType: executable.sourceRootType,
    dependencies: executable.dependencies.map((dependency) => ({
      name: dependency.name,
      version: dependency.version,
      integrity: dependency.integrity ?? "",
    })),
    runtimeProfile,
    runtimeProfileHash,
  };
  const hash = await hashArtifact(artifactWithoutHash);
  const sourceEntries = await Promise.all(Object.entries(input.modules)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(async ([modulePath, source]) => ({
      kind: "sourceModule" as const,
      path: normalizeModuleName(modulePath),
      hash: await textIdentityHash(source),
    })));
  const dependencyEntries = executable.dependencies.map((dependency) => ({
    kind: "dependency" as const,
    path: `${dependency.name}@${dependency.version}`,
    hash: dependency.integrity ?? "",
  }));
  const entries = Object.freeze([
    { kind: "authoringAbi" as const, path: "@gadgets/contractors/authoring", hash: authoringAbi.declarationHash },
    { kind: "sourceTypes" as const, path: "contract:source", hash: await textIdentityHash(input.sourceTypes) },
    ...sourceEntries,
    ...dependencyEntries,
    { kind: "publicTypes" as const, path: "contract.d.ts", hash: await textIdentityHash(executable.publicTypes) },
    { kind: "bundle" as const, path: "contract.js", hash: await textIdentityHash(executable.modules["contract.js"] ?? "") },
    { kind: "runtimeHarness" as const, path: "contract-harness", hash: runtimeProfile.runtimeHarnessHash },
  ]);
  return freezeContractBuildCandidate({
    artifact: { hash, ...artifactWithoutHash },
    inputs: exactInputs,
    trace: { entries, artifactHash: hash },
    creation: { createdAt: new Date().toISOString() },
  });
}
