import type { Metadata } from 'next';
import { CategoryManager, type CategoryFilterState } from '@/components/admin/category-manager';
import { currentStoreSlug, serverGet, serverGetAll } from '@/lib/server-api';
import { storefrontUrl } from '@/lib/env';
import { can, type CategoryRow, type SessionResponse } from '@/lib/types';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Categories') };
}

export const dynamic = 'force-dynamic';

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = single(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  };

  const [session, slug, rows] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    currentStoreSlug(),
    /*
     * The whole category set, not a batch of it.
     *
     * The screen renders a tree, and a tree cannot be batched by the database
     * without cutting a family in half — the second batch would hold children
     * whose parent was in the first. So every category is read here and the
     * tree, the filters and the counts are all derived on the client from that
     * one set; the table then virtualises the rows the tree flattens to, so a
     * large one still only puts a screenful in the DOM.
     */
    serverGetAll<CategoryRow>('/api/v1/admin/categories'),
  ]);

  const initial: CategoryFilterState = {
    search: single('search') ?? '',
    status: oneOf('status', ['all', 'active', 'inactive'] as const, 'all'),
    visibility: oneOf('visibility', ['all', 'shown', 'hidden'] as const, 'all'),
    parent: single('parent') ?? 'all',
  };

  /*
   * "This month" is settled on the server so the count in the stat card is the
   * same on both renders. Deriving it in the browser would let a page rendered
   * just before midnight hydrate into a different number.
   */
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  return (
    <CategoryManager
      rows={rows}
      canManage={session.authenticated && can(session.admin, 'categories.manage')}
      storefrontBase={slug ? storefrontUrl(slug) : null}
      monthStart={monthStart}
      initial={initial}
    />
  );
}
