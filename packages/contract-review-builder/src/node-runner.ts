import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {delimiter, dirname, join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {
  existsSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {canonicalReviewJson, ReviewEvidenceError} from "./canonical.js";
import {createReviewBuildManifest} from "./builder.js";
import {REVIEW_LIMITS} from "./limits.js";
import type {
  ReviewBuildRunner,
  ReviewBuildRunnerFactory,
  ReviewBuildRunResult,
  LockedReviewBuildManifest,
} from "./types.js";
import type {ContractBuildInputs} from "@gadgets/contractors/artifact";

/** Options for the concrete Node permission-model review runner. */
export interface NodeReviewBuildRunnerFactoryOptions {
  readonly producerIdentity: string;
  readonly timeoutMs?: number;
  /** Conformance-only probe which must be rejected by the child permission boundary. */
  readonly conformanceProbe?: "network" | "undeclaredRead" | "lockedInputDrift";
  /** Loopback target used only by the network-isolation conformance test. */
  readonly conformanceNetworkUrl?: string;
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_PATH = resolve(PACKAGE_ROOT, "dist/node-runner-worker.js");
const CONTRACTORS_ROOT = realpathSync(resolve(PACKAGE_ROOT, "node_modules/@gadgets/contractors"));
const TYPESCRIPT_ROOT = realpathSync(resolve(CONTRACTORS_ROOT, "node_modules/typescript"));
const ESBUILD_ROOT = realpathSync(resolve(CONTRACTORS_ROOT, "node_modules/esbuild"));
const WORKERS_TYPES_ROOT = realpathSync(resolve(CONTRACTORS_ROOT, "node_modules/@cloudflare/workers-types"));
const esbuildManifest = JSON.parse(readFileSync(resolve(ESBUILD_ROOT, "package.json"), "utf8")) as
  {optionalDependencies?: Record<string, string>};
const ESBUILD_NATIVE_ROOT = Object.keys(esbuildManifest.optionalDependencies ?? {}).map(name => {
  try {
    return resolveInstalledPackageRoot(name, ESBUILD_ROOT);
  } catch {
    return undefined;
  }
}).find((root): root is string => root !== undefined && existsSync(resolve(root, "bin/esbuild")));
if (!ESBUILD_NATIVE_ROOT) throw new Error("The native esbuild package is unavailable.");

function isolatedNodeCommand(nodeArgs: readonly string[]): readonly [string, readonly string[]] {
  if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
    return [
      "/usr/bin/sandbox-exec",
      ["-p", "(version 1)(allow default)(deny network*)", process.execPath, ...nodeArgs],
    ];
  }
  for (const executable of ["/usr/bin/bwrap", "/bin/bwrap"]) {
    if (process.platform === "linux" && existsSync(executable)) {
      return [
        executable,
        ["--unshare-net", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
          process.execPath, ...nodeArgs],
      ];
    }
  }
  throw new ReviewEvidenceError(
    "ISOLATION_FAILED",
    "No supported operating-system network isolation boundary is available.",
  );
}

interface ResolvedPackageClosureEntry {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  readonly dependencies: readonly string[];
  readonly packageContentHash: string;
}

interface LockedToolchainRoot {
  readonly name: string;
  readonly root: string;
  readonly contentRoot?: string;
  readonly identity: string;
}

function hashTree(root: string): string {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, {withFileTypes: true})
      .toSorted((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const absolute = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        const size = statSync(absolute).size;
        fileCount += 1;
        totalBytes += size;
        if (fileCount > 100_000 || totalBytes > 512 * 1024 * 1024) {
          throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Package content exceeds the locking limit.");
        }
        hash.update(`file\0${relative}\0`);
        hash.update(readFileSync(absolute));
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`link\0${relative}\0${readlinkSync(absolute)}\0`);
      }
    }
  };
  visit(realpathSync(root), "");
  return `sha256:${hash.digest("hex")}`;
}

function packageName(root: string): string {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {name?: unknown};
  if (typeof manifest.name !== "string") {
    throw new ReviewEvidenceError("INVALID_INPUT", "Toolchain package has no stable name.");
  }
  return manifest.name;
}

function nodeToolchainComponent(): Readonly<{name: string; identity: string}> {
  return {
    name: "node",
    identity: `sha256:${createHash("sha256").update(readFileSync(process.execPath)).digest("hex")}`,
  };
}



