import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

/**
 * The shell every auth page sits in.
 *
 * A centred card rather than a split-image layout, because the image half is
 * decoration that costs a large download on the one screen where someone is
 * trying to do a single thing quickly.
 */
export async function AuthCard({
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
  const t = await getT();

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
          {t.rich('By continuing you agree to our {terms} and {privacy}.', {
            terms: (
              <Link href="/page/terms" className="underline underline-offset-2 hover:text-primary">
                {t('terms')}
              </Link>
            ),
            privacy: (
              <Link href="/page/privacy" className="underline underline-offset-2 hover:text-primary">
                {t('privacy policy')}
              </Link>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
