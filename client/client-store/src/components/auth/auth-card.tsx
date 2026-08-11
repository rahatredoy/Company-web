import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The shell every auth page sits in.
 *
 * A centred card rather than a split-image layout, because the image half is
 * decoration that costs a large download on the one screen where someone is
 * trying to do a single thing quickly.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="container-store grid min-h-[70vh] place-items-center py-10">
      <div className={cn('w-full max-w-md', className)}>
        <div className="rounded-(--radius-card) border border-border bg-surface p-6 sm:p-8">
          <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
          {description ? <div className="mt-2 text-sm text-muted">{description}</div> : null}

          <div className="mt-6">{children}</div>
        </div>

        {footer ? <div className="mt-5 text-center text-sm text-muted">{footer}</div> : null}

        <p className="mt-6 text-center text-xs text-subtle">
          By continuing you agree to our{' '}
          <Link href="/page/terms" className="underline underline-offset-2 hover:text-primary">
            terms
          </Link>{' '}
          and{' '}
          <Link href="/page/privacy" className="underline underline-offset-2 hover:text-primary">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
