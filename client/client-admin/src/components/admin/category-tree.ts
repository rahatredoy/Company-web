import type { CategoryRow } from '@/lib/types';

/**
 * Turning the flat list the API returns into the tree the screen shows.
 *
 * The API paginates rows, not branches, and a page boundary drawn through the
 * middle of a family would orphan children on screen. So the page reads the
 * whole set once and everything below — the tree, the filters, the counts and
 * the page window — is derived from it here. A category list is measured in
 * dozens, so that is one small read rather than a page-per-interaction.
 */

export interface CategoryNode extends CategoryRow {
  children: CategoryNode[];
  depth: number;
}

/** The shared look for the plain `<select>`s the filters and the panel use. */
export const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-input bg-background px-3 pr-8 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25';

export function buildTree(rows: CategoryRow[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [], depth: 0 });

  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    // A row whose parent is missing is a root, not a row that vanishes. The
    // column carries no foreign key, so a parent deleted straight from the
    // database leaves exactly this, and hiding the children would hide the
    // problem rather than the rows.
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const settleDepth = (nodes: CategoryNode[], depth: number) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const node of nodes) {
      node.depth = depth;
      settleDepth(node.children, depth + 1);
    }
  };
  settleDepth(roots, 0);

  return roots;
}

/** Every id beneath `id`, for the moves and deletes that must not cross it. */
export function descendantIds(rows: CategoryRow[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const siblings = childrenOf.get(row.parentId);
    if (siblings) siblings.push(row.id);
    else childrenOf.set(row.parentId, [row.id]);
  }

  const found = new Set<string>();
  const queue = [...(childrenOf.get(id) ?? [])];
  while (queue.length) {
    const next = queue.pop()!;
    if (found.has(next)) continue; // a cycle written straight into the database
    found.add(next);
    queue.push(...(childrenOf.get(next) ?? []));
  }
  return found;
}

export interface TreeFilters {
  search: string;
  status: 'all' | 'active' | 'inactive';
  visibility: 'all' | 'shown' | 'hidden';
  parent: string;
}

function matches(node: CategoryNode, filters: TreeFilters): boolean {
  const term = filters.search.trim().toLowerCase();
  if (term && !node.name.toLowerCase().includes(term) && !node.slug.toLowerCase().includes(term)) return false;
  if (filters.status !== 'all' && node.isActive !== (filters.status === 'active')) return false;
  if (filters.visibility !== 'all' && node.showInMenu !== (filters.visibility === 'shown')) return false;
  return true;
}

/**
 * Filtering a tree is not filtering a list.
 *
 * A node is kept when it matches **or** when something beneath it does —
 * otherwise searching for a subcategory returns nothing, because the row that
 * would have shown it was filtered out one level up. A node that matches keeps
 * its whole subtree: you asked for that branch, so you get the branch. A node
 * kept only for a descendant shows just the descendants that were kept, so the
 * result reads as a path to the hits rather than as the whole shop again.
 */
export function filterTree(nodes: CategoryNode[], filters: TreeFilters): CategoryNode[] {
  const kept: CategoryNode[] = [];

  for (const node of nodes) {
    if (matches(node, filters)) {
      kept.push(node);
      continue;
    }
    const children = filterTree(node.children, filters);
    if (children.length) kept.push({ ...node, children });
  }

  return kept;
}

/** The parent filter re-roots the tree on one branch. */
export function subtreeFor(nodes: CategoryNode[], parent: string): CategoryNode[] {
  if (parent === 'all') return nodes;
  if (parent === 'root') return nodes.map((node) => ({ ...node, children: [] }));

  const find = (list: CategoryNode[]): CategoryNode | null => {
    for (const node of list) {
      if (node.id === parent) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  };

  const branch = find(nodes);
  return branch ? branch.children : [];
}

/** Depth-first, parents before their children — the order the table renders. */
export function flatten(nodes: CategoryNode[], expanded: Set<string>): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (list: CategoryNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length && expanded.has(node.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Every id in the tree, so "select all" means the rows on screen. */
export function idsIn(nodes: CategoryNode[]): string[] {
  const out: string[] = [];
  const walk = (list: CategoryNode[]) => {
    for (const node of list) {
      out.push(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * A stable tint per category, so the same category is the same colour on every
 * render and on every machine. Derived from the id rather than the position,
 * which would reshuffle every colour on a sort.
 */
export function tintFor(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash % 6;
}
