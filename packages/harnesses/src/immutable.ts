export function immutableCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => immutableCopy(item)),
    ) as T;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        immutableCopy(child),
      ]),
    ),
  ) as T;
}
