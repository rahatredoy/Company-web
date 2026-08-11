import { Mail } from 'lucide-react';
import { NewsletterForm } from '@/sections/newsletter-form';
import { cn } from '@/lib/utils';

/**
 * The newsletter band.
 *
 * Three tones so it can be the full-width brand block two of the references
 * use, or a quiet bordered panel on the minimal templates. The form inside is
 * the same component everywhere — one place that knows not to leak whether an
 * address is already subscribed.
 */
export function NewsletterBand({
  title,
  subtitle,
  tone = 'primary',
  className,
}: {
  title: string;
  subtitle?: string | null;
  tone?: 'primary' | 'dark' | 'soft';
  className?: string;
}) {
  const onBrand = tone === 'primary' || tone === 'dark';

  return (
    <div
      className={cn(
        'grid items-center gap-5 rounded-(--radius-card) p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10',
        tone === 'primary' && 'bg-primary text-primary-foreground',
        tone === 'dark' && 'bg-secondary text-secondary-foreground',
        tone === 'soft' && 'border border-border bg-surface-alt',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className={cn(
            'hidden size-14 shrink-0 place-items-center rounded-full sm:grid',
            onBrand ? 'bg-white/15' : 'bg-surface text-primary',
          )}
        >
          <Mail className="size-6" aria-hidden />
        </span>

        <div>
          <h2 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h2>
          {subtitle ? (
            <p className={cn('mt-1 text-sm', onBrand ? 'opacity-85' : 'text-muted')}>{subtitle}</p>
          ) : null}
        </div>
      </div>

      <NewsletterForm tone={onBrand ? 'onBrand' : 'plain'} />
    </div>
  );
}
