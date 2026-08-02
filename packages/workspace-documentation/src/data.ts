const MAX_DEPTH = 64;
const MAX_NODES = 100_000;

function assertDataNode(
  value: unknown,
  ancestors: ReadonlySet<object>,
  depth: number,
  counter: { nodes: number },
): void {
  counter.nodes += 1;
  if (counter.nodes > MAX_NODES) {
    throw new RangeError(`Workspace documentation exceeds ${MAX_NODES} nodes.`);
  }
  if (depth > MAX_DEPTH) {
    throw new RangeError(`Workspace documentation exceeds ${MAX_DEPTH} levels.`);
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Workspace documentation must not contain cycles.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Workspace documentation must not contain symbol fields.");
  }
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index))
    ) {
      throw new TypeError(
        "Workspace documentation arrays must be dense data arrays.",
      );
    }
    for (const [index] of value.entries()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError(
          "Workspace documentation accepts only enumerable data fields.",
        );
      }
      assertDataNode(
        descriptor.value,
        nextAncestors,
        depth + 1,
        counter,
      );
    }
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Workspace documentation must contain plain objects.");
  }
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length) {
    throw new TypeError(
      "Workspace documentation must not contain hidden fields.",
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        "Workspace documentation accepts only enumerable data fields.",
      );
    }
    assertDataNode(
      descriptor.value,
      nextAncestors,
      depth + 1,
      counter,
    );
  }
}

export function assertPlainDataTree(value: unknown): void {
  assertDataNode(value, new Set(), 0, { nodes: 0 });
}
