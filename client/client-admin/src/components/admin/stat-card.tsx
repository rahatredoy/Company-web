import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The figure strip that opens every list screen.
 *
 * One component rather than the copy each manager used to carry: six identical
 * definitions meant the row was a slightly different height on each page, and a
 * change to it had to be made six times to stay that way.
 *
 * It is laid out sideways — icon beside the text, not above it — because the
 * strip is a summary, not the screen. Stacked, four of these pushed the table
 * itself below the fold on a laptop; beside each other they read the same and
 * cost about a third less height.
 *
 * Rendered only by client components (the list managers), which is what lets it
 * read the translator with `useT()` for the count; `label` and `note` arrive
 * already translated.
 */

const TINTS = {
  primary: 'bg-primary-soft text-accent-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-destructive-soft text-destructive',
} as const;

export type StatTint = keyof typeof TINTS;

export function StatCard({
  icon: Icon,
  tint,
  label,
  value,
  note,
  good,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: StatTint;
  label: string;
  /** A count is formatted here; anything already formatted — money, a ratio — is passed through. */
  value: string | number;
  note: string;
  /** Draws the note as good news rather than as a caption. */
  good?: boolean;
  /** Makes the card a link, for a figure that is really a filtered list. */
  href?: string;
}) {
  const t = useT();
  /*
   * Every gap here is set rather than inherited. A heading size carries a line
   * height half again its own — enough that the three lines sat unevenly inside
   * equal padding and the card read as badly spaced. `leading-*` on each line
   * makes the text box the height of the text, so the 16px padding is the 16px
   * you see on all four sides and the lines are an even 4px apart.
   */
  const body = (
    <CardContent className="flex items-center gap-3.5 p-4">
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', TINTS[tint])}>
        <Icon className="size-5" />
      </span>

      <div className="min-w-0 space-y-1">
        <p className="truncate text-xs leading-4 font-medium text-muted-foreground">{label}</p>
        <p className="text-[20px] leading-none font-bold tracking-tight tabular-nums">
          {typeof value === 'number' ? t.number(value) : value}
        </p>
        {/* Titled as well as truncated: the note is the only place a card says
            what its number is counted from. */}
        <p
          title={note}
          className={cn('truncate text-[10.5px] leading-4', good ? 'text-success' : 'text-muted-foreground')}
        >
          {note}
        </p>
      </div>
    </CardContent>
  );

  return href ? (
    <Card className="transition-colors hover:border-border-strong">
      <Link href={href} className="block">
        {body}
      </Link>
    </Card>
  ) : (
    <Card>{body}</Card>
  );
}
