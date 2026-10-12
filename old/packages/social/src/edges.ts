import type { Handle, PostSnapshot } from "./types";

export const edgeKinds = ["tags", "mentions", "collab"] as const;
export type EdgeKind = (typeof edgeKinds)[number];

export interface Edge {
  src: Handle;
  dst: Handle;
  kind: EdgeKind;
  count: number;
  /** Oldest and newest postedAt of the posts that produced the edge. */
  firstSeen: string;
  lastSeen: string;
  postIds: string[];
}

const ms = (iso: string): number => Date.parse(iso);
const keyOf = (e: Pick<Edge, "src" | "dst" | "kind">): string => `${e.src}|${e.dst}|${e.kind}`;

function postHandles(post: PostSnapshot, kind: EdgeKind): Handle[] {
  if (kind === "tags") return post.taggedAccounts;
  if (kind === "mentions") return post.mentions;
  return post.collaborators;
}

/** Relationships from public post data only. One count per post, self-references skipped. */
export function extractEdges(handle: Handle, posts: PostSnapshot[]): Edge[] {
  const edges = new Map<string, Edge>();
  for (const post of posts) {
    for (const kind of edgeKinds) {
      for (const dst of new Set(postHandles(post, kind))) {
        if (dst === handle) continue;
        const key = keyOf({ src: handle, dst, kind });
        const e = edges.get(key);
        if (!e) {
          edges.set(key, {
            src: handle,
            dst,
            kind,
            count: 1,
            firstSeen: post.postedAt,
            lastSeen: post.postedAt,
            postIds: [post.id],
          });
          continue;
        }
        e.count += 1;
        e.postIds.push(post.id);
        if (ms(post.postedAt) < ms(e.firstSeen)) e.firstSeen = post.postedAt;
        if (ms(post.postedAt) > ms(e.lastSeen)) e.lastSeen = post.postedAt;
      }
    }
  }
  return [...edges.values()].sort(
    (a, b) =>
      edgeKinds.indexOf(a.kind) - edgeKinds.indexOf(b.kind) ||
      b.count - a.count ||
      (a.dst < b.dst ? -1 : a.dst > b.dst ? 1 : 0),
  );
}

export interface StoredEdge extends Edge {
  endedAt: string | null;
}

export interface EdgeReconciliation {
  /** New and changed edges. */
  upserts: StoredEdge[];
  /** Edges closed in this call, with endedAt set. */
  ended: StoredEdge[];
}

/**
 * `fresh` is every edge seen in the posts covered since `coveredFrom` (null = unknown coverage).
 * An open edge missing from `fresh` ends only when the coverage window should have contained it.
 */
export function reconcileEdges(
  existing: StoredEdge[],
  fresh: Edge[],
  opts: { now: string; coveredFrom: string | null },
): EdgeReconciliation {
  const old = new Map(existing.map((e) => [keyOf(e), e]));
  const seen = new Set<string>();
  const upserts: StoredEdge[] = [];
  const ended: StoredEdge[] = [];

  for (const f of fresh) {
    const key = keyOf(f);
    seen.add(key);
    const e = old.get(key);
    if (!e) {
      upserts.push({ ...f, postIds: [...f.postIds], endedAt: null });
      continue;
    }
    const known = new Set(e.postIds);
    const added = f.postIds.filter((id) => !known.has(id));
    // A fresh window reaching back before the stored one is the full picture, not an addition.
    const count = ms(f.firstSeen) <= ms(e.firstSeen) ? f.count : e.count + added.length;
    const merged: StoredEdge = {
      ...e,
      count,
      postIds: [...e.postIds, ...added],
      firstSeen: ms(f.firstSeen) < ms(e.firstSeen) ? f.firstSeen : e.firstSeen,
      lastSeen: ms(f.lastSeen) > ms(e.lastSeen) ? f.lastSeen : e.lastSeen,
      endedAt: null,
    };
    const changed =
      merged.count !== e.count ||
      merged.postIds.length !== e.postIds.length ||
      merged.firstSeen !== e.firstSeen ||
      merged.lastSeen !== e.lastSeen ||
      e.endedAt !== null;
    if (changed) upserts.push(merged);
  }

  if (opts.coveredFrom !== null) {
    const from = ms(opts.coveredFrom);
    for (const e of existing) {
      if (e.endedAt === null && !seen.has(keyOf(e)) && ms(e.lastSeen) >= from) {
        ended.push({ ...e, endedAt: opts.now });
      }
    }
  }
  return { upserts, ended };
}

export function jaccard(
  a: Iterable<string>,
  b: Iterable<string>,
): { jaccard: number; shared: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  const shared = [...sa].filter((x) => sb.has(x)).sort();
  const union = sa.size + sb.size - shared.length;
  return { jaccard: union === 0 ? 0 : shared.length / union, shared };
}

/** Overlap of the accounts two profiles point at, optionally for one kind. */
export function edgeOverlap(
  a: Edge[],
  b: Edge[],
  kind?: EdgeKind,
): { jaccard: number; shared: Handle[] } {
  const dsts = (edges: Edge[]): Handle[] =>
    edges.filter((e) => kind === undefined || e.kind === kind).map((e) => e.dst);
  return jaccard(dsts(a), dsts(b));
}
