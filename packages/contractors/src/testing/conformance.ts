/** Asserts that every captured live capability call fails after Contract deletion. */
export async function assertContractCapabilitiesRetracted(
  calls: ReadonlyArray<() => unknown>,
): Promise<void> {
  const surviving: number[] = [];
  for (const [index, call] of calls.entries()) {
    try {
      await Promise.resolve().then(call);
      surviving.push(index);
    } catch {
      // Retraction is proven by failure; runtimes intentionally vary the exact error text.
    }
  }
  if (surviving.length > 0) {
    throw new Error(`Contract capability calls survived retraction at indexes: ${surviving.join(", ")}.`);
  }
}
