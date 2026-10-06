// deepMerge: the heart of the "merge" config strategy.
//
//   result = deepMerge(existing, repoBase, overlay)
//
// - objects merge recursively
// - arrays are concatenated and de-duplicated (so permission lists grow, never shrink)
// - scalars: the later value wins
//
// This keeps keys a tool or the user wrote themselves (the tool owns the file),
// while still enforcing what zaun ships plus the private overlay.

export type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Stable identity for de-duplicating array items, including objects and arrays. */
function key(value: unknown): string {
  if (isPlainObject(value)) {
    const sorted = Object.keys(value)
      .sort()
      .map((k) => [k, key(value[k])]);
    return 'o' + JSON.stringify(sorted);
  }
  if (Array.isArray(value)) return 'a' + JSON.stringify(value.map(key));
  if (value instanceof Date) return 'd' + value.toISOString();
  return typeof value + ':' + JSON.stringify(value);
}

function mergeArrays(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const item of [...a, ...b]) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function mergeTwo(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: PlainObject = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (k === '__proto__') continue; // never let a config file touch prototypes
      out[k] = mergeTwo(a[k], v);
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) return mergeArrays(a, b);
  return b;
}

/** Merge any number of layers, left to right. Inputs are never mutated. */
export function deepMerge<T = PlainObject>(...layers: unknown[]): T {
  return layers.reduce<unknown>((acc, layer) => mergeTwo(acc, layer), {}) as T;
}
