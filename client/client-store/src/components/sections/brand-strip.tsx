import Image from 'next/image';
import Link from 'next/link';
import type { Brand } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import { cn } from '@/lib/utils';

/**
 * The "Top Brands" logo row.
 *
 * Falls back to the brand's name set in type when no logo has been uploaded,
 * which is the normal state for a young store — an empty box where a logo
 * should be reads as a broken image, whereas a wordmark reads as a wordmark.
 *
 * Logos are rendered at reduced contrast and lift on hover, so the row sits
 * quietly under the products rather than competing with them.
 */
export function BrandStrip({
  brands,
  tone = 'tinted',
  limit = 8,
  className,
}: {
  brands: Brand[];
  tone?: TemplatePreset['brandStripTone'];
  limit?: number;
  className?: string;
}) {
  if (brands.length === 0) return null;

  return (
    <ul
      className={cn(
        'no-scrollbar flex gap-3 overflow-x-auto sm:grid sm:grid-cols-4 sm:overflow-visible lg:grid-cols-8',
        className,
      )}
    >
      {brands.slice(0, limit).map((brand) => (
        <li key={brand.id} className="shrink-0">
          <Link
            href={`/brand/${brand.slug}`}
            className={cn(
              'grid h-16 w-32 place-items-center rounded-(--radius-button) px-3 text-center text-sm font-semibold transition-all sm:w-full',
              'text-muted hover:text-foreground',
              tone === 'tinted' && 'bg-surface hover:shadow-[var(--shadow-card)]',
              tone === 'cream' && 'bg-transparent',
              tone === 'plain' && 'bg-transparent',
            )}
          >
            {brand.logoUrl ? (
              <Image
                src={brand.logoUrl}
                alt={brand.name}
                width={104}
                height={36}
                className="max-h-9 w-auto object-contain opacity-70 transition-opacity hover:opacity-100"
              />
            ) : (
              <span className="truncate tracking-tight">{brand.name}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
