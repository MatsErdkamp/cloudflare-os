import { describe, expect, it } from "vitest";

import { compileContract, ContractCompilationError, hashArtifact } from "../src/index";

const VALID_CONTRACT = `
  import { defineContract } from "@gadgets/contractors";
  import { RpcTarget } from "cloudflare:workers";
  import type { Source } from "contract:source";

  export interface ContractBinding extends RpcTarget {
    subject(id: string): Promise<string>;
  }

  class Binding extends RpcTarget implements ContractBinding {
    constructor(private source: Source) { super(); }
    async subject(id: string) {
      const message = await this.source.readEmail(id);
      return message.subject;
    }
  }

  export default defineContract<Source, ContractBinding>((context) => new Binding(context.source));
`;

const SOURCE_TYPES = `
  interface Email { subject: string; }
  interface EmailSource { readEmail(id: string): Promise<Email>; }
`;

function input(source = VALID_CONTRACT) {
  return {
    modules: { "contract.ts": source },
    mainModule: "contract.ts",
    sourceTypes: SOURCE_TYPES,
    sourceRootType: "EmailSource",
    dependencies: {},
    compatibilityDate: "2026-08-05",
  };
}

describe("compileContract", () => {
  it("produces a deterministic immutable artifact with public ContractBinding types", async () => {
    const first = await compileContract(input());
    const second = await compileContract(input());

    expect(first.hash).toBe(second.hash);
    expect(first.mainModule).toBe("contract.js");
    expect(first.modules["contract.js"]).toContain("readEmail");
    expect(first.publicTypes).toContain("interface ContractBinding");
    expect(first.publicTypes).toContain('from "cloudflare:workers"');
    expect(first.publicTypes).not.toContain("default");
    expect(first.publicTypes).not.toContain("EmailSource");
    expect(first.sourceRootType).toBe("EmailSource");
    expect(first.publicRootType).toBe("ContractBinding");
    expect(first.runtimeHarnessVersion).toBe("7");
  });

  it("omits private implementation declarations from Consumer-facing types", async () => {
    const artifact = await compileContract(input(`
      import { RpcTarget } from "cloudflare:workers";
      export interface ContractBinding extends RpcTarget { ping(): string; }
      class PrivateImplementation extends RpcTarget implements ContractBinding {
        ping() { return "pong"; }
      }
      export default function createContract() { return new PrivateImplementation(); }
    `));

    expect(artifact.publicTypes).toContain("interface ContractBinding");
    expect(artifact.publicTypes).not.toContain("PrivateImplementation");
  });

  it("accepts a JavaScript Contract with an exported RPC binding class", async () => {
    const source = `
      import { RpcTarget } from "cloudflare:workers";
      export class ContractBinding extends RpcTarget {
        ping() { return "pong"; }
      }
      export default function createContract() { return new ContractBinding(); }
    `;

    const artifact = await compileContract({
      ...input(source),
      modules: {"contract.js": source},
      mainModule: "contract.js",
    });

    expect(artifact.publicTypes).toContain("class ContractBinding extends RpcTarget");
    expect(artifact.modules["contract.js"]).toContain("ping");
  });

  it("accepts an exported ContractBinding type alias", async () => {
    const source = `
      import { RpcTarget } from "cloudflare:workers";
      interface CustomerEmail extends RpcTarget { ping(): string; }
      export type { CustomerEmail as ContractBinding };
      class Binding extends RpcTarget implements CustomerEmail { ping() { return "pong"; } }
      export default function createContract(): CustomerEmail { return new Binding(); }
    `;

    const artifact = await compileContract(input(source));
    expect(artifact.publicTypes).toContain("CustomerEmail as ContractBinding");
  });

  it("type-checks and bundles relative in-memory modules", async () => {
    const source = VALID_CONTRACT
      .replace('import type { Source } from "contract:source";',
        'import type { Source } from "contract:source";\nimport { normalize } from "./helper";')
      .replace("return message.subject;", "return normalize(message.subject);");

    const artifact = await compileContract({
      ...input(source),
      modules: {
        "contract.ts": source,
        "helper.ts": "export const normalize = (value: string) => value.trim();",
      },
    });

    expect(artifact.modules["contract.js"]).toContain("trim");
  });

  it("bundles relative supporting declarations into the Consumer-facing type surface", async () => {
    const source = `
      import { RpcTarget } from "cloudflare:workers";
      import type { PublicResult } from "./helper";
      export interface ContractBinding extends RpcTarget {
        result(): Promise<PublicResult>;
      }
      class Binding extends RpcTarget implements ContractBinding {
        async result(): Promise<PublicResult> { return {value: "ok"}; }
      }
      export default function createContract(): ContractBinding { return new Binding(); }
    `;
    const artifact = await compileContract({
      ...input(source),
      modules: {
        "contract.ts": source,
        "helper.ts": "export interface PublicResult { value: string; }",
      },
    });

    expect(artifact.publicTypes).toContain("interface PublicResult");
    expect(artifact.publicTypes).not.toContain('from "./helper"');
  });

  it("rejects code that does not type-check against the selected Source", async () => {
    const invalid = VALID_CONTRACT.replace("readEmail(id)", "deleteMailbox(id)");

    await expect(compileContract(input(invalid))).rejects.toMatchObject({
      name: "ContractCompilationError",
      code: "TYPE_CHECK_FAILED",
    } satisfies Partial<ContractCompilationError>);
  });

  it("includes Source declarations only when the public Contract type references them", async () => {
    const exposed = VALID_CONTRACT
      .replace("subject(id: string): Promise<string>;", "rawSource(): Promise<Source>;")
      .replace("async subject(id: string) {", "async rawSource() {")
      .replace("const message = await this.source.readEmail(id);\n      return message.subject;", "return this.source;");

    const artifact = await compileContract(input(exposed));

    expect(artifact.publicTypes).toContain("interface EmailSource");
    expect(artifact.publicTypes).toContain("type Source = EmailSource");
    expect(artifact.publicTypes).not.toContain('from "contract:source"');
  });

  it("rejects a module without a default Contract factory", async () => {
    const invalid = VALID_CONTRACT.replace("export default defineContract", "const createContract = defineContract");

    await expect(compileContract(input(invalid))).rejects.toMatchObject({
      code: "MISSING_DEFAULT_EXPORT",
    });
  });

  it("rejects a default export that is not a Contract factory", async () => {
    const invalid = VALID_CONTRACT.replace(
      "export default defineContract<Source, ContractBinding>((context) => new Binding(context.source));",
      "export default 42;",
    );

    await expect(compileContract(input(invalid))).rejects.toMatchObject({
      code: "TYPE_CHECK_FAILED",
    });
  });

  it("rejects a public binding root that is not an RpcTarget", async () => {
    const invalid = VALID_CONTRACT.replace("export interface ContractBinding extends RpcTarget", "export interface ContractBinding");

    await expect(compileContract(input(invalid))).rejects.toMatchObject({
      code: "TYPE_CHECK_FAILED",
    });
  });

  it("rejects a non-RPC ContractBinding even when code bypasses defineContract", async () => {
    const invalid = `
      import { RpcTarget } from "cloudflare:workers";
      export interface ContractBinding { ping(): string; }
      class Binding extends RpcTarget { ping() { return "pong"; } }
      export default function createContract() { return new Binding(); }
    `;

    await expect(compileContract(input(invalid))).rejects.toMatchObject({
      code: "TYPE_CHECK_FAILED",
    });
  });

  it("rejects a factory whose root does not implement ContractBinding", async () => {
    const invalid = `
      import { RpcTarget } from "cloudflare:workers";
      export interface ContractBinding extends RpcTarget { expected(): string; }
      class OtherBinding extends RpcTarget { other() { return "other"; } }
      export default function createContract() { return new OtherBinding(); }
    `;

    await expect(compileContract(input(invalid))).rejects.toMatchObject({
      code: "TYPE_CHECK_FAILED",
    });
  });

  it("rejects a module without the required public ContractBinding export", async () => {
    const invalid = VALID_CONTRACT.replace("export interface ContractBinding", "interface ContractBinding");

    await expect(compileContract(input(invalid))).rejects.toMatchObject({
      code: "MISSING_CONTRACT_BINDING",
    });
  });

  it("changes the hash when compatibility or dependency authority changes", async () => {
    const original = await compileContract(input());
    const compatibilityChanged = await compileContract({
      ...input(),
      compatibilityDate: "2026-08-06",
    });
    const dependencyChanged = await compileContract({
      ...input(),
      dependencies: { zod: "4.2.0" },
    });

    expect(compatibilityChanged.hash).not.toBe(original.hash);
    expect(dependencyChanged.hash).not.toBe(original.hash);
  });

  it("canonicalizes optional undefined fields exactly as JSON persistence does", async () => {
    const authority = {
      mainModule: "contract.js",
      modules: {"contract.js": "export default () => ({})"},
      publicTypes: "export interface ContractBinding {}",
      publicRootType: "ContractBinding" as const,
      sourceTypeHash: "source",
      sourceRootType: "Source",
      dependencies: [{name: "example", version: "1.0.0"}],
      compatibilityDate: "2026-08-05",
      runtimeHarnessVersion: "6",
    };
    await expect(hashArtifact({
      ...authority,
      dependencies: [{name: "example", version: "1.0.0", integrity: undefined}],
    })).resolves.toBe(await hashArtifact(authority));
  });

  it("enforces dependency and bundle-size policy before returning an artifact", async () => {
    await expect(compileContract({
      ...input(),
      dependencies: { lodash: "4.17.21" },
      organizationPolicy: { allowedPackages: ["zod"] },
    })).rejects.toMatchObject({ code: "DEPENDENCY_NOT_ALLOWED" });

    await expect(compileContract({
      ...input(),
      organizationPolicy: { maxBundleBytes: 10 },
    })).rejects.toMatchObject({ code: "BUNDLE_TOO_LARGE" });
  });

  it("rejects ranges, tags, malformed versions, and invalid compatibility dates", async () => {
    for (const version of ["latest", "^4.2.0", "04.2.0", "4.2.0-alpha..1"]) {
      await expect(compileContract({...input(), dependencies: {zod: version}}))
        .rejects.toMatchObject({code: "INVALID_INPUT"});
    }
    await expect(compileContract({...input(), compatibilityDate: "2026-02-30"}))
      .rejects.toMatchObject({code: "INVALID_INPUT"});
    await expect(compileContract({
      ...input(),
      organizationPolicy: {maxBundleBytes: Number.NaN},
    })).rejects.toMatchObject({code: "INVALID_INPUT"});
  });

  it("bundles an exactly-versioned declared dependency", async () => {
    const source = VALID_CONTRACT
      .replace('import { RpcTarget } from "cloudflare:workers";',
        'import { RpcTarget } from "cloudflare:workers";\nimport { z } from "zod";')
      .replace("async subject(id: string) {", "async subject(id: string) {\n      z.string().parse(id);");
    const artifact = await compileContract({
      ...input(source),
      dependencies: {zod: "4.2.0"},
    });

    expect(artifact.dependencies).toEqual([{
      name: "zod",
      version: "4.2.0",
      integrity: expect.stringMatching(/^sha256-[A-Za-z0-9+/]+=*$/),
    }]);
    expect(artifact.modules["contract.js"]?.length).toBeGreaterThan(VALID_CONTRACT.length);
  });

  it("rejects external npm types from the Consumer-facing declaration surface", async () => {
    const source = `
      import { RpcTarget } from "cloudflare:workers";
      import type { BuildOptions } from "esbuild";
      export interface ContractBinding extends RpcTarget {
        options(): BuildOptions;
      }
      class Binding extends RpcTarget implements ContractBinding {
        options(): BuildOptions { return {}; }
      }
      export default function createContract(): ContractBinding { return new Binding(); }
    `;

    await expect(compileContract({...input(source), dependencies: {esbuild: "0.28.1"}}))
      .rejects.toThrow("Public Contract types must be self-contained");
  });

  it("rejects undeclared and version-mismatched dependency imports", async () => {
    const source = VALID_CONTRACT
      .replace('import { RpcTarget } from "cloudflare:workers";',
        'import { RpcTarget } from "cloudflare:workers";\nimport { z } from "zod";')
      .replace("async subject(id: string) {", "async subject(id: string) {\n      z.string().parse(id);");

    await expect(compileContract(input(source))).rejects.toMatchObject({code: "BUNDLE_FAILED"});
    await expect(compileContract({
      ...input(source),
      dependencies: {zod: "4.1.0"},
    })).rejects.toMatchObject({code: "BUNDLE_FAILED"});
  });
});
