import {
  createContractRuntimeProfile,
  hashArtifact,
  hashContractValue,
  hashSourceTypes,
  type ContractArtifact,
} from "@gadgets/contractors/artifact";

/** Builds one valid current Artifact for Workshop boundary tests. */
export async function currentContractArtifact(input: {
  sourceCode?: string;
  publicTypes?: string;
  sourceTypes?: string;
  sourceRootType?: string;
  compatibilityDate?: string;
} = {}): Promise<ContractArtifact> {
  const runtimeProfile = await createContractRuntimeProfile(
    input.compatibilityDate ?? "2026-08-05",
    ["allow_irrevocable_stub_storage"],
  );
  const authority = {
    mainModule: "contract.js" as const,
    modules: {"contract.js": input.sourceCode ?? "export default class {}"},
    publicTypes: input.publicTypes ?? "export interface ContractBinding {}",
    publicRootType: "ContractBinding" as const,
    sourceTypeHash: await hashSourceTypes(input.sourceTypes ?? "interface Source {}"),
    sourceRootType: input.sourceRootType ?? "Source",
    dependencies: [],
    runtimeProfile,
    runtimeProfileHash: await hashContractValue(runtimeProfile),
  };
  return {hash: await hashArtifact(authority), ...authority};
}
