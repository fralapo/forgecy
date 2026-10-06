/**
 * RFC 6902 JSON Patch with RFC 6901 pointers. Small on purpose: proposals only
 * need add, remove, replace, move, copy and test, applied to a copy of the input.
 */

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: unknown };

export type JsonPatch = JsonPatchOp[];

export type JsonPatchErrorCode = "test_failed" | "path_not_found" | "invalid";

export class JsonPatchError extends Error {
  constructor(
    readonly code: JsonPatchErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "JsonPatchError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/"))
    throw new JsonPatchError("invalid", pointer, `Invalid JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function formatPointer(segments: readonly (string | number)[]): string {
  return segments
    .map((s) => `/${String(s).replace(/~/g, "~0").replace(/\//g, "~1")}`)
    .join("");
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

const arrayIndex = (seg: string, length: number, allowEnd: boolean, path: string): number => {
  if (seg === "-" && allowEnd) return length;
  if (!/^(0|[1-9][0-9]*)$/.test(seg))
    throw new JsonPatchError("invalid", path, `Invalid array index "${seg}" in ${path}`);
  const i = Number(seg);
  if (i > length || (!allowEnd && i === length))
    throw new JsonPatchError("path_not_found", path, `Index out of range in ${path}`);
  return i;
};

/** Value at `pointer`, or `undefined` when any segment is missing. */
export function getAt(root: unknown, pointer: string): unknown {
  let node = root;
  for (const seg of parsePointer(pointer)) {
    if (Array.isArray(node)) {
      if (!/^(0|[1-9][0-9]*)$/.test(seg)) return undefined;
      node = node[Number(seg)];
    } else if (isObject(node)) {
      if (!Object.hasOwn(node, seg)) return undefined;
      node = node[seg];
    } else return undefined;
  }
  return node;
}

export function hasPath(root: unknown, pointer: string): boolean {
  const segs = parsePointer(pointer);
  let node = root;
  for (const seg of segs) {
    if (Array.isArray(node)) {
      if (!/^(0|[1-9][0-9]*)$/.test(seg) || Number(seg) >= node.length) return false;
      node = node[Number(seg)];
    } else if (isObject(node)) {
      if (!Object.hasOwn(node, seg)) return false;
      node = node[seg];
    } else return false;
  }
  return true;
}

function parentOf(root: unknown, path: string): { parent: unknown; key: string } {
  const segs = parsePointer(path);
  if (segs.length === 0) throw new JsonPatchError("invalid", path, "Cannot target the root");
  const key = segs.pop()!;
  const parentPointer = formatPointer(segs);
  if (!hasPath(root, parentPointer))
    throw new JsonPatchError("path_not_found", path, `Missing parent for ${path}`);
  return { parent: getAt(root, parentPointer), key };
}

function add(root: unknown, path: string, value: unknown): void {
  const { parent, key } = parentOf(root, path);
  if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, true, path), 0, value);
  else if (isObject(parent)) parent[key] = value;
  else throw new JsonPatchError("path_not_found", path, `Parent of ${path} is not a container`);
}

function remove(root: unknown, path: string): unknown {
  if (!hasPath(root, path))
    throw new JsonPatchError("path_not_found", path, `Nothing to remove at ${path}`);
  const { parent, key } = parentOf(root, path);
  if (Array.isArray(parent)) return parent.splice(arrayIndex(key, parent.length, false, path), 1)[0];
  const obj = parent as Record<string, unknown>;
  const old = obj[key];
  delete obj[key];
  return old;
}

/** Applies `patch` to a deep copy of `doc`. Throws JsonPatchError; `doc` is never modified. */
export function applyPatch<T>(doc: T, patch: JsonPatch): T {
  const root = { value: structuredClone(doc) as unknown };
  const at = (p: string) => `/value${p}`;
  for (const op of patch) {
    switch (op.op) {
      case "add":
        if (op.path === "") root.value = structuredClone(op.value);
        else add(root, at(op.path), structuredClone(op.value));
        break;
      case "remove":
        remove(root, at(op.path));
        break;
      case "replace":
        if (op.path === "") root.value = structuredClone(op.value);
        else {
          if (!hasPath(root, at(op.path)))
            throw new JsonPatchError("path_not_found", op.path, `Nothing to replace at ${op.path}`);
          remove(root, at(op.path));
          add(root, at(op.path), structuredClone(op.value));
        }
        break;
      case "move": {
        if (op.path.startsWith(`${op.from}/`))
          throw new JsonPatchError("invalid", op.path, "Cannot move a value into itself");
        const v = remove(root, at(op.from));
        add(root, at(op.path), v);
        break;
      }
      case "copy": {
        if (!hasPath(root, at(op.from)))
          throw new JsonPatchError("path_not_found", op.from, `Nothing to copy at ${op.from}`);
        add(root, at(op.path), structuredClone(getAt(root, at(op.from))));
        break;
      }
      case "test":
        if (!hasPath(root, at(op.path)) || !deepEqual(getAt(root, at(op.path)), op.value))
          throw new JsonPatchError("test_failed", op.path, `Value at ${op.path} has changed`);
        break;
      default:
        throw new JsonPatchError("invalid", "", "Unknown patch operation");
    }
  }
  return root.value as T;
}

/** Runtime check that an unknown value is a well-formed patch. */
export function isJsonPatch(value: unknown): value is JsonPatch {
  return (
    Array.isArray(value) &&
    value.every((op) => {
      if (!isObject(op) || typeof op.path !== "string") return false;
      switch (op.op) {
        case "add":
        case "replace":
        case "test":
          return "value" in op;
        case "remove":
          return true;
        case "move":
        case "copy":
          return typeof op.from === "string";
        default:
          return false;
      }
    })
  );
}
