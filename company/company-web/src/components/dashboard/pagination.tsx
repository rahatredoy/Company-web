import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  basePath: string;
}

/**
 * `<Button asChild disabled>` forwards `disabled` onto an `<a>`, which HTML
 * ignores — so out-of-range links stayed clickable and page 1 could navigate to
 * `?page=0`. Rendering a real `<span>` at the boundaries is the fix.
 */
export function Pagination({ page, pageSize, total, totalPages, basePath }: PaginationProps) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  const style = cn(buttonVariants({ variant: 'outline', size: 'sm' }));
  const disabledStyle = cn(style, 'pointer-events-none opacity-50');

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Showing {from}–{to} of {total}
      </p>

      <div className="flex items-center gap-2">
        {hasPrevious ? (
          <Link href={`${basePath}?page=${page - 1}`} className={style} rel="prev">
            <ChevronLeft /> Previous
          </Link>
        ) : (
          <span className={disabledStyle} aria-disabled="true">
            <ChevronLeft /> Previous
          </span>
        )}

        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>

        {hasNext ? (
          <Link href={`${basePath}?page=${page + 1}`} className={style} rel="next">
            Next <ChevronRight />
          </Link>
        ) : (
          <span className={disabledStyle} aria-disabled="true">
            Next <ChevronRight />
          </span>
        )}
      </div>
    </div>
  );
}
