import {createHash, randomUUID} from "node:crypto";
import {readFile, readdir, readlink, realpath, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {compileContract} from "@gadgets/contractors/compiler";
import type {ContractBuildInputs} from "@gadgets/contractors/artifact";

import type {ReviewBuildRunResult, ReviewToolchainComponent} from "./types.js";

interface WorkerRequest {
  readonly role: "candidate" | "verifier";
  readonly producerIdentity: string;
  readonly conformanceProbe?: "network" | "undeclaredRead";
  readonly packageClosure: readonly Readonly<{
    readonly name: string;
    readonly version: string;
    readonly root: string;
    readonly dependencies: readonly string[];
  }>[];
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

async function runProbe(probe: WorkerRequest["conformanceProbe"]): Promise<void> {
  if (probe === "network") {
    await fetch("https://example.invalid/");
  } else if (probe === "undeclaredRead") {
    await readFile("/etc/hosts");
  }
}

async function main(): Promise<void> {
  const request = JSON.parse(await stdinText()) as WorkerRequest;
  if (request.conformanceProbe) await runProbe(request.conformanceProbe);
  const candidate = await compileContract(request.inputs);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const contractorsRoot = await realpath(resolve(packageRoot, "node_modules/@gadgets/contractors"));
  const toolchainRoots: readonly [string, string?][] = [
    [await realpath(resolve(contractorsRoot, "node_modules/@cloudflare/workers-types"))],
    [contractorsRoot, resolve(contractorsRoot, "dist")],
    [await realpath(resolve(contractorsRoot, "node_modules/esbuild"))],
    [await realpath(resolve(dirname(process.env.ESBUILD_BINARY_PATH!), ".."))],
    [await realpath(resolve(contractorsRoot, "node_modules/typescript"))],
  ];
  const components = await Promise.all(toolchainRoots.map(([root, contentRoot]) =>
    packageIdentity(root, contentRoot)));
  const executable = await readFile(process.execPath);
  components.push({
    name: "node",
    identity: `sha256:${createHash("sha256").update(executable).digest("hex")}`,
  });
  components.sort((left, right) => left.name.localeCompare(right.name));
  const directIntegrity = new Map(candidate.artifact.dependencies.map(dependency =>
    [`${dependency.name}@${dependency.version}`, dependency.integrity]));
  const dependencyLock = {entries: await Promise.all(request.packageClosure.map(async entry => {
    const packageContentHash = await hashTree(entry.root);
    return {
      name: entry.name,
      version: entry.version,
      integrity: directIntegrity.get(`${entry.name}@${entry.version}`) ?? packageContentHash,
      packageContentHash,
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
    toolchain: {components},
    recipe: {
      name: "contract-current",
      target: "es2022",
      platform: "neutral",
      moduleFormat: "esm",
      externals: ["cloudflare:workers"],
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
