import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { TemplatePreset } from '@/templates/meta';
import { cn } from '@/lib/utils';

/**
 * The wrapper every homepage section sits in.
 *
 * One place decides vertical rhythm and whether a section is contained or runs
 * to the edge of the viewport. Before this, full-bleed heroes were achieved by
 * a template writing `[&>section]:mx-0 [&>section]:max-w-none [&>section]:px-0`
 * over its own children — a selector that reaches through whatever happens to
 * be nested and breaks the moment a section grows a wrapper element.
 */

const RHYTHM: Record<TemplatePreset['sectionRhythm'], string> = {
  tight: 'pt-8 sm:pt-10',
  normal: 'pt-10 sm:pt-14',
  airy: 'pt-14 sm:pt-20',
};

export function SectionShell({
  children,
  rhythm = 'normal',
  bleed = false,
  className,
  innerClassName,
  label,
  id,
}: {
  children: React.ReactNode;
  rhythm?: TemplatePreset['sectionRhythm'];
  /** Runs edge to edge; the inner content decides its own padding. */
  bleed?: boolean;
  className?: string;
  innerClassName?: string;
  label?: string;
  id?: string;
}) {
  return (
    <section id={id} aria-label={label} className={cn(RHYTHM[rhythm], className)}>
      <div className={cn(bleed ? 'w-full' : 'container-store', innerClassName)}>{children}</div>
    </section>
  );
}

/**
 * One heading treatment, so every section on a page lines up.
 *
 * `rule` draws the short underline the editorial templates put beneath a
 * centred title; `action` is the "View all →" link on the right of a rail.
 */
export function SectionHeading({
  title,
  subtitle,
  action,
  align = 'left',
  rule = false,
  size = 'md',
  trailing,
  className,
}: {
  title: string | null;
  subtitle?: string | null;
  action?: { label: string; href: string } | null;
  align?: 'left' | 'center';
  rule?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Arbitrary controls on the right — carousel arrows, a tab bar. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  if (!title && !subtitle && !action && !trailing) return null;

  const centred = align === 'center';

  return (
    <div
      className={cn(
        'mb-6 flex flex-wrap items-end gap-3',
        centred ? 'flex-col items-center justify-center text-center' : 'justify-between',
        className,
      )}
    >
      <div className={cn(centred && 'flex flex-col items-center')}>
        {title ? (
          <h2
            className={cn(
              'font-semibold leading-tight',
              size === 'sm' && 'text-lg sm:text-xl',
              size === 'md' && 'text-xl sm:text-2xl',
              size === 'lg' && 'text-2xl sm:text-3xl lg:text-4xl',
            )}
          >
            {title}
          </h2>
        ) : null}

        {rule ? <span aria-hidden className="mt-3 block h-px w-12 bg-primary" /> : null}

        {subtitle ? <p className="mt-2 max-w-prose text-sm text-muted">{subtitle}</p> : null}
      </div>

      {action || trailing ? (
        <div className="flex items-center gap-4">
          {trailing}
          {action ? (
            <Link
              href={action.href}
              className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-primary hover:underline"
            >
              {action.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
