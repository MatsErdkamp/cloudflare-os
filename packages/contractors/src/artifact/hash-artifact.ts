import type { ContractArtifactHashInput } from "./contract-artifact.js";

/** Canonical JSON encoding used at Contract artifact authority boundaries. */
export function canonicalContractJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalContractJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).toSorted().map((key) =>
    `${JSON.stringify(key)}:${canonicalContractJson(record[key])}`).join(",")}}`;
}

/** Computes a deterministic SHA-256 identity for all authority-affecting artifact fields. */
export async function hashArtifact(
  input: ContractArtifactHashInput,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalContractJson(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** Computes a deterministic SHA-256 identity for a canonical Contract value. */
export async function hashContractValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalContractJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** Computes a deterministic SHA-256 identity for exact Contract text bytes. */
export async function hashContractText(value: string): Promise<string> {
  return `sha256:${await hashSourceTypes(value)}`;
}

/** Computes a deterministic SHA-256 identity for Source declarations. */
export async function hashSourceTypes(sourceTypes: string): Promise<string> {
  const bytes = new TextEncoder().encode(sourceTypes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
