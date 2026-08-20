import type { Metadata } from 'next';
import type { CategoryRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetAll } from '@/lib/server-api';
import { publicEnv, storefrontUrl } from '@/lib/env';
import { PageHeader } from '@/components/admin/page-header';
import {
  DesignPicker,
  type CategoryChoice,
  type DesignPayload,
} from '@/components/admin/design-picker';

export const metadata: Metadata = { title: 'Design' };
export const dynamic = 'force-dynamic';

/**
 * The categories the icon picker offers a glyph to.
 *
 * The glyph is stored on the design (`header_configuration.categoryIcons`) and
 * so is edited here, but the list of categories to hang it on sits behind
 * `categories.view` — a permission this screen does not itself require. A
 * refusal comes back as `null` rather than an empty list, because "you may not
 * see these" and "you have none" are opposite instructions to the reader.
 *
 * Only top-level categories: the storefront draws the glyph on the rail's
 * departments, and a sub-category is never given one, so offering the control
 * for a child would set a field nothing renders.
 */
async function iconCategories(): Promise<CategoryChoice[] | null> {
  try {
    const rows = await serverGetAll<CategoryRow>('/api/v1/admin/categories');
    return rows
      .filter((row) => !row.parentId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        inMenu: row.isActive && row.showInMenu,
      }));
  } catch {
    return null;
  }
}

export default async function DesignPage() {
  const [session, design, categories] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<DesignPayload>('/api/v1/admin/website/design'),
    iconCategories(),
  ]);

  const canManage = session.authenticated && can(session.admin, 'website.manage');
  const slug = session.authenticated ? session.store.slug : (publicEnv.devStoreSlug ?? '');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Design"
        description={`${design.templates.length} layouts × ${design.themes.length} colours. Pick one of each; nothing changes until you publish.`}
      />
      <DesignPicker
        design={design}
        categories={categories}
        storefrontUrl={storefrontUrl(slug)}
        canManage={canManage}
      />
    </div>
  );
}
