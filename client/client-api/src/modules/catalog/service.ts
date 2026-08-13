import { eq } from 'drizzle-orm';
import type { TenantExecutor } from '../../db/tenant-manager';
import { categories } from '../../db/schema/index';
import { ERROR_CODES, conflict, unprocessable } from '../../lib/errors';
import { slugify } from '../../lib/utils';

/**
 * Shared rules for the catalogue: how a slug is settled, and what makes a
 * category tree a tree.
 */

/**
 * Settles the slug for a row being written: the one that was asked for, or one
 * derived from the name, with a numeric suffix if that is already taken.
 *
 * Slugs are part of every storefront URL and the database holds a unique index
 * on each of them. Checking here as well is not redundant — it is what turns a
 * raw unique-violation into a message naming the field the form should mark.
 *
 * Suffixing rather than refusing, because two products called "Blue Shirt" is an
 * ordinary thing for a shop to have and nobody should have to invent URL-safe
 * text to get there. An **explicitly supplied** slug is different: that exact
 * address was asked for, so a clash is refused instead of quietly becoming
 * something else and pointing the owner's links at the wrong page.
 *
 * The caller supplies `isTaken` rather than the table, because a lookup written
 * against its own table stays type-checked; a table passed as a value does not.
 */
export async function settleSlug(options: {
  requested?: string | null;
  from: string;
  isTaken: (slug: string) => Promise<boolean>;
}): Promise<string> {
  const { requested, from, isTaken } = options;

  const base = slugify(requested || from, 150);
  if (!base) {
    throw unprocessable('That name cannot be turned into a web address.', ERROR_CODES.VALIDATION_FAILED, {
      [requested ? 'slug' : 'name']: ['Use at least one letter or number.'],
    });
  }

  if (!(await isTaken(base))) return base;

  if (requested) {
    throw conflict('That web address is already in use.', ERROR_CODES.SLUG_TAKEN);
  }

  // Bounded: a shop with 200 identically named items has a naming problem, not a
  // slug problem, and an unbounded loop here is a request that never ends.
  for (let suffix = 2; suffix <= 200; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  throw conflict('Too many items share that name. Give this one a different one.', ERROR_CODES.SLUG_TAKEN);
}

/**
 * Refuses a parent that would make the tree eat itself.
 *
 * `categories.parent_id` carries no foreign key — the schema says as much, and
 * says the API is what keeps the tree honest. So both halves are checked here:
 * that the parent exists at all, and that it is not the category itself or one
 * of its own descendants. Without the second, a subtree can be detached from the
 * root and become permanently unreachable while still holding products.
 */
export async function assertParentIsSafe(
  db: TenantExecutor,
  parentId: string,
  categoryId?: string,
): Promise<void> {
  if (categoryId && parentId === categoryId) {
    throw unprocessable('A category cannot be its own parent.', ERROR_CODES.VALIDATION_FAILED, {
      parentId: ['Choose a different parent.'],
    });
  }

  const parent = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, parentId))
    .limit(1);

  if (parent.length === 0) {
    throw unprocessable('That parent category no longer exists.', ERROR_CODES.VALIDATION_FAILED, {
      parentId: ['Choose a category that exists.'],
    });
  }

  if (!categoryId) return;

  // Walk up from the proposed parent: reaching this category means the move
  // would close a loop. Depth-capped so a tree that is *already* cyclic — from a
  // direct database edit, say — cannot hang the request.
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 100; depth += 1) {
    if (cursor === categoryId) {
      throw unprocessable(
        'That would put the category inside one of its own subcategories.',
        ERROR_CODES.VALIDATION_FAILED,
        { parentId: ['Choose a category outside this one.'] },
      );
    }

    const rows: { parentId: string | null }[] = await db
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, cursor))
      .limit(1);

    cursor = rows[0]?.parentId ?? null;
  }
}
