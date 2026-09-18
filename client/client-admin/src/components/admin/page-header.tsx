'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';

export interface Crumb {
  /** Shown as given — the caller translates it. */
  label: string;
  /** Omit on the last crumb — you are already there. */
  href?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  /** Shown as given — the caller translates it. */
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: Crumb[];
  actions?: React.ReactNode;
}) {
  /*
   * A client component for one aria-label. Server pages render it with plain
   * props (text and elements), which cross the boundary as they are, and the
   * translator is a hook.
   */
  const t = useT();

  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>

        {breadcrumb?.length ? (
          <nav aria-label={t('Breadcrumb')}>
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {breadcrumb.map((crumb, index) => (
                <li key={crumb.label} className="flex items-center gap-1">
                  {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="transition-colors hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-foreground">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
