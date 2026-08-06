/** Organization controls applied before a Contract artifact can be proposed. */
export interface DependencyPolicy {
  readonly allowedPackages?: readonly string[];
  readonly deniedPackages?: readonly string[];
  readonly allowedVersions?: Readonly<Record<string, string>>;
  readonly maxBundleBytes?: number;
}

/** Validates exact bundled dependency identities against organization policy. */
export function validateDependencyPolicy(
  dependencies: Readonly<Record<string, string>>,
  policy: DependencyPolicy | undefined,
): void {
  if (!policy) return;

  const allowed = policy.allowedPackages && new Set(policy.allowedPackages);
  const denied = new Set(policy.deniedPackages ?? []);

  for (const [name, version] of Object.entries(dependencies)) {
    if ((allowed && !allowed.has(name)) || denied.has(name)) {
      throw new DependencyPolicyError(
        "DEPENDENCY_NOT_ALLOWED",
        `Dependency ${name}@${version} is not allowed.`,
      );
    }

    const allowedVersion = policy.allowedVersions?.[name];
    if (allowedVersion !== undefined && allowedVersion !== version) {
      throw new DependencyPolicyError(
        "DEPENDENCY_VERSION_NOT_ALLOWED",
        `Dependency ${name}@${version} does not match allowed version ${allowedVersion}.`,
      );
    }
  }
}

/** A dependency-governance failure suitable for proposal UI display. */
export class DependencyPolicyError extends Error {
  override readonly name = "DependencyPolicyError";

  constructor(
    readonly code: "DEPENDENCY_NOT_ALLOWED" | "DEPENDENCY_VERSION_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
  }
}
