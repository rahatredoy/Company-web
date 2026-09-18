import type { Metadata } from 'next';
import { AttributeManager, type AttributeFilterState } from '@/components/admin/attribute-manager';
import { getT } from '@/lib/i18n/server';
import { serverGet } from '@/lib/server-api';
import { can, type AttributeRow, type SessionResponse } from '@/lib/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Attributes') };
}

export const dynamic = 'force-dynamic';

export default async function AttributesPage({
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

  // The endpoint returns the whole vocabulary with its values — a shop has a
  // handful of attributes, so there is nothing to paginate on the server.
  const [session, attributes] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<AttributeRow[]>('/api/v1/admin/attributes'),
  ]);

  const initial: AttributeFilterState = {
    search: single('search') ?? '',
    kind: oneOf('kind', ['all', 'variant', 'descriptive'] as const, 'all'),
    filterable: oneOf('filterable', ['all', 'yes', 'no'] as const, 'all'),
    inputType: oneOf('type', ['all', 'select', 'color', 'text', 'number'] as const, 'all'),
    page: Math.max(1, Number(single('page')) || 1),
    pageSize: [10, 25, 50, 100].includes(Number(single('per'))) ? Number(single('per')) : 10,
  };

  return (
    <AttributeManager
      rows={attributes}
      canManage={session.authenticated && can(session.admin, 'attributes.manage')}
      initial={initial}
    />
  );
}
