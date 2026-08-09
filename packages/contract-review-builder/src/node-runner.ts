import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {delimiter, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {existsSync, readFileSync, realpathSync} from "node:fs";

import {ReviewEvidenceError} from "./canonical.js";
import {REVIEW_LIMITS} from "./limits.js";
import type {
  ReviewBuildRunner,
  ReviewBuildRunnerFactory,
  ReviewBuildRunResult,
} from "./types.js";

/** Options for the concrete Node permission-model review runner. */
export interface NodeReviewBuildRunnerFactoryOptions {
  readonly producerIdentity: string;
  readonly timeoutMs?: number;
  /** Conformance-only probe which must be rejected by the child permission boundary. */
  readonly conformanceProbe?: "network" | "undeclaredRead";
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
const ESBUILD_BINARY = realpathSync(resolve(ESBUILD_NATIVE_ROOT, "bin/esbuild"));

interface ResolvedPackageClosureEntry {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  readonly dependencies: readonly string[];
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
    entries.set(id, {name, version: manifest.version, root, dependencies: []});
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
    const packageClosure = resolvePackageClosure(request.inputs.dependencies);
    const readableRoots = [
      WORKER_PATH,
      resolve(PACKAGE_ROOT, "package.json"),
      resolve(PACKAGE_ROOT, "node_modules"),
      resolve(CONTRACTORS_ROOT, "dist"),
      resolve(CONTRACTORS_ROOT, "package.json"),
      resolve(CONTRACTORS_ROOT, "node_modules"),
      TYPESCRIPT_ROOT,
      ESBUILD_ROOT,
      ESBUILD_NATIVE_ROOT,
      WORKERS_TYPES_ROOT,
      ESBUILD_BINARY,
      process.execPath,
      ...packageClosure.flatMap(entry => [entry.root, join(entry.root, "node_modules")]),
    ];
    const child = spawn(process.execPath, [
      "--permission",
      "--allow-child-process",
      ...readableRoots.map(path => `--allow-fs-read=${path}`),
      WORKER_PATH,
    ], {
      cwd: PACKAGE_ROOT,
      env: {
        ESBUILD_BINARY_PATH: ESBUILD_BINARY,
        PATH: [dirname(process.execPath), dirname(ESBUILD_BINARY)].join(delimiter),
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
    child.stdin.end(JSON.stringify({
      role: this.role,
      producerIdentity: this.options.producerIdentity,
      conformanceProbe: this.options.conformanceProbe,
      packageClosure,
      inputs: request.inputs,
    }));
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    }).finally(() => clearTimeout(timeout));
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
