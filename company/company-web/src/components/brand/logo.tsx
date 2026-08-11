import Link from 'next/link';
import { cn } from '@/lib/utils';
import { publicEnv } from '@/lib/env';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_var(--primary)]',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-5" strokeWidth={2} stroke="currentColor">
        <path d="M4 8h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 8Z" strokeLinejoin="round" />
        <path d="M8.5 8V6.5a3.5 3.5 0 1 1 7 0V8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Logo({
  href = '/',
  subtitle,
  className,
}: {
  href?: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn('group inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight">{publicEnv.platformName}</span>
        {subtitle ? <span className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</span> : null}
      </span>
    </Link>
  );
}