function resolveInstalledPackageRoot(name: string, issuerRoot: string): string {
  const requireFromIssuer = createRequire(join(issuerRoot, "package.json"));
  for (const searchPath of requireFromIssuer.resolve.paths(name) ?? []) {
    const candidate = join(searchPath, ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
  }
  throw new ReviewEvidenceError("INVALID_INPUT", `Locked dependency ${name} is not installed.`);
}

function resolvePackageClosure(direct: Readonly<Record<string, string>>): ResolvedPackageClosureEntry[] {
  const entries = new Map<string, ResolvedPackageClosureEntry>();
  const visit = (name: string, issuerRoot: string, expectedVersion?: string): string => {
    const root = resolveInstalledPackageRoot(name, issuerRoot);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    if (manifest.name !== name || typeof manifest.version !== "string" ||
        (expectedVersion !== undefined && manifest.version !== expectedVersion)) {
      throw new ReviewEvidenceError("INVALID_INPUT", `Locked dependency ${name} drifted.`);
    }
    const id = `${name}@${manifest.version}`;
    const existing = entries.get(id);
    if (existing) {
      if (existing.root !== root) {
        throw new ReviewEvidenceError("INVALID_INPUT", `Dependency closure has ambiguous ${id}.`);
      }
      return id;
    }
    if (entries.size >= REVIEW_LIMITS.dependencyEntries) {
      throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Dependency closure exceeds the protocol limit.");
    }
    // Reserve the node before recursion so dependency cycles terminate.
    entries.set(id, {
      name,
      version: manifest.version,
      root,
      dependencies: [],
      packageContentHash: "",
    });
    const required = Object.keys(manifest.dependencies ?? {}).toSorted();
    const optional = Object.keys(manifest.optionalDependencies ?? {}).toSorted();
    const edges = required.map(dependency => visit(dependency, root));
    for (const dependency of optional) {
      try {
        edges.push(visit(dependency, root));
      } catch (error) {
        if (!(error instanceof ReviewEvidenceError) || error.code !== "INVALID_INPUT") throw error;
      }
    }
    entries.set(id, {
      name,
      version: manifest.version,
      root,
      dependencies: [...new Set(edges)].toSorted(),
      packageContentHash: hashTree(root),
    });
    return id;
  };
  for (const [name, version] of Object.entries(direct).toSorted(([left], [right]) =>
    left.localeCompare(right))) {
    visit(name, CONTRACTORS_ROOT, version);
  }
  return [...entries.values()].toSorted((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

/** Provisions a lock manifest whose package identities can be stored before review builds run. */
export async function createNodeReviewBuildManifest(
  inputs: ContractBuildInputs,
): Promise<LockedReviewBuildManifest> {
  const snapshot = createLockedSnapshot(resolvePackageClosure(inputs.dependencies));
  try {
    const closure = snapshot.packageClosure.map(entry => ({
      name: entry.name,
      version: entry.version,
      packageContentHash: entry.packageContentHash,
      dependencies: entry.dependencies,
    }));
    const toolchain = {
      components: [
        ...snapshot.toolchainRoots.map(({name, identity}) => ({name, identity})),
        nodeToolchainComponent(),
      ].toSorted((left, right) => left.name.localeCompare(right.name)),
    };
    return await createReviewBuildManifest(inputs, closure, toolchain);
  } finally {
    rmSync(snapshot.root, {recursive: true, force: true});
  }
}

function packageDestination(root: string, name: string): string {
  return join(root, "node_modules", ...name.split("/"));
}

function copyPackage(source: string, destination: string): void {
  mkdirSync(dirname(destination), {recursive: true});
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => path === source || !path.slice(source.length + 1).split("/").includes("node_modules"),
  });
}

function createLockedSnapshot(packageClosure: readonly ResolvedPackageClosureEntry[]): Readonly<{
  root: string;
  workerPath: string;
  contractorsRoot: string;
  esbuildBinary: string;
  packageClosure: readonly ResolvedPackageClosureEntry[];
  toolchainRoots: readonly LockedToolchainRoot[];
}> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "contract-review-")));
  const workerPath = join(root, "node-runner-worker.js");
  writeFileSync(workerPath, readFileSync(WORKER_PATH));
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
  const contractorsRoot = packageDestination(root, "@gadgets/contractors");
  copyPackage(CONTRACTORS_ROOT, contractorsRoot);
  const sources = new Map<string, string>([
    [packageName(TYPESCRIPT_ROOT), TYPESCRIPT_ROOT],
    [packageName(ESBUILD_ROOT), ESBUILD_ROOT],
    [packageName(ESBUILD_NATIVE_ROOT!), ESBUILD_NATIVE_ROOT!],
    [packageName(WORKERS_TYPES_ROOT), WORKERS_TYPES_ROOT],
    ...packageClosure.map(entry => [entry.name, entry.root] as const),
  ]);
  for (const [name, source] of sources) copyPackage(source, packageDestination(root, name));
  const lockedClosure = packageClosure.map(entry => {
    const lockedRoot = packageDestination(root, entry.name);
    return {...entry, root: lockedRoot, packageContentHash: hashTree(lockedRoot)};
  });
  const lockedContractors = packageDestination(root, "@gadgets/contractors");
  const toolchainRoots: LockedToolchainRoot[] = [
    packageDestination(root, "@cloudflare/workers-types"),
    lockedContractors,
    packageDestination(root, "esbuild"),
    packageDestination(root, packageName(ESBUILD_NATIVE_ROOT!)),
    packageDestination(root, "typescript"),
  ].map(packageRoot => ({
    name: packageName(packageRoot),
    root: packageRoot,
    ...(packageRoot === lockedContractors ? {contentRoot: join(packageRoot, "dist")} : {}),
    identity: hashTree(packageRoot === lockedContractors ? join(packageRoot, "dist") : packageRoot),
  }));
  return {
    root,
    workerPath,
    contractorsRoot,
    esbuildBinary: join(packageDestination(root, packageName(ESBUILD_NATIVE_ROOT!)), "bin/esbuild"),
    packageClosure: lockedClosure,
    toolchainRoots,
  };
}

