/** Configurable Source call recorder used by Contract authoring tests in any JavaScript runtime. */
export class FakeSource {
  readonly calls: Array<{readonly method: string; readonly args: readonly unknown[]}> = [];

  invoke(method: string, ...args: readonly unknown[]): unknown {
    this.calls.push({method, args});
    return undefined;
  }
}
