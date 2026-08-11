import {createHash, randomUUID} from "node:crypto";
import {readFile, readdir, readlink, realpath, stat} from "node:fs/promises";
import {join} from "node:path";

import type {ContractBuildInputs} from "@gadgets/contractors/artifact";

import type {ReviewBuildRunResult, ReviewToolchainComponent} from "./types.js";

interface WorkerRequest {
  readonly role: "candidate" | "verifier";
  readonly producerIdentity: string;
  readonly conformanceProbe?: "network" | "undeclaredRead" | "lockedInputDrift";
  readonly conformanceNetworkUrl?: string;
  readonly packageClosure: readonly Readonly<{
    readonly name: string;
    readonly version: string;
    readonly root: string;
    readonly dependencies: readonly string[];
    readonly packageContentHash: string;
  }>[];
  readonly toolchainRoots: readonly Readonly<{
    readonly name: string;
    readonly root: string;
    readonly contentRoot?: string;
    readonly identity: string;
  }>[];
  readonly nodeIdentity: string;
  readonly inputs: ContractBuildInputs;
}

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, {withFileTypes: true}))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const absolute = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) {
        const size = (await stat(absolute)).size;
        fileCount += 1;
        totalBytes += size;
        if (fileCount > 100_000 || totalBytes > 512 * 1024 * 1024) {
          throw new Error("Package content exceeds the trusted runner hashing limit.");
        }
        hash.update(`file\0${relative}\0`);
        hash.update(await readFile(absolute));
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`link\0${relative}\0${await readlink(absolute)}\0`);
      }
    }
  }
  await visit(await realpath(root), "");
  return `sha256:${hash.digest("hex")}`;
}

async function packageIdentity(root: string, contentRoot: string = root): Promise<ReviewToolchainComponent> {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {name: string};
  return {name: manifest.name, identity: await hashTree(contentRoot)};
}

async function runProbe(
  probe: WorkerRequest["conformanceProbe"],
  networkUrl: string | undefined,
): Promise<void> {
  if (probe === "network") {
    if (!networkUrl) throw new Error("Network conformance probe requires a reachable target.");
    await fetch(networkUrl);
  } else if (probe === "undeclaredRead") {
    await readFile("/etc/hosts");
  }
}

async function main(): Promise<void> {
  const request = JSON.parse(await stdinText()) as WorkerRequest;
  if (request.conformanceProbe) {
    await runProbe(request.conformanceProbe, request.conformanceNetworkUrl);
  }
  for (const entry of request.packageClosure) {
    if (await hashTree(entry.root) !== entry.packageContentHash) {
      throw new Error(`Locked dependency ${entry.name}@${entry.version} changed before use.`);
    }
  }
  const components = await Promise.all(request.toolchainRoots.map(async (entry, index) => {
    const component = await packageIdentity(entry.root, entry.contentRoot ?? entry.root);
    const expectedIdentity = request.conformanceProbe === "lockedInputDrift" && index === 0
      ? `sha256:${"0".repeat(64)}`
      : entry.identity;
    if (component.name !== entry.name || component.identity !== expectedIdentity) {
      throw new Error(`Locked toolchain component ${entry.name} changed before use.`);
    }
    return component;
  }));
  const executable = await readFile(process.execPath);
  const nodeComponent = {
    name: "node",
    identity: `sha256:${createHash("sha256").update(executable).digest("hex")}`,
  };
  if (nodeComponent.identity !== request.nodeIdentity) {
    throw new Error("Locked Node runtime changed before use.");
  }
  components.push(nodeComponent);
  components.sort((left, right) => left.name.localeCompare(right.name));
  const {compileContract} = await import("@gadgets/contractors/compiler");
  const candidate = await compileContract(request.inputs);
  const directIntegrity = new Map(candidate.artifact.dependencies.map(dependency =>
    [`${dependency.name}@${dependency.version}`, dependency.integrity]));
  const dependencyLock = {entries: await Promise.all(request.packageClosure.map(async entry => {
    return {
      name: entry.name,
      version: entry.version,
      integrity: directIntegrity.get(`${entry.name}@${entry.version}`) ?? entry.packageContentHash,
      packageContentHash: entry.packageContentHash,
      dependencies: entry.dependencies,
    };
  }))};
  const result: ReviewBuildRunResult = {
    candidate,
    isolation: {
      role: request.role,
      producerIdentity: request.producerIdentity,
      environmentIdentity: `${process.pid}:${randomUUID()}`,
      network: "disabled",
      mutableState: "fresh",
      networkAttempts: 0,
    },
    dependencyLock,
    directDependencyRequests: Object.entries(request.inputs.dependencies)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, version]) => ({name, version})),
    toolchain: {components},
    recipe: {
      name: "contract-current",
      compatibilityDate: request.inputs.compatibilityDate,
      compatibilityFlags: [...request.inputs.compatibilityFlags],
      target: "es2022",
      platform: "neutral",
      moduleFormat: "esm",
      externals: ["cloudflare:workers"],
      publicRoot: candidate.artifact.publicRootType,
      authoringAbiHash: candidate.artifact.runtimeProfile.authoringAbi.declarationHash,
      runtimeHarnessHash: candidate.artifact.runtimeProfile.runtimeHarnessHash,
      runtimeModuleSetHash: candidate.artifact.runtimeProfile.runtimeModuleSetHash,
      runtimeProfileHash: candidate.artifact.runtimeProfileHash,
    },
  };
  process.stdout.write(JSON.stringify(result));
}

main().catch((error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "RUNNER_FAILED";
  const message = error instanceof Error ? error.message : "runner failed";
  const detail = typeof error === "object" && error !== null
    ? Object.getOwnPropertyNames(error).map(key => `${key}=${String((error as Record<string, unknown>)[key])}`).join(";")
    : "";
  process.stderr.write(`${code}:${message.slice(0, 1_024)}:${detail.slice(0, 1_024)}\n`);
  process.exitCode = 1;
});