class NodeReviewBuildRunner implements ReviewBuildRunner {
  #disposed = false;

  constructor(
    private readonly role: "candidate" | "verifier",
    private readonly options: NodeReviewBuildRunnerFactoryOptions,
  ) {}

  async build(request: Parameters<ReviewBuildRunner["build"]>[0]): Promise<ReviewBuildRunResult> {
    if (this.#disposed) {
      throw new ReviewEvidenceError("ISOLATION_FAILED", "Review runner was already disposed.");
    }
    const inputs = JSON.parse(request.buildManifest.inputs.json) as ContractBuildInputs;
    const resolvedClosure = resolvePackageClosure(inputs.dependencies);
    const snapshot = createLockedSnapshot(resolvedClosure);
    const packageClosure = snapshot.packageClosure;
    const toolchainRoots = snapshot.toolchainRoots;
    const snapshotManifestClosure = packageClosure.map(entry => ({
      name: entry.name,
      version: entry.version,
      packageContentHash: entry.packageContentHash,
      dependencies: entry.dependencies,
    }));
    const snapshotToolchain = {
      components: [
        ...toolchainRoots.map(({name, identity}) => ({name, identity})),
        nodeToolchainComponent(),
      ].toSorted((left, right) => left.name.localeCompare(right.name)),
    };
    if (canonicalReviewJson(snapshotManifestClosure) !==
        canonicalReviewJson(request.buildManifest.packageClosure) ||
        canonicalReviewJson(snapshotToolchain) !== canonicalReviewJson(request.buildManifest.toolchain)) {
      rmSync(snapshot.root, {recursive: true, force: true});
      throw new ReviewEvidenceError("ISOLATION_FAILED", "Installed build inputs drifted from the lock manifest.");
    }
    const readableRoots = [
      snapshot.root,
      process.execPath,
      ...packageClosure.flatMap(entry => [entry.root, join(entry.root, "node_modules")]),
      ...toolchainRoots.flatMap(entry => [entry.root, entry.contentRoot].filter(Boolean) as string[]),
    ];
    const nodeArgs = [
      "--permission",
      "--allow-child-process",
      ...readableRoots.map(path => `--allow-fs-read=${path}`),
      snapshot.workerPath,
    ];
    const [executable, args] = isolatedNodeCommand(nodeArgs);
    const child = spawn(executable, args, {
      cwd: snapshot.root,
      env: {
        ESBUILD_BINARY_PATH: snapshot.esbuildBinary,
        PATH: [dirname(process.execPath), dirname(snapshot.esbuildBinary)].join(delimiter),
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const outputLimit = 32 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > outputLimit) child.kill("SIGKILL");
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.reduce((sum, item) => sum + item.byteLength, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({
      role: this.role,
      producerIdentity: this.options.producerIdentity,
      conformanceProbe: this.options.conformanceProbe,
      conformanceNetworkUrl: this.options.conformanceNetworkUrl,
      packageClosure,
      toolchainRoots,
      nodeIdentity: nodeToolchainComponent().identity,
      lockedInputs: request.buildManifest.inputs,
    }));
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    }).finally(() => {
      clearTimeout(timeout);
      rmSync(snapshot.root, {recursive: true, force: true});
    });
    const output = Buffer.concat(stdout).toString("utf8");
    if (exitCode !== 0 || outputBytes > outputLimit) {
      const diagnostic = Buffer.concat(stderr).toString("utf8").slice(0, 2_048);
      throw new ReviewEvidenceError(
        "ISOLATION_FAILED",
        `Trusted ${this.role} subprocess failed closed${diagnostic ? `: ${diagnostic}` : "."}`,
      );
    }
    try {
      return JSON.parse(output) as ReviewBuildRunResult;
    } catch {
      throw new ReviewEvidenceError("ISOLATION_FAILED", "Trusted runner returned malformed output.");
    }
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
  }
}

/** Creates fresh Node subprocesses with network denied and filesystem reads allowlisted. */
export function createNodeReviewBuildRunnerFactory(
  options: NodeReviewBuildRunnerFactoryOptions,
): ReviewBuildRunnerFactory {
  return {
    create(request) {
      if (request.network !== "disabled" || request.mutableState !== "fresh") {
        throw new ReviewEvidenceError("ISOLATION_FAILED", "Node review runners require strict isolation.");
      }
      return new NodeReviewBuildRunner(request.role, options);
    },
  };
}
